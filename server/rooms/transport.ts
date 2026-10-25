import express, { type Express, type Request } from 'express';
import type { Server } from 'socket.io';
import { displayAuthSchema, receiptQuerySchema, roomAuthSchema, roomCodeSchema, type RoomClientEvents, type RoomReply, type RoomServerEvents } from '../../shared/rooms.js';
import { RoomFailure, RoomService } from './service.js';

function bearer(request: Request): string {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer ')) throw new RoomFailure('BAD_CREDENTIALS', 'Room credentials are required.', 401);
  return value.slice(7);
}
function displayAccess(request: Request): string {
  const value = request.headers.authorization;
  if (!value?.startsWith('Display ')) throw new RoomFailure('BAD_DISPLAY_ACCESS', 'A shared-display link is required.', 401);
  return value.slice(8);
}
export function roomError(error: unknown) {
  return error instanceof RoomFailure ? { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: 'The action could not be committed. Resync before trying again.' };
}

export function registerRooms(app: Express, io: Server<RoomClientEvents, RoomServerEvents>, rooms: RoomService, appOrigin: string) {
  const windows = new Map<string, { count: number; until: number }>();
  function limit(key: string, maximum: number, milliseconds: number) {
    const now = Date.now();
    if (windows.size > 5000) for (const [id, entry] of windows) if (entry.until <= now) windows.delete(id);
    const entry = windows.get(key);
    if (entry && entry.until > now) {
      if (++entry.count > maximum) throw new RoomFailure('RATE_LIMIT', 'Too many requests. Wait a moment and try again.', 429);
    } else {
      if (windows.size >= 10000) throw new RoomFailure('SERVER_BUSY', 'Please try again shortly.', 429);
      windows.set(key, { count: 1, until: now + milliseconds });
    }
  }
  app.use('/api/rooms', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.authorization?.startsWith('Display ')) throw new RoomFailure('DISPLAY_READ_ONLY', 'Shared-display access cannot change a game or create a seat.', 403);
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== appOrigin) throw new RoomFailure('BAD_ORIGIN', 'Open the game from its configured website address.', 403);
    const readOnly = ['GET', 'HEAD'].includes(req.method);
    limit(`http:${readOnly ? 'read' : 'write'}:${req.ip}`, readOnly ? 3000 : 60, 60_000);
    next();
  });
  app.post('/api/rooms', (req, _res, next) => { limit(`create:${req.ip}`, 10, 60_000); next(); }, express.json({ limit: '12mb' }), async (req, res) => {
    res.status(201).json(await rooms.create(req.body));
  });
  app.use('/api/rooms', express.json({ limit: '8kb' }));
  app.param('roomCode', (req, _res, next, value: string) => {
    if (!roomCodeSchema.safeParse(value).success) throw new RoomFailure('ROOM_NOT_FOUND', 'Enter an eight-character room code.', 404);
    req.params.roomCode = value; next();
  });
  app.post('/api/rooms/:roomCode/join', async (req, res) => { res.status(201).json(await rooms.join(req.params.roomCode as string, req.body)); });
  app.get('/api/rooms/:roomCode', (req, res) => {
    const code = req.params.roomCode as string; rooms.authenticate(code, bearer(req)); res.json(rooms.snapshot(code));
  });
  app.post('/api/rooms/:roomCode/takeover', async (req, res) => {
    res.json(await rooms.takeover(req.params.roomCode as string, bearer(req), req.body));
  });
  app.post('/api/rooms/:roomCode/recover', async (req, res) => {
    limit(`recovery:ip:${req.ip}`, 20, 10 * 60_000);
    limit(`recovery:room:${req.params.roomCode}`, 100, 10 * 60_000);
    res.json(await rooms.recover(req.params.roomCode as string, req.body));
  });
  app.post('/api/rooms/:roomCode/recovery-code', async (req, res) => {
    res.json(await rooms.replaceRecoveryCode(req.params.roomCode as string, bearer(req), req.body));
  });
  app.post('/api/rooms/:roomCode/display', (req, res) => {
    res.json(rooms.createDisplay(req.params.roomCode as string, bearer(req)));
  });
  app.get('/api/rooms/:roomCode/display', (req, res) => {
    const code = req.params.roomCode as string;
    rooms.authenticateDisplay(code, displayAccess(req)); res.json(rooms.snapshot(code));
  });
  app.get('/api/rooms/:roomCode/display/media/:assetId', (req, res) => {
    const asset = rooms.media(req.params.roomCode as string, displayAccess(req), req.params.assetId as string, true);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.type(asset.mime_type).send(asset.bytes);
  });
  app.get('/api/rooms/:roomCode/media/:assetId', (req, res) => {
    const asset = rooms.media(req.params.roomCode as string, bearer(req), req.params.assetId as string);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.type(asset.mime_type).send(asset.bytes);
  });

  rooms.onChange = (code) => io.to(`room:${code}`).emit('room:snapshot', rooms.snapshot(code));
  io.use((socket, next) => {
    const auth: unknown = socket.handshake.auth;
    // Bare infrastructure clients never join a room or count as presence.
    if (typeof auth === 'object' && auth !== null && Object.keys(auth).length === 0) return next();
    const display = displayAuthSchema.safeParse(auth);
    if (display.success) {
      try { rooms.authenticateDisplay(display.data.code, display.data.displayToken); next(); }
      catch (error) { next(Object.assign(new Error(roomError(error).message), { data: roomError(error) })); }
      return;
    }
    const parsed = roomAuthSchema.safeParse(auth);
    if (!parsed.success) return next(Object.assign(new Error('Valid room credentials are required.'), { data: { code: 'BAD_CREDENTIALS' } }));
    const { code, token } = parsed.data;
    socket.conn.once('close', () => { void rooms.detach(code, socket.id).catch(() => {}); });
    void rooms.attach(code, token, socket.id, () => socket.conn.readyState === 'open', () => {
      socket.emit('room:revoked', 'Your seat was explicitly taken over in another tab. This connection can no longer act.'); socket.disconnect(true);
    }).then(() => next(), (error: unknown) => next(Object.assign(new Error(roomError(error).message), { data: roomError(error) })));
  });
  io.on('connection', (socket) => {
    socket.emit('server:ready', { protocolVersion: 1 });
    const display = displayAuthSchema.safeParse(socket.handshake.auth);
    if (display.success) {
      const { code, displayToken } = display.data;
      // Same public projection, no seat attachment, controller or detach hook.
      void socket.join(`room:${code}`); socket.emit('room:snapshot', rooms.snapshot(code));
      socket.on('room:sync', (ack) => {
        if (typeof ack !== 'function') return;
        try { limit(`socket:${socket.id}`, 30, 1000); rooms.authenticateDisplay(code, displayToken); ack({ ok: true, snapshot: rooms.snapshot(code) }); }
        catch (error) { ack({ ok: false, error: roomError(error) }); }
      });
      const deny = (ack: (reply: RoomReply) => void) => { if (typeof ack === 'function') ack({ ok: false, error: { code: 'DISPLAY_READ_ONLY', message: 'The shared display cannot control a player or read command receipts.' } }); };
      socket.on('room:command', (_command, ack) => deny(ack));
      socket.on('room:receipt', (_query, ack) => deny(ack));
      return;
    }
    const parsed = roomAuthSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) {
      socket.on('room:command', (_command, ack) => { if (typeof ack === 'function') ack({ ok: false, error: { code: 'BAD_CREDENTIALS', message: 'Connect with room credentials.' } }); });
      return;
    }
    const { code, token } = parsed.data;
    void socket.join(`room:${code}`);
    socket.emit('room:snapshot', rooms.snapshot(code));
    async function reply(ack: (response: RoomReply) => void, action: () => Omit<Extract<RoomReply, { ok: true }>, 'ok'> | Promise<Omit<Extract<RoomReply, { ok: true }>, 'ok'>>) {
      if (typeof ack !== 'function') return;
      try {
        limit(`socket:${socket.id}`, 30, 1000);
        const response = await action(); ack({ ok: true, ...response });
      } catch (error) { ack({ ok: false, error: roomError(error) }); }
    }
    socket.on('room:sync', (ack) => void reply(ack, () => { rooms.authenticate(code, token); return { snapshot: rooms.snapshot(code) }; }));
    socket.on('room:command', (command, ack) => void reply(ack, () => rooms.command(code, token, socket.id, command)));
    socket.on('room:receipt', (query, ack) => void reply(ack, () => {
      const input = receiptQuerySchema.safeParse(query);
      if (!input.success) throw new RoomFailure('INVALID_QUERY', 'Invalid command receipt query.');
      return rooms.receipt(code, token, input.data.runId, input.data.commandId);
    }));
  });
}
