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
import type { GameCommand } from '../shared/game.js';
import type { GameTemplate } from '../shared/template.js';
import type { RoomClientEvents, RoomCredentials, RoomReply, RoomServerEvents, RoomSnapshot } from '../shared/rooms.js';

type Client = Socket<RoomServerEvents, RoomClientEvents>;
const APP_ORIGIN = 'http://localhost:5173';
const fixtures: { dir: string; runtime: ReturnType<typeof createRuntime>; clients: Client[]; db: Database.Database }[] = [];
function template(count = 3): GameTemplate {
  return { format: 'bid-and-build-template', version: 1, title: 'Real room test fixture', description: 'Test-only template', coverImage: null, startingCurrency: 20, currencySymbol: '$', minimumOpeningBid: 1, minimumBidIncrease: 1, options: Array.from({ length: count }, (_, index) => ({ id: `fixture-${index}`, title: `Secret title ${index}`, description: `Secret description ${index}`, image: null })) };
}
async function fixture(revealMs = 60_000) {
  const dir = await mkdtemp(join(tmpdir(), 'bid-build-rooms-test-'));
  const config = parseConfig({ NODE_ENV: 'test', SESSION_SECRET: 'isolated-test-secret-'.repeat(5), DATA_DIR: dir });
  const runtime = createRuntime(config, { revealMs });
  runtime.httpServer.listen(0, '127.0.0.1'); await once(runtime.httpServer, 'listening');
  const db = new Database(join(dir, 'bid-and-build.sqlite'));
  db.pragma('foreign_keys = ON');
  const entry = { dir, runtime, clients: [] as Client[], db }; fixtures.push(entry);
  let origin = `http://127.0.0.1:${(runtime.httpServer.address() as AddressInfo).port}`;
  async function post(path: string, body: unknown, token?: string) {
    return fetch(origin + path, { method: 'POST', headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  }
  async function host(content = template()) {
    const response = await post('/api/rooms', { name: 'Host', template: content }); expect(response.status).toBe(201); return await response.json() as RoomCredentials;
  }
  async function joinSeat(code: string, name = 'Guest') {
    const response = await post(`/api/rooms/${code}/join`, { name }); expect(response.status).toBe(201); return await response.json() as RoomCredentials;
  }
  async function connect(seat: RoomCredentials) {
    const client: Client = io(origin, { auth: { code: seat.code, token: seat.token }, autoConnect: false, reconnection: false, transports: ['websocket'], extraHeaders: { Origin: APP_ORIGIN } });
    entry.clients.push(client);
    const ready = new Promise<Client>((resolve, reject) => { client.once('room:snapshot', () => resolve(client)); client.once('connect_error', reject); });
    client.connect(); return ready;
  }
  async function snapshot(seat: RoomCredentials) {
    const response = await fetch(`${origin}/api/rooms/${seat.code}`, { headers: { Authorization: `Bearer ${seat.token}` } }); expect(response.status).toBe(200); return await response.json() as RoomSnapshot;
  }
  async function restart() {
    entry.clients.forEach((client) => client.disconnect());
    await entry.runtime.close();
    entry.runtime = createRuntime(config, { revealMs }); entry.runtime.httpServer.listen(0, '127.0.0.1'); await once(entry.runtime.httpServer, 'listening');
    origin = `http://127.0.0.1:${(entry.runtime.httpServer.address() as AddressInfo).port}`;
  }
  return { ...entry, post, host, joinSeat, connect, snapshot, restart, origin: () => origin };
}
function command(snapshot: RoomSnapshot, action: { type: GameCommand['type']; amount?: number; confirmed?: true; playerId?: string }): GameCommand {
  return { commandId: randomUUID(), gameId: snapshot.gameId, runId: snapshot.runId, auctionId: snapshot.current?.auctionId ?? null, phase: snapshot.phase, ...action } as GameCommand;
}
async function send(client: Client, snapshot: RoomSnapshot, action: { type: GameCommand['type']; amount?: number; confirmed?: true; playerId?: string }) {
  return client.timeout(2000).emitWithAck('room:command', command(snapshot, action));
}
function accepted(reply: RoomReply): RoomSnapshot {
  expect(reply.ok).toBe(true);
  if (!reply.ok) throw new Error(reply.error.message);
  expect(reply.receipt?.ok).toBe(true); return reply.snapshot;
}
async function eventually(check: () => Promise<boolean>) {
  for (let index = 0; index < 100; index++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 20)); }
  throw new Error('Expected state was not observed.');
}
afterEach(async () => {
  for (const entry of fixtures.splice(0)) {
    entry.clients.forEach((client) => client.disconnect()); await entry.runtime.close(); entry.db.close();
    await rm(entry.dir, { recursive: true, force: true });
  }
});

