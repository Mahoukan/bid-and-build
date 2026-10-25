import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { backupDatabase, restoreDatabase } from '../server/db/backup.js';
import { openDatabase } from '../server/db/database.js';
import { RoomService } from '../server/rooms/service.js';
import { TemplateService } from '../server/admin/templates.js';
import { AdminAuth } from '../server/admin/auth.js';
import { createRuntime } from '../server/app.js';
import { parseConfig } from '../server/config.js';
import { templateSchema } from '../shared/template.js';
import type { GameCommand } from '../shared/game.js';
import { PendingWork } from '../server/lifecycle.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'bid-build-operations-'));
  cleanup.push(() => rm(path, { recursive: true, force: true })); return path;
}

it('backs up a live WAL database with room/template images, then restores separately with paused state and exactly one charge', async () => {
  const root = await directory(); const source = join(root, 'live'); const { db } = openDatabase(source);
  const rooms = new RoomService(db, 60_000, 'test-only-'.repeat(8));
  cleanup.push(async () => { await rooms.close(); db.close(); });
  const template = templateSchema.parse(JSON.parse(await readFile(new URL('../samples/dragon-game.json', import.meta.url), 'utf8')));
  const image = { version: 1 as const, mimeType: 'image/png' as const, data: (await sharp({ create: { width: 8, height: 8, channels: 4, background: '#125533' } }).png().toBuffer()).toString('base64') };
  template.coverImage = image; template.options[0]!.image = image;
  const templates = new TemplateService(db); const saved = await templates.save({ template }, () => {}); templates.publish(saved.id, saved.revision, true);
  const host = await rooms.create({ name: 'Backup host fixture', template }); const guest = await rooms.join(host.code, { name: 'Backup guest fixture' });
  await rooms.attach(host.code, host.token, 'host-test-socket', () => true, () => {});
  await rooms.attach(host.code, guest.token, 'guest-test-socket', () => true, () => {});
  const send = (token: string, socket: string, type: GameCommand['type'], fields = {}) => {
    const state = rooms.snapshot(host.code);
    return rooms.command(host.code, token, socket, { type, commandId: randomUUID(), gameId: state.gameId, runId: state.runId, phase: state.phase, auctionId: state.current?.auctionId ?? null, ...fields });
  };
  await send(host.token, 'host-test-socket', 'start'); await send(host.token, 'host-test-socket', 'bid', { amount: 3 }); await send(guest.token, 'guest-test-socket', 'giveUp');
  const before = rooms.snapshot(host.code); expect(before.purchases).toHaveLength(1);
  const backup = join(root, 'backup'); await backupDatabase(source, backup);
  // Later live mutations cannot change the chosen backup or restored image.
  templates.delete(saved.id, saved.revision + 1);
  const restored = join(root, 'restored'); await restoreDatabase(backup, restored);
  const other = openDatabase(restored); const recovered = new RoomService(other.db, 60_000, 'test-only-'.repeat(8));
  try {
    const state = recovered.snapshot(host.code); expect(state.paused).toBe(true); expect(state.pauseReason).toBe('restart');
    expect(state.purchases).toEqual(before.purchases); expect(state.players.map((player) => player.balance)).toEqual([17, 20]);
    expect(other.db.prepare('SELECT price FROM room_purchases').all()).toEqual([{ price: 3 }]);
    expect(new TemplateService(other.db).get(saved.id).template.options[0]!.image?.data).toBeTruthy();
    expect(recovered.media(host.code, host.token, state.current!.option.imageAssetId!).bytes).toEqual(rooms.media(host.code, host.token, before.current!.option.imageAssetId!).bytes);
    expect(await recovered.recover(host.code, { recoveryCode: host.recoveryCode, confirmed: true })).toMatchObject({ playerId: host.playerId });
    expect(templates.list()).toHaveLength(0);
  } finally { await recovered.close(); other.db.close(); }
});

it('refuses overwrite, corrupt backups, incomplete manifests and missing source without resetting existing data', async () => {
  const root = await directory(); const live = join(root, 'live'); const { db } = openDatabase(live); db.close();
  const backup = join(root, 'backup'); await backupDatabase(live, backup);
  const bytes = await readFile(join(live, 'bid-and-build.sqlite'));
  await expect(backupDatabase(live, backup)).rejects.toThrow('never overwritten');
  await expect(restoreDatabase(backup, live)).rejects.toThrow('never overwritten');
  expect(await readFile(join(live, 'bid-and-build.sqlite'))).toEqual(bytes);
  await writeFile(join(backup, 'bid-and-build.sqlite'), 'test-only corruption');
  await expect(restoreDatabase(backup, join(root, 'bad-restore'))).rejects.toThrow('checksum');
  await writeFile(join(backup, 'manifest.json'), '{}');
  await expect(restoreDatabase(backup, join(root, 'bad-restore'))).rejects.toThrow('manifest');
  await expect(backupDatabase(join(root, 'missing'), join(root, 'empty-backup'))).rejects.toThrow();
});

it('drains admitted asynchronous work and rejects newly submitted work while stopping', async () => {
  const work = new PendingWork(); let release!: () => void; let finished = false;
  const first = work.run(() => new Promise<void>((resolve) => { release = resolve; })); await Promise.resolve();
  const closing = work.close().then(() => { finished = true; });
  await expect(work.run(async () => 'late')).rejects.toMatchObject({ code: 'SERVER_STOPPING' }); expect(finished).toBe(false);
  release(); await first; await closing; expect(finished).toBe(true);
});

it('keeps SQLite open for admitted admin work even after its HTTP caller aborts, and stops room commands immediately', async () => {
  const root = await directory(); const runtime = createRuntime(parseConfig({ DATA_DIR: root, SESSION_SECRET: 'test-only-'.repeat(8) }));
  cleanup.push(() => runtime.close()); runtime.httpServer.listen(0, '127.0.0.1'); await once(runtime.httpServer, 'listening');
  const port = (runtime.httpServer.address() as AddressInfo).port;
  let release!: () => void; let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  // Hold a real route at its asynchronous KDF boundary; finish with an actual
  // database-backed session read after abort/close, which would fail on a closed DB.
  vi.spyOn(AdminAuth.prototype, 'login').mockImplementation(async function (this: AdminAuth, req) {
    entered(); await new Promise<void>((resolve) => { release = resolve; });
    return this.status(req);
  });
  const client = request({ hostname: '127.0.0.1', port, path: '/api/admin/login', method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' } });
  client.on('error', () => {}); client.end('{}'); await started; client.destroy();
  let closed = false; const closing = runtime.close().then(() => { closed = true; });
  await expect(runtime.rooms.join('ABCDEFGH', { name: 'late' })).rejects.toMatchObject({ code: 'SERVER_STOPPING' });
  await new Promise((resolve) => setTimeout(resolve, 20)); expect(closed).toBe(false);
  release(); await closing; expect(closed).toBe(true);
});
