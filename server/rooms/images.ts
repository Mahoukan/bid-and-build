import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { TEMPLATE_LIMITS, type GameTemplate, type PortableImage } from '../../shared/template.js';
import type { RoomManifest } from '../../shared/rooms.js';

export type RoomAsset = { id: string; optionId: string | null; bytes: Buffer };
export async function prepareRoomContent(template: GameTemplate): Promise<{ manifest: RoomManifest; assets: RoomAsset[] }> {
  const assets: RoomAsset[] = [];
  let total = 0;
  async function image(input: PortableImage | null, optionId: string | null) {
    if (!input) return null;
    const source = Buffer.from(input.data, 'base64');
    const decoder = sharp(source, { limitInputPixels: TEMPLATE_LIMITS.sourcePixels, failOn: 'warning', animated: false });
    const metadata = await decoder.metadata();
    if (!['png', 'jpeg'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Only still PNG and JPEG images are supported.');
    const bytes = await decoder.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    total += bytes.length;
    if (bytes.length > TEMPLATE_LIMITS.imageBytes || total > TEMPLATE_LIMITS.totalImageBytes) throw new Error('Re-encoded images exceed the template image limit. Use smaller images.');
    const id = randomUUID(); assets.push({ id, optionId, bytes }); return id;
  }
  const manifest: RoomManifest = { title: template.title, description: template.description, coverAssetId: await image(template.coverImage, null), options: [] };
  // Room option IDs are new opaque IDs, independent of authored IDs or titles.
  for (const option of template.options) {
    const id = randomUUID();
    manifest.options.push({ id, title: option.title, description: option.description, imageAssetId: await image(option.image, id) });
  }
  return { manifest, assets };
}
