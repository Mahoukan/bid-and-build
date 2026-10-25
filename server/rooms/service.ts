import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createGame, minimumBid, parseGameState, transition } from '../../engine/index.js';
import { gameCommandSchema, type GameCommand } from '../../shared/game.js';
import { createRoomSchema, displayAuthSchema, issueRecoverySchema, joinRoomSchema, recoverRoomSchema, roomAuthSchema, takeoverSchema, type CommandReceipt, type RoomCredentials, type RoomManifest, type RoomSnapshot } from '../../shared/rooms.js';
import { prepareRoomContent } from './images.js';
import { PrivateOperations, recoveryCode, recoveryVerifier, seatToken } from './secrets.js';
import type { GameTemplate } from '../../shared/template.js';

export class RoomFailure extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
type RoomRow = { code: string; game_id: string; manifest_json: string; state_json: string; revision: number; started: number; reveal_at: number | null; pause_reason: RoomSnapshot['pauseReason']; expires_at: number };
type Controller = { socketId: string; revoke: () => void };
type Seat = { player_id: string; token_hash: string; recovery_hash: string | null };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const TTL = 24 * 60 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomService {
  private controllers = new Map<string, Map<string, Controller>>();
  private queues = new Map<string, Promise<unknown>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private maintenance: ReturnType<typeof setInterval>;
  private stopped = false;
  private processingImages = 0;
  private operations: PrivateOperations;
  onChange: (code: string) => void = () => {};

  constructor(private db: Database.Database, private revealMs = 1800, private displaySecret: string) {
    this.operations = new PrivateOperations(db, displaySecret);
    // Presence is process-local. Restore active persisted games paused, without
    // replaying transitions, receipts or purchases, even after an unclean stop.
    db.transaction(() => {
      db.prepare('DELETE FROM rooms WHERE expires_at <= ?').run(Date.now());
      for (const row of db.prepare('SELECT * FROM rooms').all() as RoomRow[]) {
        const state = parseGameState(JSON.parse(row.state_json));
        if (state.phase === 'bidding' || state.phase === 'reveal') {
          state.paused = true; state.revision++;
          db.prepare('UPDATE rooms SET state_json = ?, revision = revision + 1, pause_reason = ?, reveal_at = NULL WHERE code = ?').run(JSON.stringify(state), 'restart', row.code);
        }
      }
    }).immediate();
    this.maintenance = setInterval(() => { try { this.cleanup(); } catch { /* retry on next tick; never delete live data on error */ } }, 60_000);
    this.maintenance.unref();
  }

  private row(code: string): RoomRow {
    const row = this.db.prepare('SELECT * FROM rooms WHERE code = ?').get(code) as RoomRow | undefined;
    if (!row || (row.expires_at <= Date.now() && !this.controllers.get(code)?.size)) throw new RoomFailure('ROOM_NOT_FOUND', 'Room not found or expired.', 404);
    return row;
  }
  private state(row: RoomRow) { return parseGameState(JSON.parse(row.state_json)); }
  private queue<T>(code: string, work: () => T | Promise<T>): Promise<T> {
    const result = (this.queues.get(code) ?? Promise.resolve()).catch(() => {}).then(() => {
      if (this.stopped) throw new RoomFailure('SERVER_STOPPING', 'The server is restarting. Reconnect shortly.', 503);
      return work();
    });
    this.queues.set(code, result);
    void result.finally(() => { if (this.queues.get(code) === result) this.queues.delete(code); }).catch(() => {});
    return result;
  }
  authenticate(code: string, token: string): Seat {
    if (!roomAuthSchema.safeParse({ code, token }).success) throw new RoomFailure('BAD_CREDENTIALS', 'Valid room credentials are required.', 401);
    this.row(code);
    const seat = this.db.prepare('SELECT player_id, token_hash, recovery_hash FROM room_players WHERE room_code = ? AND token_hash = ?').get(code, hash(token)) as Seat | undefined;
    if (!seat) throw new RoomFailure('BAD_CREDENTIALS', 'This room credential is invalid or was replaced.', 401);
    return seat;
  }
  private requireController(code: string, token: string, socketId: string): Seat {
    const seat = this.authenticate(code, token);
    if (this.controllers.get(code)?.get(seat.player_id)?.socketId !== socketId) throw new RoomFailure('CONTROL_REQUIRED', 'This connection does not control the seat.', 403);
    return seat;
  }
  private displayCapability(code: string): string {
    // Domain-separated from player/admin credentials; bound to this room's
    // unique game, so an expired/reused public code cannot restore access.
    return createHmac('sha256', this.displaySecret).update(`bid-build:display:v1:${this.row(code).game_id}`).digest('base64url');
  }
  createDisplay(code: string, playerToken: string) {
    this.authenticate(code, playerToken);
    return { code, displayToken: this.displayCapability(code) };
  }
  authenticateDisplay(code: string, displayToken: string) {
    if (!displayAuthSchema.safeParse({ code, displayToken }).success || !timingSafeEqual(Buffer.from(displayToken), Buffer.from(this.displayCapability(code)))) {
      throw new RoomFailure('BAD_DISPLAY_ACCESS', 'Open the shared display using a link from a player’s game menu.', 401);
    }
  }
  snapshot(code: string): RoomSnapshot {
    const row = this.row(code); const state = this.state(row);
    const manifest = JSON.parse(row.manifest_json) as RoomManifest;
    const last = state.currentAuction?.optionIndex ?? -1;
    const revealedOptions = manifest.options.slice(0, last + 1);
    const revealed = new Set(revealedOptions.map((option) => option.id));
    return {
      schemaVersion: 1, code, gameId: state.gameId, runId: state.runId, revision: row.revision,
      title: manifest.title, description: manifest.description, coverAssetId: manifest.coverAssetId,
      hostPlayerId: state.hostPlayerId, phase: state.phase, paused: state.paused, pauseReason: row.pause_reason,
      settings: state.settings, players: state.players.map((player) => ({ ...player, connected: this.controllers.get(code)?.has(player.id) ?? false })),
      optionCount: state.optionIds.length,
      current: state.currentAuction ? { auctionId: state.currentAuction.id, index: last, option: manifest.options[last]!, leader: state.currentAuction.leader, concededPlayerIds: state.currentAuction.concededPlayerIds } : null,
      revealedOptions,
      purchases: state.purchases.map(({ optionId, playerId, price, reason }) => ({ optionId, playerId, price, reason })),
      bids: state.bids.map(({ optionId, playerId, amount }) => ({ optionId, playerId, amount })),
      unclaimed: state.unclaimed.filter((entry) => revealed.has(entry.optionId)).map(({ optionId, status }) => ({ optionId, status })),
      unrevealedCount: manifest.options.length - revealedOptions.length, completion: state.completion,
      minimumBid: minimumBid(state), revealAt: row.reveal_at,
    };
  }
  private replay(operation: ReturnType<PrivateOperations['context']>): RoomCredentials | null {
    const cached = operation.read();
    if (!cached) return null;
    if (!cached.matches) throw new RoomFailure('REQUEST_REUSED', 'This request key already belongs to different input.', 409);
    const response = cached.response; this.row(response.code);
    const seat = this.db.prepare('SELECT * FROM room_players WHERE room_code = ? AND player_id = ?').get(response.code, response.playerId) as Seat | undefined;
    const handoff = this.db.prepare('SELECT previous_hash, expires_at FROM room_handoffs WHERE room_code = ? AND token_hash = ?').get(response.code, hash(response.token)) as { previous_hash: string; expires_at: number } | undefined;
    if (!seat || (seat.token_hash !== hash(response.token) && !(handoff?.previous_hash === seat.token_hash && handoff.expires_at > Date.now()))) throw new RoomFailure('CREDENTIALS_CHANGED', 'This request has finished and its credential is no longer current. Recover your seat with your private code.', 409);
    if (response.recoveryCode && seat.recovery_hash !== recoveryVerifier(response.code, response.recoveryCode)) delete response.recoveryCode;
    return response;
  }
  async create(input: unknown): Promise<RoomCredentials> {
    const parsed = createRoomSchema.safeParse(input);
    if (!parsed.success) throw new RoomFailure('INVALID_TEMPLATE', 'Check your player name, template fields and image limits.');
    return this.queue('bootstrap:create', () => this.createQueued(parsed.data));
  }
  createFromCatalogue(templateId: string, input: unknown, readTemplate: () => GameTemplate): Promise<RoomCredentials> {
    const parsed = joinRoomSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new RoomFailure('INVALID_NAME', 'Enter a player name of 1–40 characters.'));
    return this.queue('bootstrap:create', () => {
      const operation = this.operations.context(`catalogue:${templateId}`, parsed.data);
      const cached = this.replay(operation); if (cached) return cached;
      return this.createQueued({ ...parsed.data, template: readTemplate() }, operation);
    });
  }
  private async createQueued(input: ReturnType<typeof createRoomSchema.parse>, operation = this.operations.context('create', input)): Promise<RoomCredentials> {
    const cached = this.replay(operation); if (cached) return cached;
    if (this.processingImages >= 2) throw new RoomFailure('SERVER_BUSY', 'Other images are processing. Please try again shortly.', 429);
    this.processingImages++;
    try {
      let prepared: Awaited<ReturnType<typeof prepareRoomContent>>;
      try { prepared = await prepareRoomContent(input.template); }
      catch { throw new RoomFailure('INVALID_IMAGE', 'An image could not be safely decoded, or exceeds the image limits. Replace it and try again.'); }
      if (this.stopped) throw new RoomFailure('SERVER_STOPPING', 'Server is restarting.', 503);
      const { manifest, assets } = prepared;
      const playerId = randomUUID(); const token = randomBytes(32).toString('base64url');
      const template = input.template;
      const state = createGame({ gameId: randomUUID(), hostPlayerId: playerId, settings: { startingCurrency: template.startingCurrency, currencySymbol: template.currencySymbol, minimumOpeningBid: template.minimumOpeningBid, minimumBidIncrease: template.minimumBidIncrease }, optionIds: manifest.options.map((option) => option.id), players: [{ id: playerId, name: input.name }] });
      return this.db.transaction(() => {
        if ((this.db.prepare('SELECT COUNT(*) AS count FROM rooms').get() as { count: number }).count >= 500) throw new RoomFailure('SERVER_FULL', 'Room capacity reached. Try again later.', 503);
        let code: string;
        do { code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); } while (this.db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code));
        this.db.prepare('INSERT INTO rooms (code, game_id, manifest_json, state_json, revision, expires_at) VALUES (?, ?, ?, ?, 0, ?)').run(code, state.gameId, JSON.stringify(manifest), JSON.stringify(state), Date.now() + TTL);
        const privateCode = recoveryCode();
        this.db.prepare('INSERT INTO room_players (room_code, player_id, token_hash, recovery_hash) VALUES (?, ?, ?, ?)').run(code, playerId, hash(token), recoveryVerifier(code, privateCode));
        const insert = this.db.prepare("INSERT INTO room_assets (id, room_code, option_id, bytes, mime_type) VALUES (?, ?, ?, ?, 'image/png')");
        for (const asset of assets) insert.run(asset.id, code, asset.optionId, asset.bytes);
        return operation.save({ code, playerId, token, recoveryCode: privateCode });
      }).immediate();
    } finally { this.processingImages--; }
  }
  join(code: string, input: unknown): Promise<RoomCredentials> {
    return this.queue(code, () => {
      const parsed = joinRoomSchema.safeParse(input);
      if (!parsed.success) throw new RoomFailure('INVALID_NAME', 'Enter a player name of 1–40 characters.');
      const operation = this.operations.context(`join:${code}`, parsed.data); const cached = this.replay(operation); if (cached) return cached;
      const result = this.db.transaction(() => {
        const row = this.row(code); const state = this.state(row);
        if (row.started || state.phase !== 'lobby') throw new RoomFailure('JOIN_CLOSED', 'This game has started. Only existing seats can reconnect.', 409);
        if (state.players.length >= 5) throw new RoomFailure('ROOM_FULL', 'All five player seats are taken.', 409);
        const playerId = randomUUID(); const token = randomBytes(32).toString('base64url');
        state.players.push({ id: playerId, name: parsed.data.name, balance: state.settings.startingCurrency, sittingOut: false }); state.revision++;
        parseGameState(state);
        const privateCode = recoveryCode();
        this.db.prepare('INSERT INTO room_players (room_code, player_id, token_hash, recovery_hash) VALUES (?, ?, ?, ?)').run(code, playerId, hash(token), recoveryVerifier(code, privateCode));
        this.db.prepare('UPDATE rooms SET state_json = ?, revision = revision + 1, expires_at = ? WHERE code = ?').run(JSON.stringify(state), Date.now() + TTL, code);
        return operation.save({ code, playerId, token, recoveryCode: privateCode });
      }).immediate();
      this.onChange(code); return result;
    });
  }
  attach(code: string, token: string, socketId: string, isOpen: () => boolean, revoke: () => void): Promise<void> {
    return this.queue(code, () => {
      if (!isOpen()) throw new RoomFailure('DISCONNECTED', 'Connection closed.');
      const members = this.controllers.get(code) ?? new Map<string, Controller>();
      const handoff = this.db.prepare('SELECT * FROM room_handoffs WHERE room_code = ? AND token_hash = ?').get(code, hash(token)) as { player_id: string; previous_hash: string; expires_at: number } | undefined;
      const seat = this.db.transaction(() => {
        this.row(code);
        if (handoff) {
          if (handoff.expires_at <= Date.now()) throw new RoomFailure('HANDOFF_EXPIRED', 'Seat transfer expired. Recover or take control again.', 401);
          const updated = this.db.prepare('UPDATE room_players SET token_hash = ? WHERE room_code = ? AND player_id = ? AND token_hash = ?').run(hash(token), code, handoff.player_id, handoff.previous_hash);
          if (!updated.changes) throw new RoomFailure('BAD_CREDENTIALS', 'This transfer was replaced.', 401);
          this.db.prepare('DELETE FROM room_handoffs WHERE room_code = ? AND player_id = ?').run(code, handoff.player_id);
        }
        const authenticated = this.authenticate(code, token);
        if (!handoff && members.has(authenticated.player_id)) throw new RoomFailure('CONTROL_ACTIVE', 'Your seat is active in another tab. Close that tab or explicitly take control here.', 409);
        this.db.prepare('UPDATE rooms SET revision = revision + 1, expires_at = ? WHERE code = ?').run(Date.now() + TTL, code);
        return authenticated;
      }).immediate();
      const previous = members.get(seat.player_id);
      members.set(seat.player_id, { socketId, revoke }); this.controllers.set(code, members);
      previous?.revoke(); // Replacement is installed before the old close can enqueue a detach.
      this.onChange(code);
    });
  }
  detach(code: string, socketId: string): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.queue(code, () => {
      const members = this.controllers.get(code);
      const found = [...(members?.entries() ?? [])].find(([, controller]) => controller.socketId === socketId);
      if (!found) return; // An obsolete socket cannot disconnect its replacement.
      const row = this.row(code); const state = this.state(row);
      // Also pause a reveal, avoiding advancement into bidding with somebody absent.
      const participating = !state.players.find((player) => player.id === found[0])!.sittingOut;
      if (participating && (state.phase === 'bidding' || state.phase === 'reveal')) { state.paused = true; state.revision++; }
      this.db.prepare('UPDATE rooms SET state_json = ?, revision = revision + 1, pause_reason = ?, reveal_at = ?, expires_at = ? WHERE code = ?').run(JSON.stringify(state), state.paused ? (participating ? 'disconnect' : row.pause_reason) : null, state.paused ? null : row.reveal_at, Date.now() + TTL, code);
      members!.delete(found[0]); if (!members!.size) this.controllers.delete(code);
      this.schedule(code); this.onChange(code);
    });
  }
  takeover(code: string, token: string, input: unknown): Promise<RoomCredentials> {
    return this.queue(code, () => {
      const parsed = takeoverSchema.safeParse(input);
      if (!parsed.success) throw new RoomFailure('CONFIRM_REQUIRED', 'Confirm that you want to take control of this seat.');
      const operation = this.operations.context(`takeover:${code}`, { ...parsed.data, token });
      const cached = this.replay(operation); if (cached) return cached;
      const seat = this.authenticate(code, token);
      return this.db.transaction(() => operation.save(this.handoff(code, seat))).immediate();
    });
  }
  recover(code: string, input: unknown): Promise<RoomCredentials> {
    return this.queue(code, () => {
      const parsed = recoverRoomSchema.safeParse(input);
      if (!parsed.success) throw new RoomFailure('BAD_RECOVERY_CODE', 'Enter your complete private recovery code.', 401);
      this.row(code);
      const seat = this.db.prepare('SELECT * FROM room_players WHERE room_code = ? AND recovery_hash = ?').get(code, recoveryVerifier(code, parsed.data.recoveryCode)) as Seat | undefined;
      if (!seat) throw new RoomFailure('BAD_RECOVERY_CODE', 'That private code is not valid for this room.', 401);
      const operation = this.operations.context(`recover:${code}`, parsed.data); const cached = this.replay(operation); if (cached) return cached;
      return this.db.transaction(() => operation.save({ ...this.handoff(code, seat), recoveryCode: parsed.data.recoveryCode.match(/.{4}/g)!.join('-') })).immediate();
    });
  }
  private handoff(code: string, seat: Seat): RoomCredentials {
    const token = seatToken();
    this.db.prepare('DELETE FROM room_handoffs WHERE room_code = ? AND player_id = ?').run(code, seat.player_id);
    this.db.prepare('INSERT INTO room_handoffs (token_hash, room_code, player_id, previous_hash, expires_at) VALUES (?, ?, ?, ?, ?)').run(hash(token), code, seat.player_id, seat.token_hash, Date.now() + 5 * 60_000);
    return { code, playerId: seat.player_id, token };
  }
  replaceRecoveryCode(code: string, token: string, input: unknown): Promise<RoomCredentials> {
    return this.queue(code, () => {
      const parsed = issueRecoverySchema.safeParse(input);
      if (!parsed.success) throw new RoomFailure('INVALID_REQUEST', 'Invalid replacement request.');
      const operation = this.operations.context(`replace:${code}`, { ...parsed.data, token }); const cached = this.replay(operation); if (cached) return cached;
      const seat = this.authenticate(code, token);
      return this.db.transaction(() => {
        if (!parsed.data.replace && seat.recovery_hash) return operation.save({ code, playerId: seat.player_id, token });
        const privateCode = recoveryCode();
        this.db.prepare('UPDATE room_players SET recovery_hash = ? WHERE room_code = ? AND player_id = ?').run(recoveryVerifier(code, privateCode), code, seat.player_id);
        this.db.prepare('DELETE FROM room_handoffs WHERE room_code = ? AND player_id = ?').run(code, seat.player_id);
        return operation.save({ code, playerId: seat.player_id, token, recoveryCode: privateCode });
      }).immediate();
    });
  }
  command(code: string, token: string, socketId: string, input: unknown): Promise<{ snapshot: RoomSnapshot; receipt: CommandReceipt }> {
    return this.queue(code, () => {
      const seat = this.requireController(code, token, socketId);
      const parsed = gameCommandSchema.safeParse(input);
      if (!parsed.success) throw new RoomFailure('INVALID_COMMAND', 'Command fields are invalid.');
      const receipt = this.apply(code, seat.player_id, parsed.data);
      this.schedule(code); this.onChange(code);
      return { snapshot: this.snapshot(code), receipt };
    });
  }
  private apply(code: string, playerId: string, command: GameCommand): CommandReceipt {
    return this.db.transaction(() => {
      const row = this.row(code); const state = this.state(row);
      const old = this.db.prepare('SELECT command_json, receipt_json FROM room_receipts WHERE game_id = ? AND run_id = ? AND player_id = ? AND command_id = ?').get(row.game_id, command.runId, playerId, command.commandId) as { command_json: string; receipt_json: string } | undefined;
      if (old) {
        if (old.command_json !== JSON.stringify(command)) throw new RoomFailure('COMMAND_ID_REUSED', 'This command ID already refers to a different action.');
        return JSON.parse(old.receipt_json) as CommandReceipt;
      }
      const connected = this.controllers.get(code);
      const result = command.type === 'sitOut' && connected?.has(command.playerId)
        ? { ok: false as const, error: { code: 'PLAYER_CONNECTED', message: 'Sit Out is for a permanently departed player. This player is currently connected.' } }
        : command.type === 'start' && state.players.some((player) => !connected?.has(player.id))
        ? { ok: false as const, error: { code: 'PLAYERS_OFFLINE', message: 'All seated players must connect before Start.' } }
        : transition(state, playerId, command);
      const receipt: CommandReceipt = { commandId: command.commandId, runId: command.runId, ok: result.ok, revision: row.revision + (result.ok ? 1 : 0), ...(!result.ok ? { error: result.error } : {}) };
      if (result.ok) {
        const next = result.state;
        const oldOutcomes = state.runId === next.runId ? new Set([...state.purchases, ...state.unclaimed].map((entry) => entry.optionId)) : new Set<string>();
        for (const entry of [...next.purchases, ...next.unclaimed]) {
          if (oldOutcomes.has(entry.optionId)) continue;
          this.db.prepare('INSERT INTO room_settlements (room_code, game_id, run_id, option_id, outcome) VALUES (?, ?, ?, ?, ?)').run(code, next.gameId, next.runId, entry.optionId, 'price' in entry ? 'purchase' : entry.status);
          if ('price' in entry) this.db.prepare('INSERT INTO room_purchases (room_code, game_id, run_id, option_id, auction_id, player_id, price, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(code, next.gameId, next.runId, entry.optionId, entry.auctionId, entry.playerId, entry.price, entry.reason);
        }
        const revealAt = next.phase === 'reveal' && !next.paused ? (state.phase === 'reveal' && !state.paused && state.currentAuction?.id === next.currentAuction?.id ? row.reveal_at : Date.now() + this.revealMs) : null;
        this.db.prepare('UPDATE rooms SET state_json = ?, revision = revision + 1, started = ?, reveal_at = ?, pause_reason = ?, expires_at = ? WHERE code = ?').run(JSON.stringify(next), row.started || command.type === 'start' ? 1 : 0, revealAt, next.paused ? (state.paused ? row.pause_reason : 'host') : null, Date.now() + TTL, code);
      }
      this.db.prepare('INSERT INTO room_receipts (room_code, game_id, run_id, player_id, command_id, command_json, receipt_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(code, row.game_id, command.runId, playerId, command.commandId, JSON.stringify(command), JSON.stringify(receipt));
      return receipt;
    }).immediate();
  }
  receipt(code: string, token: string, runId: string, commandId: string): Promise<{ snapshot: RoomSnapshot; receipt: CommandReceipt | null }> {
    return this.queue(code, () => {
      const seat = this.authenticate(code, token); const row = this.row(code);
      const found = this.db.prepare('SELECT receipt_json FROM room_receipts WHERE game_id = ? AND run_id = ? AND player_id = ? AND command_id = ?').get(row.game_id, runId, seat.player_id, commandId) as { receipt_json: string } | undefined;
      return { snapshot: this.snapshot(code), receipt: found ? JSON.parse(found.receipt_json) as CommandReceipt : null };
    });
  }
  media(code: string, token: string, assetId: string, display = false): { bytes: Buffer; mime_type: string } {
    if (display) this.authenticateDisplay(code, token); else this.authenticate(code, token);
    const publicState = this.snapshot(code);
    const visible = assetId === publicState.coverAssetId || publicState.revealedOptions.some((option) => option.imageAssetId === assetId);
    if (!visible) throw new RoomFailure('MEDIA_NOT_FOUND', 'Image not found.', 404);
    const asset = this.db.prepare('SELECT bytes, mime_type FROM room_assets WHERE room_code = ? AND id = ?').get(code, assetId) as { bytes: Buffer; mime_type: string } | undefined;
    if (!asset) throw new RoomFailure('MEDIA_NOT_FOUND', 'Image not found.', 404);
    return asset;
  }
  private schedule(code: string) {
    clearTimeout(this.timers.get(code)); this.timers.delete(code);
    const row = this.row(code); const state = this.state(row);
    if (state.phase !== 'reveal' || state.paused || row.reveal_at === null) return;
    const expected = { runId: state.runId, auctionId: state.currentAuction!.id };
    const timer = setTimeout(() => {
      void this.queue(code, () => {
        const fresh = this.state(this.row(code));
        if (fresh.phase !== 'reveal' || fresh.paused || fresh.runId !== expected.runId || fresh.currentAuction?.id !== expected.auctionId) return;
        this.apply(code, fresh.hostPlayerId, { type: 'next', commandId: randomUUID(), gameId: fresh.gameId, runId: fresh.runId, auctionId: fresh.currentAuction.id, phase: 'reveal' });
        this.schedule(code); this.onChange(code);
      }).catch(() => { /* Keep state intact; host Next remains available after an I/O failure. */ });
    }, Math.max(0, row.reveal_at - Date.now()));
    timer.unref(); this.timers.set(code, timer);
  }
  cleanup(now = Date.now()) {
    this.db.transaction(() => {
      for (const [code, members] of this.controllers) if (members.size) this.db.prepare('UPDATE rooms SET expires_at = ? WHERE code = ?').run(now + TTL, code);
      this.db.prepare('DELETE FROM rooms WHERE expires_at <= ?').run(now);
      this.db.prepare('DELETE FROM room_handoffs WHERE expires_at <= ?').run(now);
    }).immediate();
  }
  async close() {
    this.stopped = true; clearInterval(this.maintenance);
    for (const timer of this.timers.values()) clearTimeout(timer);
    await Promise.allSettled(this.queues.values());
    this.controllers.clear();
  }
}
