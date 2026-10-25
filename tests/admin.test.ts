import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../server/app.js';
import { parseConfig } from '../server/config.js';
import { createAdministrator, resetAdministratorPassword } from '../server/admin/accounts.js';
import { hashPassword, verifyPassword } from '../server/admin/passwords.js';
import { SESSION_IDLE } from '../server/admin/auth.js';
import { TemplateService } from '../server/admin/templates.js';
import type { AdminSession, AdminTemplate, CatalogueTemplate } from '../shared/admin.js';
import type { GameTemplate, PortableImage } from '../shared/template.js';
import type { GameCommand } from '../shared/game.js';
import type { RoomClientEvents, RoomCredentials, RoomServerEvents, RoomSnapshot } from '../shared/rooms.js';

// Isolated fixtures only. These credentials are never installed in the user's database.
const PASSWORD = 'Isolated-admin-test-password-2026';
const ORIGIN = 'http://localhost:5173';
type Client = Socket<RoomServerEvents, RoomClientEvents>;
type Login = { cookie: string; csrf: string };
const cleanup: (() => Promise<void>)[] = [];
const template = (): GameTemplate => ({ format: 'bid-and-build-template', version: 1, title: 'Test collection', description: 'Public preview', coverImage: null, startingCurrency: 20, currencySymbol: '$', minimumOpeningBid: 1, minimumBidIncrease: 1, options: [{ id: 'one', title: 'First private option', description: 'First description', image: null }, { id: 'two', title: 'Future private option', description: 'Future description', image: null }] });
async function image(): Promise<PortableImage> { return { version: 1, mimeType: 'image/png', data: (await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff7a00' } }).withExif({ IFD0: { Artist: 'Secret test metadata' } }).png().toBuffer()).toString('base64') }; }
async function fixture(production = false) {
  const dir = await mkdtemp(join(tmpdir(), 'bid-build-admin-test-'));
  const config = parseConfig({ NODE_ENV: production ? 'production' : 'test', SESSION_SECRET: 'test-admin-secret-'.repeat(5), DATA_DIR: dir });
  let runtime = createRuntime(config, { revealMs: 60_000 });
  const db = new Database(join(dir, 'bid-and-build.sqlite')); db.pragma('foreign_keys = ON');
  const clients: Client[] = [];
  const listen = async () => { runtime.httpServer.listen(0, '127.0.0.1'); await once(runtime.httpServer, 'listening'); return `http://127.0.0.1:${(runtime.httpServer.address() as AddressInfo).port}`; };
  let origin = await listen();
  cleanup.push(async () => { clients.forEach((client) => client.disconnect()); await runtime.close(); db.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (path: string, method = 'GET', body?: unknown, auth?: Login, headers: Record<string, string> = {}) => fetch(origin + path, { method, headers: { Origin: ORIGIN, ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const login = async (username = 'test-admin', password = PASSWORD): Promise<Login> => {
    const response = await request('/api/admin/login', 'POST', { username, password }); expect(response.status).toBe(200);
    const body = await response.json() as AdminSession; expect(body.authenticated).toBe(true); if (!body.authenticated) throw new Error('Sign-in failed.');
    return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, csrf: body.csrfToken };
  };
  const account = (name = 'test-admin') => createAdministrator(db, name, PASSWORD);
  const save = async (auth: Login, content = template()) => { const response = await request('/api/admin/templates', 'POST', { template: content }, auth); expect(response.status).toBe(201); return await response.json() as AdminTemplate; };
  const publish = async (auth: Login, value: AdminTemplate, published = true) => { const response = await request(`/api/admin/templates/${value.id}/publication`, 'POST', { revision: value.revision, published }, auth); expect(response.status).toBe(200); return await response.json() as AdminTemplate; };
  const connect = async (seat: RoomCredentials, auth?: Login) => {
    const client: Client = io(origin, { auth: { code: seat.code, token: seat.token }, autoConnect: false, reconnection: false, transports: ['websocket'], extraHeaders: { Origin: ORIGIN, ...(auth ? { Cookie: auth.cookie } : {}) } }); clients.push(client);
    const ready = new Promise<Client>((resolve, reject) => { client.once('room:snapshot', () => resolve(client)); client.once('connect_error', reject); }); client.connect(); return ready;
  };
  const snapshot = async (seat: RoomCredentials) => await (await request(`/api/rooms/${seat.code}`, 'GET', undefined, undefined, { Authorization: `Bearer ${seat.token}` })).json() as RoomSnapshot;
  return { db, request, login, account, save, publish, connect, snapshot, restart: async () => { clients.forEach((c) => c.disconnect()); await runtime.close(); runtime = createRuntime(config); origin = await listen(); } };
}
async function command(client: Client, state: RoomSnapshot, type: GameCommand['type']) {
  return client.timeout(3000).emitWithAck('room:command', { type, commandId: randomUUID(), gameId: state.gameId, runId: state.runId, auctionId: state.current?.auctionId ?? null, phase: state.phase } as GameCommand);
}
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

describe('administrator authentication and private provisioning', () => {
  it('uses salted password hashes, rejects incorrect credentials and never stores a raw session token', async () => {
    const first = await hashPassword(PASSWORD); const second = await hashPassword(PASSWORD);
    expect(first).not.toBe(second); expect(first).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, first)).toBe(true); expect(await verifyPassword('wrong-password-long-enough', first)).toBe(false); expect(await verifyPassword(PASSWORD, undefined)).toBe(false);
    const f = await fixture(); await f.account(); const auth = await f.login();
    expect(JSON.stringify(f.db.prepare('SELECT * FROM admin_sessions').all())).not.toContain(auth.cookie.split('=')[1]);
    const wrong = await f.request('/api/admin/login', 'POST', { username: 'test-admin', password: 'wrong-password-long-enough' });
    const unknown = await f.request('/api/admin/login', 'POST', { username: 'unknown-admin', password: PASSWORD });
    expect(wrong.status).toBe(401); expect(unknown.status).toBe(401); expect(await wrong.json()).toEqual(await unknown.json());
    for (const route of ['/api/admin/register', '/api/admin/create', '/api/admin/reset-password']) expect((await f.request(route, 'POST', { username: 'attacker', password: PASSWORD })).status).toBe(404);
  });
  it('sets production cookies, rejects origin/CSRF attacks, and rejects duplicate or forged cookies', async () => {
    const f = await fixture(true); await f.account();
    const response = await f.request('/api/admin/login', 'POST', { username: 'test-admin', password: PASSWORD });
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('__Host-bid_build_admin='); expect(cookie).toContain('Secure'); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).toContain('Path=/'); expect(cookie).not.toContain('Domain=');
    const session = await response.json() as Extract<AdminSession, { authenticated: true }>;
    const auth = { cookie: cookie.split(';')[0]!, csrf: session.csrfToken };
    for (const headers of ([{ Origin: 'https://attacker.example' }, { Origin: '' }, { 'X-CSRF-Token': '' }, { 'X-CSRF-Token': randomBytes(32).toString('base64url') }] as Record<string, string>[])) expect((await f.request('/api/admin/templates', 'POST', { template: template() }, auth, headers)).status).toBe(403);
    expect((await f.request('/api/admin/login', 'POST', { username: 'test-admin', password: PASSWORD }, undefined, { Origin: 'https://attacker.example' })).status).toBe(403);
    for (const value of [auth.cookie + '; ' + auth.cookie, '__Host-bid_build_admin=forged']) expect((await f.request('/api/admin/templates', 'GET', undefined, undefined, { Cookie: value })).status).toBe(401);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM templates').get()).toEqual({ n: 0 });
  });
  it('persists sessions across restart; enforces idle/absolute expiry and logout revocation', async () => {
    const f = await fixture(); await f.account(); let auth = await f.login();
    await f.restart(); expect((await f.request('/api/admin/session', 'GET', undefined, auth)).status).toBe(200);
    expect(await (await f.request('/api/admin/session', 'GET', undefined, auth)).json()).toMatchObject({ authenticated: true });
    f.db.prepare('UPDATE admin_sessions SET last_seen = ?').run(Date.now() - SESSION_IDLE - 1);
    expect((await f.request('/api/admin/templates', 'GET', undefined, auth)).status).toBe(401);
    auth = await f.login(); f.db.prepare('UPDATE admin_sessions SET expires_at = ?').run(Date.now() - 1);
    expect((await f.request('/api/admin/templates', 'GET', undefined, auth)).status).toBe(401);
    auth = await f.login(); const logout = await f.request('/api/admin/logout', 'POST', {}, auth); expect(logout.status).toBe(200); expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await f.request('/api/admin/templates', 'GET', undefined, auth)).status).toBe(401);
    expect(await (await f.request('/api/admin/session', 'GET', undefined, auth)).json()).toEqual({ authenticated: false });
  });
  it('resets only the named administrator and revokes all that account’s sessions without touching rooms', async () => {
    const f = await fixture(); await f.account(); await f.account('other-admin');
    const auth = await f.login(); const again = await f.login(); const other = await f.login('other-admin');
    const room = await (await f.request('/api/rooms', 'POST', { template: template(), name: 'Guest host' })).json() as RoomCredentials;
    const before = await f.snapshot(room);
    await resetAdministratorPassword(f.db, 'TEST-ADMIN', 'New-isolated-test-password');
    for (const session of [auth, again]) expect((await f.request('/api/admin/templates', 'GET', undefined, session)).status).toBe(401);
    expect((await f.request('/api/admin/templates', 'GET', undefined, other)).status).toBe(200);
    expect((await f.request('/api/admin/login', 'POST', { username: 'test-admin', password: PASSWORD })).status).toBe(401);
    await f.login('test-admin', 'New-isolated-test-password'); expect(await f.snapshot(room)).toEqual(before);
    await expect(resetAdministratorPassword(f.db, 'missing', PASSWORD)).rejects.toThrow();
    await expect(f.account('other-admin')).rejects.toThrow();
    f.db.prepare('UPDATE admin_accounts SET is_admin = 0 WHERE username = ?').run('other-admin');
    expect((await f.request('/api/admin/templates', 'GET', undefined, other)).status).toBe(403);
    expect((await f.request('/api/admin/templates', 'POST', { template: template() }, other)).status).toBe(403);
  });
  it('limits login attempts by account and IP, including after restart', async () => {
    const f = await fixture();
    for (let n = 0; n < 10; n++) expect((await f.request('/api/admin/login', 'POST', { username: 'missing-admin', password: PASSWORD })).status).toBe(401);
    expect((await f.request('/api/admin/login', 'POST', { username: 'missing-admin', password: PASSWORD })).status).toBe(429);
    await f.restart(); expect((await f.request('/api/admin/login', 'POST', { username: 'missing-admin', password: PASSWORD })).status).toBe(429);
    for (let n = 0; n < 8; n++) expect((await f.request('/api/admin/login', 'POST', {})).status).toBe(401);
    expect((await f.request('/api/admin/login', 'POST', {}, undefined, { 'X-Forwarded-For': '1.2.3.4' })).status).toBe(429);
  }, 15_000);
});

describe('permanent collection and immutable room snapshots', () => {
  it('rejects anonymous direct CRUD and recovery/player/display credentials on every management route', async () => {
    const f = await fixture(); const id = randomUUID();
    const routes = [['GET', '/api/admin/templates'], ['POST', '/api/admin/templates'], ['GET', `/api/admin/templates/${id}`], ['PUT', `/api/admin/templates/${id}`], ['DELETE', `/api/admin/templates/${id}`], ['POST', `/api/admin/templates/${id}/duplicate`], ['POST', `/api/admin/templates/${id}/publication`]];
    for (const [method, path] of routes) expect((await f.request(path!, method!, method === 'GET' ? undefined : {})).status).toBe(401);
    const room = await (await f.request('/api/rooms', 'POST', { template: template(), name: 'Guest' })).json() as RoomCredentials;
    for (const secret of [room.token, room.recoveryCode!]) {
      expect((await f.request('/api/admin/templates', 'POST', { template: template() }, undefined, { Authorization: `Bearer ${secret}`, Cookie: `bid_build_admin=${secret}` })).status).toBe(401);
    }
    expect((await f.request(`/api/templates/${id}/host`, 'POST', { name: 'Guest' }, undefined, { Authorization: 'Display invalid' })).status).toBe(403);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM templates').get()).toEqual({ n: 0 });
  });
  it('supports CRUD, ordering, duplication, publication, revision conflicts, and durable image cleanup', async () => {
    const f = await fixture(); await f.account(); const auth = await f.login(); const content = template(); content.coverImage = await image();
    let item = await f.save(auth, content); const path = `/api/admin/templates/${item.id}`;
    expect(item.published).toBe(false); expect(item.revision).toBe(1);
    expect(await (await f.request('/api/templates')).json()).toEqual({ templates: [], hasMore: false });
    expect((await f.request(`/api/templates/${item.id}/host`, 'POST', { name: 'Guest' })).status).toBe(404);
    const updated = { ...item.template, title: 'Edited title', startingCurrency: 30, currencySymbol: 'G', minimumOpeningBid: 2, minimumBidIncrease: 3, options: [...item.template.options].reverse() };
    const response = await f.request(path, 'PUT', { template: updated, revision: item.revision }, auth); expect(response.status).toBe(200); item = await response.json() as AdminTemplate;
    expect(item.template).toMatchObject({ title: 'Edited title', startingCurrency: 30, minimumOpeningBid: 2, minimumBidIncrease: 3 }); expect(item.template.options[0]!.title).toBe('Future private option');
    expect((await f.request(path, 'PUT', { template: template(), revision: 1 }, auth)).status).toBe(409);
    item = await f.publish(auth, item);
    const duplicate = await (await f.request(path + '/duplicate', 'POST', { revision: item.revision }, auth)).json() as AdminTemplate;
    expect(duplicate.id).not.toBe(item.id); expect(duplicate.published).toBe(false); expect(duplicate.template.options[0]!.id).not.toBe(item.template.options[0]!.id);
    expect(duplicate.template.coverImage).toEqual(item.template.coverImage);
    item = await f.publish(auth, item, false); expect((await f.request(`/api/templates/${item.id}/cover`)).status).toBe(404);
    await f.restart(); expect(await (await f.request(path, 'GET', undefined, auth)).json()).toEqual(item);
    expect((await f.request(path, 'DELETE', { revision: item.revision }, auth)).status).toBe(400);
    expect((await f.request(path, 'DELETE', { revision: item.revision, confirmed: true }, auth)).status).toBe(200);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM template_assets WHERE template_id = ?').get(item.id)).toEqual({ n: 0 });
    expect((await f.request(`/api/admin/templates/${duplicate.id}`, 'GET', undefined, auth)).status).toBe(200);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM template_assets WHERE template_id = ?').get(duplicate.id)).toEqual({ n: 1 });
  });
  it('reveals only previews publicly and retains a running room’s content/images through source edits and deletion', async () => {
    const f = await fixture(); await f.account(); const auth = await f.login(); const content = template(); content.coverImage = await image(); content.options.forEach((option) => { option.image = content.coverImage; });
    let item = await f.publish(auth, await f.save(auth, content)); const path = `/api/admin/templates/${item.id}`;
    const publicResponse = await f.request('/api/templates'); const catalogue = await publicResponse.json() as { templates: CatalogueTemplate[] };
    expect(Object.keys(catalogue.templates[0]!).sort()).toEqual(['coverUrl', 'description', 'id', 'optionCount', 'title']);
    for (const option of item.template.options) { expect(JSON.stringify(catalogue)).not.toContain(option.title); expect(JSON.stringify(catalogue)).not.toContain(option.id); }
    for (const route of [`/api/templates/${item.id}`, `/api/templates/${item.id}/options`, `/media/${item.template.options[1]!.id}`, '/data/bid-and-build.sqlite']) expect((await f.request(route)).status).toBe(404);
    const cover = await f.request(`/api/templates/${item.id}/cover`); expect(cover.status).toBe(200); expect(cover.headers.get('content-type')).toContain('image/png');
    const bytes = Buffer.from(await cover.arrayBuffer()); expect((await sharp(bytes).metadata()).exif).toBeUndefined();
    const key = randomBytes(32).toString('base64url'); const hostBody = { name: 'Guest host', requestKey: key };
    const host = await (await f.request(`/api/templates/${item.id}/host`, 'POST', hostBody)).json() as RoomCredentials; const a = await f.connect(host);
    const guest = await (await f.request(`/api/rooms/${host.code}/join`, 'POST', { name: 'Admin as player' }, auth)).json() as RoomCredentials; const b = await f.connect(guest, auth);
    const forbidden = await command(b, await f.snapshot(guest), 'start'); expect(forbidden.ok && forbidden.receipt?.error?.code).toBe('HOST_REQUIRED');
    const started = await command(a, await f.snapshot(host), 'start'); expect(started.ok && started.receipt?.ok).toBe(true);
    let state = await f.snapshot(host); expect(state.players).toHaveLength(2); expect(state.current?.option.title).toBe('First private option'); expect(JSON.stringify(state)).not.toContain('Future private option');
    const roomAsset = f.db.prepare('SELECT id, bytes FROM room_assets WHERE room_code = ?').all(host.code) as { id: string; bytes: Buffer }[];
    const changed = await f.request(path, 'PUT', { revision: item.revision, template: { ...template(), title: 'Replacement template' } }, auth); expect(changed.status).toBe(200); item = await changed.json() as AdminTemplate;
    expect((await f.request(path, 'DELETE', { revision: item.revision, confirmed: true }, auth)).status).toBe(200);
    expect(f.db.prepare('SELECT id, bytes FROM room_assets WHERE room_code = ?').all(host.code)).toEqual(roomAsset);
    expect(await f.snapshot(host)).toEqual(state);
    // Guest transport retries the accepted hosting request even after the source is gone.
    expect(await (await f.request(`/api/templates/${item.id}/host`, 'POST', hostBody)).json()).toEqual(host);
    expect((await f.request(`/api/templates/${item.id}/host`, 'POST', { name: 'New guest' })).status).toBe(404);
    const next = await command(a, state, 'skip'); expect(next.ok && next.receipt?.ok).toBe(true);
    state = await f.snapshot(host); await command(a, state, 'next'); state = await f.snapshot(host);
    expect(state.current?.option.title).toBe('Future private option');
    const media = await f.request(`/api/rooms/${host.code}/media/${state.current!.option.imageAssetId}`, 'GET', undefined, undefined, { Authorization: `Bearer ${host.token}` }); expect(media.status).toBe(200); expect(Buffer.from(await media.arrayBuffer())).toEqual(bytes);
    expect((await f.request(`/api/rooms/${host.code}`, 'GET', undefined, auth, { Authorization: `Bearer ${auth.cookie.split('=')[1]}` })).status).toBe(401);
  });
  it('rejects hostile image inputs and invalid settings before any persistent write', async () => {
    const f = await fixture(); await f.account(); const auth = await f.login();
    const good = template(); const png = await image();
    const invalid = [ { ...good, startingCurrency: -1 }, { ...good, minimumOpeningBid: 1.5 }, { ...good, minimumBidIncrease: Number.MAX_SAFE_INTEGER + 1 }, { ...good, title: 'a'.repeat(121) }, { ...good, coverImage: 'https://attacker.example/payload.png' }, { ...good, coverImage: { ...png, mimeType: 'image/svg+xml', data: Buffer.from('<svg onload="alert(1)"/>').toString('base64') } }, { ...good, coverImage: { ...png, data: Buffer.from('<html>executable content</html>').toString('base64') } }, { ...good, coverImage: { ...png, path: '../../secret' } }, { ...good, coverImage: { ...png, data: png.data.slice(0, 120) } }, { ...good, options: [{ ...good.options[0], image: { ...png, data: 'A'.repeat(2_000_000) } }] } ];
    for (const content of invalid) expect((await f.request('/api/admin/templates', 'POST', { template: content }, auth)).status).toBe(400);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM templates').get()).toEqual({ n: 0 }); expect(f.db.prepare('SELECT COUNT(*) AS n FROM template_assets').get()).toEqual({ n: 0 });
  });
  it('rolls back image failures, rechecks authority after decoding, and serializes concurrent revisions', async () => {
    const f = await fixture(); await f.account(); const auth = await f.login(); const content = template(); content.coverImage = await image(); const item = await f.save(auth, content);
    const service = new TemplateService(f.db);
    await expect(service.save({ template: content }, () => { throw new Error('Session revoked during decode'); })).rejects.toThrow('revoked');
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM templates').get()).toEqual({ n: 1 });
    f.db.exec("CREATE TRIGGER test_only_failed_asset BEFORE INSERT ON template_assets BEGIN SELECT RAISE(ABORT, 'test-only disk failure'); END;");
    await expect(service.save({ revision: item.revision, template: { ...content, title: 'Must roll back' } }, () => {}, item.id)).rejects.toThrow('test-only');
    expect(service.get(item.id)).toEqual(item); f.db.exec('DROP TRIGGER test_only_failed_asset');
    const responses = await Promise.all(['Edit one', 'Edit two'].map((title) => f.request(`/api/admin/templates/${item.id}`, 'PUT', { template: { ...content, title }, revision: item.revision }, auth)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]); expect(service.get(item.id).revision).toBe(item.revision + 1);
  });
});
