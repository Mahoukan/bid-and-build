import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { Server } from 'socket.io';
import type { Health } from '../shared/contracts.js';
import type { RoomClientEvents, RoomServerEvents } from '../shared/rooms.js';
import type { AppConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { RoomFailure, RoomService } from './rooms/service.js';
import { registerRooms, roomError } from './rooms/transport.js';
import { AdminAuth } from './admin/auth.js';
import { TemplateService } from './admin/templates.js';
import { registerAdministration } from './admin/transport.js';
import { PendingWork } from './lifecycle.js';

export function createRuntime(config: AppConfig, options: { revealMs?: number } = {}) {
  const indexPath = join(config.clientDir, 'index.html');
  if (config.mode === 'production' && !existsSync(indexPath)) {
    throw new Error('Built client missing. Run npm run build before npm start.');
  }
  const { db, schemaVersion } = openDatabase(config.dataDir);
  const app = express();
  const httpServer = createServer(app);
  let rooms: RoomService;
  try { rooms = new RoomService(db, options.revealMs, config.sessionSecret); }
  catch (error) { db.close(); throw error; }
  const work = new PendingWork();
  let ready = true;
  const io = new Server<RoomClientEvents, RoomServerEvents>(httpServer, {
    maxHttpBufferSize: 32 * 1024,
    cors: { origin: config.appOrigin, methods: ['GET', 'POST'] },
    allowRequest: (request, callback) => callback(null, ready && (request.headers.origin === undefined || request.headers.origin === config.appOrigin)),
  });
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!ready) throw new Error('Shutting down.');
      db.prepare('SELECT 1').get();
      res.json({ status: 'ready', service: 'bid-and-build', schemaVersion } satisfies Health);
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });
  app.use((_req, res, next) => {
    if (!ready) { res.setHeader('Connection', 'close'); res.status(503).json({ error: { code: 'SERVER_STOPPING', message: 'The server is restarting. Reconnect shortly.' } }); return; }
    next();
  });
  registerRooms(app, io, rooms, config.appOrigin);
  registerAdministration(app, new AdminAuth(db, config), new TemplateService(db), rooms, work);
  app.use(express.json({ limit: '32kb' }));
  // Reserved namespaces never fall through to the frontend or expose local files.
  app.use(['/api', '/media', '/health', '/socket.io'], (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
  });
  if (config.mode === 'production') {
    app.use(express.static(config.clientDir, { index: false, dotfiles: 'deny' }));
    app.get(['/', '/builder', '/admin', '/templates', '/room/:code', '/display/:code'], (req, res, next) => {
      if (!req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      // Resolve within the explicit client root. An otherwise valid checkout
      // inside a hidden parent (e.g. .cache) must not be treated as a dotfile URL.
      res.sendFile('index.html', { root: config.clientDir, dotfiles: 'deny' });
    });
  }
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof RoomFailure) { res.status(error.status).json({ error: roomError(error) }); return; }
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    const clientError = typeof status === 'number' && status >= 400 && status < 500;
    res.status(clientError ? status : 500).json({
      error: { code: clientError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: clientError ? 'Invalid request.' : 'Request failed.' },
    });
  };
  app.use(onError);

  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    if (closing) return closing;
    ready = false;
    // Stop accepting HTTP/sockets immediately, then drain every admitted task
    // before closing SQLite. Synchronous transactions finish or roll back first.
    const roomDrain = rooms.close();
    const adminDrain = work.close();
    const connections = new Promise<void>((resolve) => {
      io.close(() => resolve());
      httpServer.closeIdleConnections();
    });
    closing = Promise.all([roomDrain, adminDrain, connections]).then(() => { db.close(); });
    return closing;
  }
  return { app, httpServer, io, close, rooms };
}
