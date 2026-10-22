import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRuntime } from '../server/app.js';
import { parseConfig } from '../server/config.js';
import { healthSchema } from '../shared/contracts.js';

describe('real HTTP and Socket.IO runtime', () => {
  let directory: string;
  let runtime: ReturnType<typeof createRuntime>;
  let origin: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bid-build-runtime-test-'));
    const clientDir = join(directory, 'test-client');
    await mkdir(clientDir);
    // Isolated routing fixture, never served by the application build.
    await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>Test-only SPA fixture</title>');
    runtime = createRuntime({
      ...parseConfig({ NODE_ENV: 'production', SESSION_SECRET: 'test-secret-'.repeat(8), DATA_DIR: directory }),
      clientDir,
    });
    runtime.httpServer.listen(0, '127.0.0.1');
    await once(runtime.httpServer, 'listening');
    origin = `http://127.0.0.1:${(runtime.httpServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await runtime?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it('reports ready after schema initialization, without exposing configuration', async () => {
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(healthSchema.parse(await response.json())).toEqual({ status: 'ready', service: 'bid-and-build', schemaVersion: 1 });
  });
  it.each(['/', '/builder', '/room/TEST', '/display/TEST', '/admin'])(
    'supports direct app navigation: %s', async (path) => {
      const response = await fetch(origin + path, { headers: { Accept: 'text/html' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('Test-only SPA fixture');
    },
  );
  it.each(['/api', '/api/unknown', '/media/future.png', '/health/unknown', '/assets/missing.js', '/unknown', '/.env', '/data/bid-and-build.sqlite'])(
    'returns an actual 404 for %s, even when HTML is accepted', async (path) => {
      const response = await fetch(origin + path, { headers: { Accept: 'text/html' } });
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.text()).not.toContain('Test-only SPA fixture');
    },
  );
  it('rejects malformed or oversized JSON without leaking a stack trace', async () => {
    for (const [body, status] of [['{', 400], [JSON.stringify({ value: 'x'.repeat(40_000) }), 413]] as const) {
      const response = await fetch(`${origin}/api/unknown`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } });
    }
  });
  it.each(['websocket', 'polling'] as const)('connects real clients over %s without creating seats', async (transport) => {
    const clients = Array.from({ length: 2 }, () => connect(origin, {
      transports: [transport], autoConnect: false, reconnection: false,
      extraHeaders: { Origin: 'http://localhost:5173' },
    }));
    try {
      await Promise.all(clients.map((client) => new Promise<void>((resolve, reject) => {
        client.once('server:ready', (payload) => {
          try { expect(payload).toEqual({ protocolVersion: 1 }); resolve(); } catch (error) { reject(error); }
        });
        client.once('connect_error', reject);
        client.connect();
      })));
    } finally { clients.forEach((client) => client.disconnect()); }
  });
  it('rejects an unapproved WebSocket origin', async () => {
    const client = connect(origin, { transports: ['websocket'], autoConnect: false, reconnection: false, extraHeaders: { Origin: 'https://unapproved.example' } });
    try {
      const error = new Promise<Error>((resolve) => client.once('connect_error', resolve));
      client.connect();
      expect(await error).toBeInstanceOf(Error);
      expect(client.connected).toBe(false);
    } finally { client.disconnect(); }
  });
});
