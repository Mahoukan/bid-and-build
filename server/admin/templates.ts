import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { auctionSettingsSchema } from '../../shared/contracts.js';
import { saveTemplateSchema, type AdminTemplate, type CatalogueTemplate, type TemplateSummary } from '../../shared/admin.js';
import type { GameTemplate, PortableImage } from '../../shared/template.js';
import type { RoomManifest } from '../../shared/rooms.js';
import { prepareRoomContent } from '../rooms/images.js';
import { RoomFailure } from '../rooms/service.js';

type Row = { id: string; title: string; description: string; option_count: number; manifest_json: string; settings_json: string; revision: number; published: number; updated_at: number };
export class TemplateService {
  private processing = 0;
  constructor(private db: Database.Database) {}
  private row(id: string, publishedOnly = false): Row {
    const row = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as Row | undefined;
    if (!row || (publishedOnly && !row.published)) throw new RoomFailure('TEMPLATE_NOT_FOUND', 'Template not found or no longer published.', 404);
    return row;
  }
  private summary(row: Row): TemplateSummary {
    const manifest = JSON.parse(row.manifest_json) as RoomManifest;
    return { id: row.id, title: row.title, description: row.description, optionCount: row.option_count, revision: row.revision, published: !!row.published, updatedAt: row.updated_at, coverUrl: manifest.coverAssetId ? `/api/templates/${row.id}/cover` : null };
  }
  list(): TemplateSummary[] { return (this.db.prepare('SELECT * FROM templates ORDER BY updated_at DESC, id').all() as Row[]).map((row) => this.summary(row)); }
  catalogue(page: number): { templates: CatalogueTemplate[]; hasMore: boolean } {
    const rows = this.db.prepare('SELECT * FROM templates WHERE published = 1 ORDER BY title, id LIMIT 25 OFFSET ?').all(page * 24) as Row[];
    return { templates: rows.slice(0, 24).map((row) => {
      const { id, title, description, optionCount, coverUrl } = this.summary(row); return { id, title, description, optionCount, coverUrl };
    }), hasMore: rows.length > 24 };
  }
  get(id: string, publishedOnly = false): AdminTemplate {
    const row = this.row(id, publishedOnly); const manifest = JSON.parse(row.manifest_json) as RoomManifest;
    const assets = new Map((this.db.prepare('SELECT id, bytes FROM template_assets WHERE template_id = ?').all(id) as { id: string; bytes: Buffer }[]).map((asset) => [asset.id, asset.bytes]));
    const image = (assetId: string | null): PortableImage | null => {
      if (!assetId) return null;
      const bytes = assets.get(assetId); if (!bytes) throw new Error('Template asset is missing.');
      return { version: 1, mimeType: 'image/png', data: bytes.toString('base64') };
    };
    const template: GameTemplate = { format: 'bid-and-build-template', version: 1, ...auctionSettingsSchema.parse(JSON.parse(row.settings_json)), title: manifest.title, description: manifest.description, coverImage: image(manifest.coverAssetId), options: manifest.options.map((option) => ({ id: option.id, title: option.title, description: option.description, image: image(option.imageAssetId) })) };
    return { id: row.id, revision: row.revision, published: !!row.published, template };
  }
  cover(id: string): Buffer {
    const row = this.row(id, true); const manifest = JSON.parse(row.manifest_json) as RoomManifest;
    const asset = this.db.prepare('SELECT bytes FROM template_assets WHERE id = ? AND template_id = ?').get(manifest.coverAssetId, id) as { bytes: Buffer } | undefined;
    if (!asset) throw new RoomFailure('IMAGE_NOT_FOUND', 'Cover image not found.', 404); return asset.bytes;
  }
  private checkRevision(row: Row, revision: number | undefined) {
    if (row.revision !== revision) throw new RoomFailure('TEMPLATE_CHANGED', 'This template changed in another session. Keep your edits, then reload the server version before saving.', 409);
  }
  async save(input: unknown, guard: () => void, id?: string): Promise<AdminTemplate> {
    const parsed = saveTemplateSchema.safeParse(input);
    if (!parsed.success) throw new RoomFailure('INVALID_TEMPLATE', 'Check template fields and image limits.');
    if (id) this.checkRevision(this.row(id), parsed.data.revision);
    else if (parsed.data.revision !== undefined) throw new RoomFailure('INVALID_REVISION', 'A new template has no revision.');
    if (this.processing >= 2) throw new RoomFailure('IMAGES_BUSY', 'Images are processing. Try again shortly.', 429);
    this.processing++;
    try {
      let prepared: Awaited<ReturnType<typeof prepareRoomContent>>;
      try { prepared = await prepareRoomContent(parsed.data.template); }
      catch { throw new RoomFailure('INVALID_IMAGE', 'Replace the invalid or oversized image with a still PNG or JPEG.'); }
      const templateId = id ?? randomUUID();
      this.db.transaction(() => {
        guard(); // Authority is rechecked after asynchronous image decoding.
        const existing = id ? this.row(id) : null;
        if (existing) this.checkRevision(existing, parsed.data.revision);
        else if ((this.db.prepare('SELECT COUNT(*) AS n FROM templates').get() as { n: number }).n >= 500) throw new RoomFailure('TEMPLATE_LIMIT', 'The collection is full. Remove an unused template first.', 409);
        const { manifest, assets } = prepared; const t = parsed.data.template;
        const settings = { startingCurrency: t.startingCurrency, currencySymbol: t.currencySymbol, minimumOpeningBid: t.minimumOpeningBid, minimumBidIncrease: t.minimumBidIncrease };
        const fields = [t.title, t.description, t.options.length, JSON.stringify(manifest), JSON.stringify(settings)]; const now = Date.now();
        if (existing) {
          this.db.prepare('UPDATE templates SET title = ?, description = ?, option_count = ?, manifest_json = ?, settings_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(...fields, now, templateId);
          this.db.prepare('DELETE FROM template_assets WHERE template_id = ?').run(templateId);
        } else this.db.prepare('INSERT INTO templates (title, description, option_count, manifest_json, settings_json, revision, created_at, updated_at, id) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)').run(...fields, now, now, templateId);
        // Each template/room owns a separate asset copy. Deleting template assets
        // cannot remove a live room's independent snapshot or images.
        const insert = this.db.prepare("INSERT INTO template_assets (id, template_id, bytes, mime_type) VALUES (?, ?, ?, 'image/png')");
        for (const asset of assets) insert.run(asset.id, templateId, asset.bytes);
      }).immediate();
      return this.get(templateId);
    } finally { this.processing--; }
  }
  async duplicate(id: string, revision: number, guard: () => void) {
    const source = this.get(id); this.checkRevision(this.row(id), revision);
    return this.save({ template: { ...source.template, title: `${source.template.title.slice(0, 113)} (copy)` } }, () => { guard(); this.checkRevision(this.row(id), revision); });
  }
  publish(id: string, revision: number, published: boolean) {
    return this.db.transaction(() => {
      this.checkRevision(this.row(id), revision);
      this.db.prepare('UPDATE templates SET published = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(published ? 1 : 0, Date.now(), id);
      return this.get(id);
    }).immediate();
  }
  delete(id: string, revision: number) {
    this.db.transaction(() => { this.checkRevision(this.row(id), revision); this.db.prepare('DELETE FROM templates WHERE id = ?').run(id); }).immediate();
  }
}