describe('private seat recovery and departure', () => {
  const requestKey = () => randomBytes(32).toString('base64url');
  async function recover(f: Awaited<ReturnType<typeof fixture>>, seat: RoomCredentials, key = requestKey()) {
    const response = await f.post(`/api/rooms/${seat.code}/recover`, { recoveryCode: seat.recoveryCode, confirmed: true, requestKey: key });
    expect(response.status).toBe(200); return await response.json() as RoomCredentials;
  }
  it('gives distinct private codes, stores verifiers/encrypted receipts, never exposes secrets in public state or display capabilities', async () => {
    const f = await fixture(); const host = await f.host(); const guest = await f.joinSeat(host.code);
    expect(host.recoveryCode).toMatch(/^(?:[A-HJ-NP-Z2-9]{4}-){5}[A-HJ-NP-Z2-9]{4}$/); expect(guest.recoveryCode).not.toBe(host.recoveryCode);
    const publicJson = JSON.stringify(await f.snapshot(host));
    const records = JSON.stringify(f.db.prepare('SELECT * FROM room_players').all()) + JSON.stringify(f.db.prepare('SELECT * FROM room_operations').all());
    const display = JSON.stringify(await (await f.post(`/api/rooms/${host.code}/display`, {}, host.token)).json());
    for (const seat of [host, guest]) for (const secret of [seat.token, seat.recoveryCode!, seat.recoveryCode!.replaceAll('-', '')]) {
      expect(publicJson).not.toContain(secret); expect(records).not.toContain(secret); expect(display).not.toContain(secret);
    }
    const other = await f.host(); const wrongRoom = await f.post(`/api/rooms/${other.code}/recover`, { recoveryCode: host.recoveryCode, confirmed: true }); expect(wrongRoom.status).toBe(401);
    const admin = await fetch(`${f.origin()}/api/admin`, { headers: { Authorization: `Bearer ${host.recoveryCode}` } }); expect(admin.status).toBe(404);
  });
  it('recovers the host atomically in a full active room, rejects old actions and cannot be falsely paused by the old socket', async () => {
    const f = await fixture(); const host = await f.host(); const a = await f.connect(host); const guests: RoomCredentials[] = [];
    for (let i = 1; i < 5; i++) { const guest = await f.joinSeat(host.code, `Guest ${i}`); guests.push(guest); await f.connect(guest); }
    let state = accepted(await send(a, await f.snapshot(host), { type: 'start' })); accepted(await send(a, state, { type: 'bid', amount: 4 }));
    const obsoleteId = a.id!;
    const replacement = await recover(f, host); expect(a.connected).toBe(true); const b = await f.connect(replacement); await eventually(async () => !a.connected);
    state = await f.snapshot(replacement); expect(state.players).toHaveLength(5); expect(state.hostPlayerId).toBe(host.playerId); expect(state.paused).toBe(false); expect(state.current?.leader).toEqual({ playerId: host.playerId, amount: 4 });
    await f.runtime.rooms.detach(host.code, obsoleteId); expect((await f.snapshot(replacement)).players[0]!.connected).toBe(true); expect((await f.snapshot(replacement)).paused).toBe(false);
    await expect(f.runtime.rooms.command(host.code, host.token, 'old-socket', command(state, { type: 'end', confirmed: true }))).rejects.toThrow('invalid');
    await expect(f.connect(host)).rejects.toThrow('invalid');
    const guestReplacement = await recover(f, guests[0]!); const g = await f.connect(guestReplacement);
    const forbidden = await send(g, await f.snapshot(guestReplacement), { type: 'pause' }); expect(forbidden.ok && forbidden.receipt?.error?.code).toBe('HOST_REQUIRED');
    accepted(await send(b, await f.snapshot(replacement), { type: 'pause' }));
    const snapshot = await f.snapshot(replacement); expect(snapshot.purchases).toHaveLength(0);
  });
  it('recovers after missed events with purchases, concessions, current bid and original host permission, still paused', async () => {
    const f = await fixture(); const host = await f.host(); const guest = await f.joinSeat(host.code); const third = await f.joinSeat(host.code, 'Third');
    const a = await f.connect(host); const b = await f.connect(guest); const c = await f.connect(third);
    let state = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    state = accepted(await send(b, state, { type: 'bid', amount: 3 })); state = accepted(await send(a, state, { type: 'giveUp' })); state = accepted(await send(c, state, { type: 'giveUp' }));
    state = accepted(await send(a, state, { type: 'next' })); state = accepted(await send(b, state, { type: 'giveUp' })); accepted(await send(c, state, { type: 'bid', amount: 5 }));
    a.disconnect(); await eventually(async () => (await f.snapshot(guest)).paused);
    const denied = await send(b, await f.snapshot(guest), { type: 'resume' }); expect(denied.ok && denied.receipt?.error?.code).toBe('HOST_REQUIRED');
    const next = await recover(f, host); const replacement = await f.connect(next); state = await f.snapshot(next);
    expect(state.paused).toBe(true); expect(state.purchases).toHaveLength(1); expect(state.players.find((player) => player.id === guest.playerId)?.balance).toBe(17); expect(state.current?.concededPlayerIds).toEqual([guest.playerId]); expect(state.current?.leader).toEqual({ playerId: third.playerId, amount: 5 });
    accepted(await send(replacement, state, { type: 'resume' })); expect((await f.snapshot(next)).paused).toBe(false);
  });
  it('replaces codes immediately, cancels prepared transfers, accepts typed lower-case groups and rate-limits attempts', async () => {
    const f = await fixture(); const host = await f.host(); await f.connect(host);
    const priorKey = requestKey(); const prepared = await recover(f, host, priorKey);
    const response = await f.post(`/api/rooms/${host.code}/recovery-code`, { requestKey: requestKey() }, host.token); expect(response.status).toBe(200); const changed = await response.json() as RoomCredentials;
    expect(changed.recoveryCode).not.toBe(host.recoveryCode); expect(changed.token).toBe(host.token);
    await expect(f.connect(prepared)).rejects.toThrow('invalid');
    const old = await f.post(`/api/rooms/${host.code}/recover`, { recoveryCode: host.recoveryCode, confirmed: true }); expect(old.status).toBe(401);
    expect((await f.post(`/api/rooms/${host.code}/recover`, { recoveryCode: host.recoveryCode, confirmed: true, requestKey: priorKey })).status).toBe(401);
    const typed = await f.post(`/api/rooms/${host.code}/recover`, { recoveryCode: changed.recoveryCode!.toLowerCase().replaceAll('-', ' '), confirmed: true }); expect(typed.status).toBe(200);
    let last: Response | undefined;
    for (let i = 0; i < 20; i++) last = await f.post(`/api/rooms/${host.code}/recover`, { recoveryCode: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', confirmed: true });
    expect(last!.status).toBe(429); expect((await last!.json() as { error: { code: string } }).error.code).toBe('RATE_LIMIT');
  });
  it('upgrades a preserved pre-M6 snapshot and seat without changing identity, and never silently replaces a code', async () => {
    const f = await fixture(); const host = await f.host();
    const row = f.db.prepare('SELECT state_json FROM rooms WHERE code = ?').get(host.code) as { state_json: string };
    const legacy = JSON.parse(row.state_json) as { players: { sittingOut?: boolean }[] }; for (const player of legacy.players) delete player.sittingOut;
    f.db.prepare('UPDATE rooms SET state_json = ? WHERE code = ?').run(JSON.stringify(legacy), host.code); f.db.prepare('UPDATE room_players SET recovery_hash = NULL WHERE room_code = ?').run(host.code);
    await f.restart(); await f.connect(host); expect((await f.snapshot(host)).players[0]!.sittingOut).toBe(false);
    const upgrade = { replace: false, requestKey: requestKey() }; const next = await (await f.post(`/api/rooms/${host.code}/recovery-code`, upgrade, host.token)).json() as RoomCredentials;
    expect(next.playerId).toBe(host.playerId); expect(next.token).toBe(host.token); expect(next.recoveryCode).toBeTruthy();
    expect(await (await f.post(`/api/rooms/${host.code}/recovery-code`, upgrade, host.token)).json()).toEqual(next);
    const repeated = await (await f.post(`/api/rooms/${host.code}/recovery-code`, { replace: false }, host.token)).json() as RoomCredentials; expect(repeated.recoveryCode).toBeUndefined();
    await f.connect(await recover(f, next));
  });
  it('retries lost bootstrap, replacement and transfer responses without extra seats or secret rotations, across restart', async () => {
    const f = await fixture(); const create = { name: 'Host', template: template(), requestKey: requestKey() };
    const responses = await Promise.all([f.post('/api/rooms', create), f.post('/api/rooms', create)]); const host = await responses[0]!.json() as RoomCredentials; expect(await responses[1]!.json()).toEqual(host);
    const join = { name: 'Guest', requestKey: requestKey() }; const guest = await (await f.post(`/api/rooms/${host.code}/join`, join)).json() as RoomCredentials;
    const a = await f.connect(host); await f.connect(guest); accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    expect(await (await f.post(`/api/rooms/${host.code}/join`, join)).json()).toEqual(guest); // retry even after seats close
    expect((await f.post(`/api/rooms/${host.code}/join`, { ...join, name: 'Different' })).status).toBe(409);
    const replace = { requestKey: requestKey() }; const changed = await (await f.post(`/api/rooms/${host.code}/recovery-code`, replace, host.token)).json() as RoomCredentials;
    expect(await (await f.post(`/api/rooms/${host.code}/recovery-code`, replace, host.token)).json()).toEqual(changed);
    const key = requestKey(); const next = await recover(f, changed, key); expect(await recover(f, changed, key)).toEqual(next);
    await f.restart(); expect(await recover(f, changed, key)).toEqual(next); await f.connect(next); expect(await recover(f, changed, key)).toEqual(next);
    expect((await f.snapshot(next)).players).toHaveLength(2); expect(f.db.prepare('SELECT COUNT(*) AS n FROM rooms').get()).toEqual({ n: 1 });
  });
  it('rolls back an interrupted bootstrap transaction and leaves a retry able to create exactly one seat', async () => {
    const f = await fixture(); const host = await f.host();
    f.db.exec("CREATE TRIGGER fail_private_response BEFORE INSERT ON room_operations BEGIN SELECT RAISE(ABORT, 'test-only interruption'); END;");
    const body = { name: 'Guest', requestKey: requestKey() }; expect((await f.post(`/api/rooms/${host.code}/join`, body)).status).toBe(500);
    expect((await f.snapshot(host)).players).toHaveLength(1); f.db.exec('DROP TRIGGER fail_private_response;');
    expect((await f.post(`/api/rooms/${host.code}/join`, body)).status).toBe(201); expect((await f.snapshot(host)).players).toHaveLength(2);
  });
  it('confirms Sit Out only for an absent non-host, preserves a binding bid, pauses through restart and settles exactly once', async () => {
    const f = await fixture(); const host = await f.host(); const guest = await f.joinSeat(host.code); let a = await f.connect(host); const b = await f.connect(guest);
    let state = accepted(await send(a, await f.snapshot(host), { type: 'start' })); state = accepted(await send(b, state, { type: 'bid', amount: 6 }));
    state = accepted(await send(a, state, { type: 'pause' })); const connected = await send(a, state, { type: 'sitOut', playerId: guest.playerId, confirmed: true }); expect(connected.ok && connected.receipt?.error?.code).toBe('PLAYER_CONNECTED');
    b.disconnect(); await eventually(async () => !(await f.snapshot(host)).players[1]!.connected);
    state = accepted(await send(a, await f.snapshot(host), { type: 'sitOut', playerId: guest.playerId, confirmed: true })); expect(state.purchases).toHaveLength(0); expect(state.current?.leader?.amount).toBe(6);
    await f.restart(); const recovered = await recover(f, host); a = await f.connect(recovered); state = await f.snapshot(recovered); expect(state.paused).toBe(true); expect(state.players[1]!.sittingOut).toBe(true);
    state = accepted(await send(a, state, { type: 'resume' })); state = accepted(await send(a, state, { type: 'giveUp' })); expect(state.purchases[0]!.price).toBe(6);
    const nextGuest = await recover(f, guest); const c = await f.connect(nextGuest); c.disconnect(); await eventually(async () => !(await f.snapshot(recovered)).players[1]!.connected); expect((await f.snapshot(recovered)).paused).toBe(false);
    state = accepted(await send(a, await f.snapshot(recovered), { type: 'next' })); expect(state.purchases[1]!.playerId).toBe(host.playerId);
    await f.restart(); const final = await recover(f, recovered); await f.connect(final); state = await f.snapshot(final);
    expect(state.paused).toBe(true); expect(state.purchases.map((entry) => entry.price)).toEqual([6, 1]); expect(state.players[1]!.balance).toBe(14);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM room_purchases').get()).toEqual({ n: 2 });
  });
  it('keeps a forced purchase frozen after Sit Out until explicit Resume, rejecting paused bid, Give Up and Next', async () => {
    const f = await fixture(30); const host = await f.host(); const guest = await f.joinSeat(host.code); const a = await f.connect(host); const b = await f.connect(guest);
    let state = accepted(await send(a, await f.snapshot(host), { type: 'start' })); accepted(await send(a, state, { type: 'bid', amount: 2 })); b.disconnect(); await eventually(async () => (await f.snapshot(host)).paused);
    state = accepted(await send(a, await f.snapshot(host), { type: 'sitOut', playerId: guest.playerId, confirmed: true }));
    for (const action of [{ type: 'bid' as const, amount: 3 }, { type: 'giveUp' as const }, { type: 'next' as const }]) { const reply = await send(a, state, action); expect(reply.ok && reply.receipt?.error?.code).toBe('PAUSED'); }
    await new Promise((resolve) => setTimeout(resolve, 70)); expect((await f.snapshot(host)).purchases).toHaveLength(0);
    const resume = command(state, { type: 'resume' }); const result = accepted(await a.timeout(2000).emitWithAck('room:command', resume)); expect(result.purchases[0]!.price).toBe(2);
    accepted(await a.timeout(2000).emitWithAck('room:command', resume)); expect(f.db.prepare('SELECT COUNT(*) AS n FROM room_purchases WHERE option_id = ?').get(result.current!.option.id)).toEqual({ n: 1 });
  });
  it('expires abandoned recovery codes and handoffs, while actual players extend room lifetime', async () => {
    const f = await fixture(); const host = await f.host(); const a = await f.connect(host); const pending = await recover(f, host);
    f.db.prepare('UPDATE room_handoffs SET expires_at = ?').run(Date.now() - 1); await expect(f.connect(pending)).rejects.toThrow('expired'); expect(a.connected).toBe(true);
    f.db.prepare('UPDATE rooms SET expires_at = ?').run(Date.now() - 1); f.runtime.rooms.cleanup(); expect((await f.snapshot(host)).players[0]!.connected).toBe(true);
    a.disconnect(); await eventually(async () => !(await f.snapshot(host)).players[0]!.connected);
    f.db.prepare('UPDATE rooms SET expires_at = ?').run(Date.now() - 1); f.runtime.rooms.cleanup();
    expect((await f.post(`/api/rooms/${host.code}/recover`, { recoveryCode: host.recoveryCode, confirmed: true })).status).toBe(404);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM room_operations').get()).toEqual({ n: 0 });
  });
});

describe('real multiplayer seats and authority', () => {
  it.each([2, 3, 4, 5])('starts %i real connected seats including a bidding host', async (count) => {
    const f = await fixture(); const host = await f.host(); const hostSocket = await f.connect(host);
    const players = [hostSocket];
    for (let index = 1; index < count; index++) players.push(await f.connect(await f.joinSeat(host.code, `Player ${index}`)));
    const started = accepted(await send(hostSocket, await f.snapshot(host), { type: 'start' }));
    expect(started.players).toHaveLength(count); expect(started.players.every((player) => player.connected)).toBe(true);
    const broadcasts = players.map((client) => new Promise<RoomSnapshot>((resolve) => {
      const listener = (state: RoomSnapshot) => { if (state.current?.leader?.amount === 4) { client.off('room:snapshot', listener); resolve(state); } };
      client.on('room:snapshot', listener);
    }));
    const bid = accepted(await send(hostSocket, started, { type: 'bid', amount: 4 }));
    for (const observed of await Promise.all(broadcasts)) expect(observed).toEqual(bid);
    expect(bid.current?.leader).toEqual({ playerId: host.playerId, amount: 4 });
    expect(bid.players.find((player) => player.id === host.playerId)?.balance).toBe(20);
  });
  it('requires two seats and all seated players connected, and forbids non-host controls', async () => {
    const f = await fixture(); const host = await f.host(); const client = await f.connect(host);
    const alone = await send(client, await f.snapshot(host), { type: 'start' }); expect(alone.ok && alone.receipt?.error?.code).toBe('PLAYER_COUNT');
    const guest = await f.joinSeat(host.code); const offline = await send(client, await f.snapshot(host), { type: 'start' }); expect(offline.ok && offline.receipt?.error?.code).toBe('PLAYERS_OFFLINE');
    const guestSocket = await f.connect(guest); const forbidden = await send(guestSocket, await f.snapshot(guest), { type: 'start' }); expect(forbidden.ok && forbidden.receipt?.error?.code).toBe('HOST_REQUIRED');
  });
  it('serializes concurrent joins to five, rejects a sixth and closes new joins after Start', async () => {
    const f = await fixture(); const host = await f.host(); const client = await f.connect(host);
    const responses = await Promise.all(Array.from({ length: 5 }, (_, i) => f.post(`/api/rooms/${host.code}/join`, { name: `Join ${i}` })));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 201, 201, 201, 409]);
    for (const response of responses) if (response.status === 201) await f.connect(await response.json() as RoomCredentials);
    accepted(await send(client, await f.snapshot(host), { type: 'start' }));
    const late = await f.post(`/api/rooms/${host.code}/join`, { name: 'Late' }); expect(late.status).toBe(409); expect((await late.json() as { error: { code: string } }).error.code).toBe('JOIN_CLOSED');
    expect((await f.snapshot(host)).players).toHaveLength(5);
  });
  it('rejects missing/bad credentials, unapproved write origins and room isolation attacks', async () => {
    const f = await fixture(); const first = await f.host(); const second = await f.host();
    const unauthorized = await fetch(`${f.origin()}/api/rooms/${first.code}`); expect(unauthorized.status).toBe(401);
    await expect(f.connect({ ...first, token: second.token })).rejects.toThrow('invalid');
    const wrong = await fetch(`${f.origin()}/api/rooms/${first.code}`, { headers: { Authorization: `Bearer ${second.token}` } }); expect(wrong.status).toBe(401);
    const origin = await fetch(`${f.origin()}/api/rooms/${first.code}/join`, { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Attacker' }) }); expect(origin.status).toBe(403);
    const client = await f.connect(first); const other = await f.connect(second);
    const received: RoomSnapshot[] = []; other.on('room:snapshot', (state) => received.push(state));
    await f.connect(await f.joinSeat(first.code)); accepted(await send(client, await f.snapshot(first), { type: 'start' }));
    expect(received).toHaveLength(0); expect((await f.snapshot(second)).phase).toBe('lobby');
    const cross = await send(client, await f.snapshot(second), { type: 'start' }); expect(cross.ok && cross.receipt?.error?.code).toBe('STALE_GAME');
  });
  it('rejects spoofed actors and invalid amounts at the transport boundary without changing money', async () => {
    const f = await fixture(); const host = await f.host(); const guest = await f.joinSeat(host.code); const a = await f.connect(host); const b = await f.connect(guest);
    const start = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    for (const amount of [-1, 1.5, 1000001, Number.MAX_SAFE_INTEGER + 1, '4']) {
      const invalid = { ...command(start, { type: 'bid', amount: 1 }), amount } as GameCommand;
      const result = await b.timeout(2000).emitWithAck('room:command', invalid); expect(result.ok).toBe(false);
    }
    const forged = { ...command(start, { type: 'bid', amount: 5 }), playerId: host.playerId };
    const result = await b.timeout(2000).emitWithAck('room:command', forged); expect(result.ok).toBe(false);
    const after = await f.snapshot(host); expect(after.current?.leader).toBeNull(); expect(after.players.map((player) => player.balance)).toEqual([20, 20]);
  });
});

describe('commits, command receipts and races', () => {
  it('scopes receipts to the actual seat and does not treat another player’s command ID as a retry', async () => {
    const f = await fixture(); const host = await f.host(); const guest = await f.joinSeat(host.code); const a = await f.connect(host); const b = await f.connect(guest);
    const start = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    const bid = command(start, { type: 'bid', amount: 2 }); accepted(await a.timeout(2000).emitWithAck('room:command', bid));
    const hidden = await b.timeout(2000).emitWithAck('room:receipt', { commandId: bid.commandId, runId: bid.runId }); expect(hidden.ok && hidden.receipt).toBeNull();
    const independent = await b.timeout(2000).emitWithAck('room:command', bid); expect(independent.ok && independent.receipt?.error?.code).toBe('BID_TOO_LOW');
    expect(f.db.prepare('SELECT * FROM room_receipts WHERE command_id = ?').all(bid.commandId)).toHaveLength(2);
    const retry = await a.timeout(2000).emitWithAck('room:command', bid); expect(retry.ok && retry.receipt?.ok).toBe(true);
  });
  it('finishes a real run with paid automatic purchases and no negative balances', async () => {
    const f = await fixture(40); const content = template(5); content.startingCurrency = 2;
    const host = await f.host(content); const guest = await f.joinSeat(host.code); const a = await f.connect(host); await f.connect(guest);
    const start = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    accepted(await send(a, start, { type: 'bid', amount: 2 }));
    await eventually(async () => (await f.snapshot(host)).phase === 'finished');
    const state = await f.snapshot(host); expect(state.purchases.map((entry) => entry.price)).toEqual([2, 1, 1]); expect(state.players.map((player) => player.balance)).toEqual([0, 0]); expect(state.completion?.status).toBe('complete');
    expect(f.db.prepare('SELECT SUM(price) AS spent FROM room_purchases').get()).toEqual({ spent: 4 });
  });
  it('accepts only one same-price bid and charges a duplicated settlement exactly once', async () => {
    const f = await fixture(); const host = await f.host(); const guest = await f.joinSeat(host.code); const a = await f.connect(host); const b = await f.connect(guest);
    const start = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    const bids = await Promise.all([send(a, start, { type: 'bid', amount: 4 }), send(b, start, { type: 'bid', amount: 4 })]);
    expect(bids.filter((reply) => reply.ok && reply.receipt?.ok)).toHaveLength(1);
    const current = await f.snapshot(host); const loser = current.current!.leader!.playerId === host.playerId ? b : a;
    const giveUp = command(current, { type: 'giveUp' });
    const [one, two] = await Promise.all([loser.timeout(2000).emitWithAck('room:command', giveUp), loser.timeout(2000).emitWithAck('room:command', giveUp)]);
    const result = accepted(one); expect(two.ok && one.ok && two.receipt).toEqual(one.ok && one.receipt);
    expect(result.purchases).toHaveLength(1); expect(result.players.reduce((sum, player) => sum + player.balance, 0)).toBe(36);
    expect(f.db.prepare('SELECT price FROM room_purchases').all()).toEqual([{ price: 4 }]);
    const lookup = await loser.timeout(2000).emitWithAck('room:receipt', { commandId: giveUp.commandId, runId: giveUp.runId });
    expect(lookup.ok && lookup.receipt).toEqual(one.ok && one.receipt);
    const altered = await loser.timeout(2000).emitWithAck('room:command', { ...giveUp, type: 'end', confirmed: true }); expect(altered.ok).toBe(false);
  });
  it('rolls back state and receipts when a ledger insert fails, then permits the original retry', async () => {
    const f = await fixture(); const host = await f.host(); const guest = await f.joinSeat(host.code); const a = await f.connect(host); const b = await f.connect(guest);
    const state = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    const giveUp = command(state, { type: 'giveUp' });
    f.db.exec("CREATE TRIGGER test_fail_purchase BEFORE INSERT ON room_purchases BEGIN SELECT RAISE(ABORT, 'test-only failure'); END;");
    const failed = await b.timeout(2000).emitWithAck('room:command', giveUp); expect(failed.ok).toBe(false);
    expect((await f.snapshot(host)).players.map((player) => player.balance)).toEqual([20, 20]);
    expect(f.db.prepare('SELECT * FROM room_settlements').all()).toHaveLength(0);
    const receipt = await b.timeout(2000).emitWithAck('room:receipt', { commandId: giveUp.commandId, runId: giveUp.runId }); expect(receipt.ok && receipt.receipt).toBeNull();
    f.db.exec('DROP TRIGGER test_fail_purchase');
    expect(accepted(await b.timeout(2000).emitWithAck('room:command', giveUp)).purchases[0]?.price).toBe(1);
    const purchase = f.db.prepare('SELECT * FROM room_purchases').get() as Record<string, unknown>;
    expect(() => f.db.prepare('INSERT INTO room_purchases SELECT * FROM room_purchases').run()).toThrow('UNIQUE');
    expect(purchase.player_id).toBe(host.playerId);
  });
  it('makes the reveal timer and host Next advance only once', async () => {
    const f = await fixture(120); const host = await f.host(); const guest = await f.joinSeat(host.code); const a = await f.connect(host); const b = await f.connect(guest);
    const start = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    const reveal = accepted(await send(b, start, { type: 'giveUp' }));
    const next = command(reveal, { type: 'next' });
    await new Promise((resolve) => setTimeout(resolve, 110));
    await a.timeout(2000).emitWithAck('room:command', next);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const state = await f.snapshot(host); expect(state.current?.index).toBe(1); expect(state.phase).toBe('bidding'); expect(state.purchases).toHaveLength(1);
  });
  it('freezes reveal advancement while paused and restores a binding bid uncharged after restart', async () => {
    const f = await fixture(100); const host = await f.host(); const guest = await f.joinSeat(host.code); let a = await f.connect(host); await f.connect(guest);
    const start = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    const leading = accepted(await send(a, start, { type: 'bid', amount: 5 }));
    await f.restart(); a = await f.connect(host); const b = await f.connect(guest);
    const restored = await f.snapshot(host); expect(restored.current?.leader).toEqual(leading.current?.leader); expect(restored.paused).toBe(true); expect(restored.purchases).toEqual([]); expect(restored.players[0]?.balance).toBe(20);
    const resumed = accepted(await send(a, restored, { type: 'resume' }));
    const reveal = accepted(await send(b, resumed, { type: 'giveUp' }));
    const paused = accepted(await send(a, reveal, { type: 'pause' }));
    await new Promise((resolve) => setTimeout(resolve, 200)); expect((await f.snapshot(host)).current?.index).toBe(0); expect((await f.snapshot(host)).phase).toBe('reveal');
    const next = await send(a, paused, { type: 'next' }); expect(next.ok && next.receipt?.error?.code).toBe('PAUSED');
    const ended = accepted(await send(a, await f.snapshot(host), { type: 'end', confirmed: true })); expect(ended.purchases).toHaveLength(1); expect(ended.players[0]?.balance).toBe(15);
  });
  it('keeps committed purchases and original receipts across restart; Play Again uses a fresh run', async () => {
    const f = await fixture(); const host = await f.host(template(1)); const guest = await f.joinSeat(host.code); let a = await f.connect(host); let b = await f.connect(guest);
    const start = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    const giveUp = command(start, { type: 'giveUp' });
    const original = await b.timeout(2000).emitWithAck('room:command', giveUp); accepted(original);
    await f.restart(); a = await f.connect(host); b = await f.connect(guest);
    const restored = await f.snapshot(host); expect(restored.paused).toBe(true); expect(restored.pauseReason).toBe('restart'); expect(restored.phase).toBe('reveal'); expect(restored.purchases).toHaveLength(1);
    const retry = await b.timeout(2000).emitWithAck('room:command', giveUp); expect(retry.ok && retry.receipt).toEqual(original.ok && original.receipt);
    const resumed = accepted(await send(a, restored, { type: 'resume' }));
    const finished = accepted(await send(a, resumed, { type: 'next' })); expect(finished.phase).toBe('finished');
    const again = accepted(await send(a, finished, { type: 'playAgain' })); expect(again.runId).not.toBe(start.runId); expect(again.players.map((player) => player.balance)).toEqual([20, 20]); expect(again.purchases).toEqual([]);
    expect(f.db.prepare('SELECT * FROM room_purchases').all()).toHaveLength(1);
    const oldRetry = await b.timeout(2000).emitWithAck('room:command', giveUp); expect(oldRetry.ok && oldRetry.receipt).toEqual(original.ok && original.receipt);
    const late = await f.post(`/api/rooms/${host.code}/join`, { name: 'Late next run' }); expect(late.status).toBe(409);
  });
});

describe('presence, credentials and media disclosure', () => {
  it('does not let ordinary image/state reads consume the separate write rate limit', async () => {
    const f = await fixture(); const host = await f.host();
    for (let index = 0; index < 65; index++) await f.snapshot(host);
    expect((await f.post(`/api/rooms/${host.code}/join`, { name: 'Guest after reads' })).status).toBe(201);
    let last: Response | undefined;
    for (let index = 0; index < 60; index++) last = await f.post(`/api/rooms/${host.code}/takeover`, { confirmed: true });
    expect(last?.status).toBe(429);
    expect((await f.snapshot(host)).players).toHaveLength(2);
  });
  it('issues room-bound read-only displays without seats, presence, receipts or player authority', async () => {
    const f = await fixture(); const host = await f.host(); const guest = await f.joinSeat(host.code);
    const a = await f.connect(host); await f.connect(guest); const started = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    const path = `/api/rooms/${host.code}/display`;
    expect((await f.post(path, {})).status).toBe(401);
    const response = await f.post(path, {}, guest.token); expect(response.status).toBe(200);
    const access = await response.json() as { code: string; displayToken: string };
    expect(access.displayToken).not.toBe(host.token); expect(access.displayToken).not.toBe(guest.token);
    const display: Client = io(f.origin(), { auth: access, transports: ['websocket'], autoConnect: false, reconnection: false }); f.clients.push(display);
    const ready = new Promise<RoomSnapshot>((resolve, reject) => { display.once('room:snapshot', resolve); display.once('connect_error', reject); }); display.connect();
    expect(await ready).toEqual(started);
    const denied = await send(display, started, { type: 'bid', amount: 10 }); expect(!denied.ok && denied.error.code).toBe('DISPLAY_READ_ONLY');
    const receipt = await display.timeout(2000).emitWithAck('room:receipt', { runId: started.runId, commandId: randomUUID() }); expect(!receipt.ok && receipt.error.code).toBe('DISPLAY_READ_ONLY');
    const get = (url: string, token = access.displayToken) => fetch(f.origin() + url, { headers: { Authorization: `Display ${token}` } });
    expect(await (await get(path)).json()).toEqual(started);
    expect((await get(`/api/rooms/${host.code}`)).status).toBe(401);
    expect((await fetch(f.origin() + `/api/rooms/${host.code}`, { headers: { Authorization: `Bearer ${access.displayToken}` } })).status).toBe(401);
    expect((await get(path, host.token)).status).toBe(401);
    const other = await f.host(); expect((await get(`/api/rooms/${other.code}/display`)).status).toBe(401);
    for (const target of [`/api/rooms/${host.code}/join`, `/api/rooms/${host.code}/takeover`, path, '/api/rooms']) {
      expect((await fetch(f.origin() + target, { method: 'POST', headers: { Origin: APP_ORIGIN, Authorization: `Display ${access.displayToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Forbidden', confirmed: true }) })).status).toBe(403);
    }
    display.disconnect(); await new Promise((resolve) => setTimeout(resolve, 30)); expect(await f.snapshot(host)).toEqual(started);
    await expect(f.connect({ ...host, token: access.displayToken })).rejects.toThrow('invalid');
    await f.restart(); const restored = await get(path); expect(restored.status).toBe(200); expect((await restored.json() as RoomSnapshot).paused).toBe(true);
  });
  it('applies the same future-image boundary to displays and display-only activity never retains an expired room', async () => {
    const f = await fixture(); const content = template(2);
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'green' } }).png().toBuffer();
    content.options.forEach((option) => { option.image = { version: 1, mimeType: 'image/png', data: png.toString('base64') }; });
    const host = await f.host(content); const guest = await f.joinSeat(host.code); const a = await f.connect(host); const b = await f.connect(guest);
    const response = await f.post(`/api/rooms/${host.code}/display`, {}, host.token); const access = await response.json() as { code: string; displayToken: string };
    const display: Client = io(f.origin(), { auth: access, transports: ['websocket'], autoConnect: false }); f.clients.push(display);
    const ready = new Promise<void>((resolve) => display.once('room:snapshot', () => resolve())); display.connect(); await ready;
    const start = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    const manifest = JSON.parse((f.db.prepare('SELECT manifest_json FROM rooms WHERE code = ?').get(host.code) as { manifest_json: string }).manifest_json) as { options: { imageAssetId: string }[] };
    const media = (index: number) => fetch(`${f.origin()}/api/rooms/${host.code}/display/media/${manifest.options[index]!.imageAssetId}`, { headers: { Authorization: `Display ${access.displayToken}` } });
    const current = await media(0); expect(current.status).toBe(200); expect(current.headers.get('cache-control')).toBe('no-store'); expect((await media(1)).status).toBe(404);
    expect(JSON.stringify(start)).not.toContain('Secret title 1');
    b.disconnect(); await eventually(async () => (await f.snapshot(host)).paused); expect((await f.snapshot(host)).players.find((player) => player.id === guest.playerId)?.connected).toBe(false);
    a.disconnect(); await eventually(async () => (await f.snapshot(host)).players.every((player) => !player.connected));
    f.db.prepare('UPDATE rooms SET expires_at = 0 WHERE code = ?').run(host.code); f.runtime.rooms.cleanup();
    const sync = await display.timeout(2000).emitWithAck('room:sync'); expect(!sync.ok && sync.error.code).toBe('ROOM_NOT_FOUND');
    expect((await media(0)).status).toBe(404);
  });
  it('counts host disconnection as a player loss and never automatically transfers host permission', async () => {
    const f = await fixture(); const host = await f.host(); const guest = await f.joinSeat(host.code); const a = await f.connect(host); const b = await f.connect(guest);
    accepted(await send(a, await f.snapshot(host), { type: 'start' })); a.disconnect();
    await eventually(async () => (await f.snapshot(guest)).paused);
    const state = await f.snapshot(guest); expect(state.hostPlayerId).toBe(host.playerId);
    const denied = await send(b, state, { type: 'resume' }); expect(denied.ok && denied.receipt?.error?.code).toBe('HOST_REQUIRED');
    const again = await f.connect(host); expect((await f.snapshot(host)).paused).toBe(true);
    expect(accepted(await send(again, await f.snapshot(host), { type: 'resume' })).paused).toBe(false);
  });
  it('refreshes the same seat, pauses on disconnect and requires explicit host resume', async () => {
    const f = await fixture(); const host = await f.host(); const guest = await f.joinSeat(host.code); const a = await f.connect(host); let b = await f.connect(guest);
    const start = accepted(await send(a, await f.snapshot(host), { type: 'start' }));
    accepted(await send(b, start, { type: 'bid', amount: 3 })); b.disconnect();
    await eventually(async () => (await f.snapshot(host)).paused);
    const paused = await f.snapshot(host); expect(paused.current?.leader?.playerId).toBe(guest.playerId);
    const denied = await send(a, paused, { type: 'bid', amount: 4 }); expect(denied.ok && denied.receipt?.error?.code).toBe('PAUSED');
    const resumedAbsent = accepted(await send(a, paused, { type: 'resume' })); expect(resumedAbsent.current?.concededPlayerIds).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 50)); expect((await f.snapshot(host)).paused).toBe(false);
    b = await f.connect(guest); expect((await f.snapshot(host)).players).toHaveLength(2); b.disconnect();
    await eventually(async () => (await f.snapshot(host)).paused);
    await f.connect(guest); expect((await f.snapshot(host)).paused).toBe(true);
    const ended = accepted(await send(a, await f.snapshot(host), { type: 'end', confirmed: true })); expect(ended.completion?.status).toBe('incomplete'); expect(ended.purchases[0]?.price).toBe(3);
    expect(ended.players.find((player) => player.id === guest.playerId)?.balance).toBe(17);
  });
  it('blocks a second controller and explicit takeover revokes old credentials without changing the host', async () => {
    const f = await fixture(); const host = await f.host(); const a = await f.connect(host);
    await expect(f.connect(host)).rejects.toThrow('another tab');
    const changed = await f.post(`/api/rooms/${host.code}/takeover`, { confirmed: true }, host.token); expect(changed.status).toBe(200);
    const next = await changed.json() as RoomCredentials; expect(next.playerId).toBe(host.playerId); expect(next.token).not.toBe(host.token);
    expect(a.connected).toBe(true); // Preparation cannot disconnect the current controller.
    const replacement = await f.connect(next); expect(replacement.connected).toBe(true); await eventually(async () => !a.connected);
    expect((await f.snapshot(next)).hostPlayerId).toBe(host.playerId);
    await expect(f.connect(host)).rejects.toThrow('invalid');
    expect((await f.snapshot(next)).players).toHaveLength(1);
  });
  it('never publishes future titles, descriptions, IDs, order, bytes or accessible media', async () => {
    const f = await fixture(); const content = template(3);
    const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
    content.coverImage = { version: 1, mimeType: 'image/png', data: png.toString('base64') };
    content.options.forEach((option) => { option.image = content.coverImage; });
    const host = await f.host(content); const guest = await f.joinSeat(host.code); const a = await f.connect(host); const b = await f.connect(guest);
    const row = f.db.prepare('SELECT manifest_json FROM rooms WHERE code = ?').get(host.code) as { manifest_json: string };
    const manifest = JSON.parse(row.manifest_json) as { options: { id: string; imageAssetId: string }[] };
    const lobby = await f.snapshot(guest); const lobbyText = JSON.stringify(lobby); expect(lobbyText).not.toContain('Secret title'); expect(lobbyText).not.toContain(png.toString('base64'));
    const start = accepted(await send(a, lobby, { type: 'start' })); const text = JSON.stringify(start);
    expect(text).toContain('Secret title 0');
    for (let index = 1; index < 3; index++) for (const secret of [`Secret title ${index}`, `Secret description ${index}`, manifest.options[index]!.id, manifest.options[index]!.imageAssetId]) expect(text).not.toContain(secret);
    const media = (id: string, token?: string) => fetch(`${f.origin()}/api/rooms/${host.code}/media/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    expect((await media(manifest.options[1]!.imageAssetId, guest.token)).status).toBe(404);
    expect((await media(manifest.options[0]!.imageAssetId)).status).toBe(401);
    const current = await media(manifest.options[0]!.imageAssetId, guest.token); expect(current.status).toBe(200); expect(current.headers.get('cache-control')).toBe('no-store');
    expect((await sharp(Buffer.from(await current.arrayBuffer())).metadata()).format).toBe('png');
    expect((await fetch(`${f.origin()}/media/${manifest.options[1]!.imageAssetId}`)).status).toBe(404);
    const ended = accepted(await send(a, start, { type: 'end', confirmed: true })); expect(JSON.stringify(ended)).not.toContain('Secret title 1'); expect(ended.unrevealedCount).toBe(2);
    const again = accepted(await send(a, ended, { type: 'playAgain' })); expect(again.revealedOptions).toEqual([]); expect((await media(manifest.options[0]!.imageAssetId, guest.token)).status).toBe(404);
    expect(b.connected).toBe(true);
  });
  it('rejects corrupt image bytes and expires only inactive temporary rooms with cascading assets', async () => {
    const f = await fixture();
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
    const content = template(); content.coverImage = { version: 1, mimeType: 'image/png', data: image.toString('base64') };
    const live = await f.host(content); await f.connect(live); const expired = await f.host(content);
    expect(f.db.prepare('SELECT * FROM room_assets').all()).toHaveLength(2);
    f.db.prepare('UPDATE rooms SET expires_at = 0').run(); f.runtime.rooms.cleanup();
    expect((await f.snapshot(live)).code).toBe(live.code);
    expect((await fetch(`${f.origin()}/api/rooms/${expired.code}`, { headers: { Authorization: `Bearer ${expired.token}` } })).status).toBe(404);
    expect(f.db.prepare('SELECT * FROM room_players WHERE room_code = ?').all(expired.code)).toHaveLength(0);
    expect(f.db.prepare('SELECT room_code FROM room_assets').all()).toEqual([{ room_code: live.code }]);
    const invalid = template(); invalid.coverImage = { version: 1, mimeType: 'image/png', data: image.subarray(0, 33).toString('base64') };
    expect((await f.post('/api/rooms', { name: 'Host', template: invalid })).status).toBe(400);
  });
});
