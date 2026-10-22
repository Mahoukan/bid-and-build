import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, Health, ServerToClientEvents } from '../shared/contracts.js';
import type { AppConfig } from './config.js';
import { openDatabase } from './db/database.js';

export function createRuntime(config: AppConfig) {
  const indexPath = join(config.clientDir, 'index.html');
  if (config.mode === 'production' && !existsSync(indexPath)) {
    throw new Error('Built client missing. Run npm run build before npm start.');
  }
  const { db, schemaVersion } = openDatabase(config.dataDir);
  const app = express();
  const httpServer = createServer(app);
  let ready = true;
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
  app.use(express.json({ limit: '32kb' }));
  // Reserved namespaces never fall through to the frontend or expose local files.
  app.use(['/api', '/media', '/health', '/socket.io'], (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
  });
  if (config.mode === 'production') {
    app.use(express.static(config.clientDir, { index: false, dotfiles: 'deny' }));
    app.get(['/', '/builder', '/admin', '/room/:code', '/display/:code'], (req, res, next) => {
      if (!req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexPath);
    });
  }
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    const clientError = typeof status === 'number' && status >= 400 && status < 500;
    res.status(clientError ? status : 500).json({
      error: { code: clientError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: clientError ? 'Invalid request.' : 'Request failed.' },
    });
  };
  app.use(onError);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    maxHttpBufferSize: 32 * 1024,
    cors: { origin: config.appOrigin, methods: ['GET', 'POST'] },
    // CORS alone does not restrict WebSocket upgrades.
    allowRequest: (request, callback) => {
      callback(null, request.headers.origin === undefined || request.headers.origin === config.appOrigin);
    },
  });
  io.on('connection', (socket) => socket.emit('server:ready', { protocolVersion: 1 }));

  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    if (closing) return closing;
    ready = false;
    closing = new Promise((resolve) => {
      io.close(() => {
        db.close();
        resolve();
      });
      httpServer.closeIdleConnections();
    });
    return closing;
  }
  return { app, httpServer, io, close };
}
