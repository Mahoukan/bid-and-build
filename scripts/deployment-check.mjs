// Test-only orchestration. Never copied into the production image and never
// pointed at user storage. Uses the real built server, HTTP and Socket.IO.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const root = fileURLToPath(new URL('..', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run(file, args, options = {}) {
  const child = spawn(file, args, { cwd: root, windowsHide: true, ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.end(options.input ?? '');
  const [code] = await once(child, 'exit');
  if (code !== 0 && !options.allowFailure) throw new Error(`${basename(file)} failed (${code}): ${stderr.slice(-2000)}`);
  return { code, stdout, stderr };
}
async function unusedPort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}

export async function deploymentCheck(docker = false) {
  const port = await unusedPort(); const origin = `http://127.0.0.1:${port}`;
  const id = `bid-build-smoke-${randomUUID()}`;
  const temporaryRoot = resolve(tmpdir()); const directory = await mkdtemp(join(temporaryRoot, 'bid-build-deployment-'));
  const initialData = docker ? '/data' : join(directory, 'live');
  const backup = docker ? '/data/test-backup' : join(directory, 'backup');
  const restored = docker ? '/data/test-restored' : join(directory, 'restored');
  const environment = { ...process.env, NODE_ENV: 'production', PORT: String(docker ? 3000 : port), HOST: '0.0.0.0', DATA_DIR: initialData, APP_ORIGIN: origin, TRUST_PROXY: '', SESSION_SECRET: randomBytes(48).toString('hex') };
  const image = process.argv[2] ?? 'bid-and-build:m9';
  let child; let container = false; let volume = false; let dataDir = initialData;
  const clients = [];
  const execute = (args, input, allowFailure = false) => docker
    ? run('docker', ['exec', '-i', id, ...args], { input, allowFailure })
    : run(args[0] === 'node' ? process.execPath : args[0], args.slice(1), { input, allowFailure, env: { ...environment, DATA_DIR: dataDir } });
  const script = async (source) => (await execute(['node', '--input-type=module'], source)).stdout;
  const stop = async () => {
    if (container) {
      await run('docker', ['stop', '--time', '30', id]);
      assert.equal((await run('docker', ['inspect', '--format', '{{.State.ExitCode}}', id])).stdout.trim(), '0', 'container must exit gracefully');
      await run('docker', ['rm', id]); container = false;
    }
    if (child) {
      const stopped = once(child, 'exit'); child.kill('SIGTERM'); const [code] = await stopped;
      if (process.platform !== 'win32') assert.equal(code, 0, 'SIGTERM must exit gracefully');
      child = undefined;
    }
  };
  const start = async (nextData = dataDir) => {
    dataDir = nextData;
    if (docker) {
      await run('docker', ['run', '--detach', '--name', id, '--label', `bid-build-smoke=${id}`, '--env', 'SESSION_SECRET', '--env', 'NODE_ENV=production', '--env', `APP_ORIGIN=${origin}`, '--env', `DATA_DIR=${dataDir}`, '--publish', `127.0.0.1:${port}:3000`, '--mount', `type=volume,source=${id},target=/data`, image], { env: environment });
      container = true;
    } else {
      child = spawn(process.execPath, ['scripts/start.mjs'], { cwd: root, windowsHide: true, env: { ...environment, DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.resume(); child.stderr.resume();
    }
    for (let count = 0; count < 100; count++) {
      try { const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json()).status === 'ready') return; } catch { /* wait for listening/migrations */ }
      await delay(100);
    }
    throw new Error('Production server did not become ready.');
  };
  const http = async (path, body, token, cookie) => {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
    return response;
  };
  const json = async (...args) => { const response = await http(...args); assert.ok(response.ok, `HTTP request failed with ${response.status}`); return response.json(); };
  const connect = async (seat) => {
    const socket = io(origin, { auth: { code: seat.code, token: seat.token }, transports: ['websocket'], reconnection: false, autoConnect: false, extraHeaders: { Origin: origin }, timeout: 4000 }); clients.push(socket);
    const ready = new Promise((resolve, reject) => { socket.once('room:snapshot', resolve); socket.once('connect_error', reject); }); socket.connect(); await ready; return socket;
  };
  try {
    if (docker) {
      await run('docker', ['info']);
      const present = await run('docker', ['volume', 'inspect', id], { allowFailure: true }); assert.notEqual(present.code, 0, 'smoke volume must be new');
      await run('docker', ['volume', 'create', '--label', `bid-build-smoke=${id}`, id]); volume = true;
    }
    await start();
    // Provision fixtures through compiled private modules in the disposable DB.
    const template = JSON.parse(await readFile(join(root, 'samples/dragon-game.json'), 'utf8'));
    const templateId = JSON.parse(await script(`
      import sharp from 'sharp';
      import { existsSync } from 'node:fs';
      import { loadConfig } from './dist/server/config.js';
      import { openDatabase } from './dist/server/db/database.js';
      import { createAdministrator } from './dist/server/admin/accounts.js';
      import { TemplateService } from './dist/server/admin/templates.js';
      const config = loadConfig(); const { db } = openDatabase(config.dataDir);
      try {
        ${docker ? "if (process.getuid() !== 1000 || existsSync('node_modules/typescript')) throw new Error('Runtime packaging is incorrect.');" : ''}
        await createAdministrator(db, 'isolated-smoke-admin', 'Isolated-smoke-fixture-password-2026');
        const template = ${JSON.stringify(template)};
        const image = { version: 1, mimeType: 'image/png', data: (await sharp({create:{width:8,height:8,channels:4,background:'#225533'}}).png().toBuffer()).toString('base64') };
        template.coverImage = image; template.options[0].image = image;
        const service = new TemplateService(db); const saved = await service.save({template}, () => {});
        service.publish(saved.id, saved.revision, true); console.log(JSON.stringify(saved.id));
      } finally { db.close(); }
    `));
    for (const route of ['/', '/builder', '/templates', '/admin', '/room/ABCDEFGH', '/display/ABCDEFGH']) assert.equal((await http(route)).status, 200, `Production page ${route}`);
    for (const route of ['/.env', '/data/bid-and-build.sqlite', '/api/missing', '/media/missing.png']) assert.equal((await http(route)).status, 404);
    await execute(['node', 'dist/server/cli/migrate.js']);
    for (const command of ['create', 'reset-password']) {
      const result = await execute(['node', 'dist/server/cli/admin.js', command], undefined, true);
      assert.equal(result.code, 1); assert.ok(result.stderr.includes('interactive terminal'), 'compiled admin CLI must load production dependencies and require private prompts');
    }
    const login = await http('/api/admin/login', { username: 'isolated-smoke-admin', password: 'Isolated-smoke-fixture-password-2026' }); assert.equal(login.status, 200);
    const cookieHeader = login.headers.get('set-cookie'); assert.ok(cookieHeader.includes('Secure') && cookieHeader.includes('HttpOnly') && cookieHeader.includes('SameSite=Strict'));
    const cookie = cookieHeader.split(';')[0]; await login.arrayBuffer();
    const host = await json(`/api/templates/${templateId}/host`, { name: 'Deployment host fixture' }); const guest = await json(`/api/rooms/${host.code}/join`, { name: 'Deployment guest fixture' });
    let hostSocket = await connect(host); let guestSocket = await connect(guest);
    const snapshot = () => json(`/api/rooms/${host.code}`, undefined, host.token);
    const send = async (socket, type, fields = {}) => {
      const state = await snapshot(); const command = { type, commandId: randomUUID(), gameId: state.gameId, runId: state.runId, phase: state.phase, auctionId: state.current?.auctionId ?? null, ...fields };
      const reply = await socket.timeout(4000).emitWithAck('room:command', command); assert.ok(reply.ok && reply.receipt.ok, `Command ${type} failed`); return command;
    };
    await send(hostSocket, 'start'); await send(hostSocket, 'bid', { amount: 3 }); const award = await send(guestSocket, 'giveUp'); await send(hostSocket, 'pause');
    const before = await snapshot(); assert.equal(before.purchases.length, 1); assert.equal(before.players[0].balance, 17);
    const originalImage = Buffer.from(await (await http(`/api/rooms/${host.code}/media/${before.current.option.imageAssetId}`, undefined, host.token)).arrayBuffer());
    await execute(['node', 'dist/server/cli/backup.js', 'backup', backup]);
    await execute(['node', 'dist/server/cli/backup.js', 'restore', backup, restored]);
    await stop(); clients.forEach((socket) => socket.disconnect()); await start();
    hostSocket = await connect(host); guestSocket = await connect(guest);
    let after = await snapshot(); assert.equal(after.paused, true); assert.equal(after.pauseReason, 'restart'); assert.deepEqual(after.purchases, before.purchases);
    const replay = await guestSocket.timeout(4000).emitWithAck('room:command', award); assert.ok(replay.ok && replay.receipt.ok); assert.equal((await snapshot()).purchases.length, 1);
    assert.equal((await json('/api/admin/session', undefined, undefined, cookie)).authenticated, true);
    assert.ok((await json('/api/templates')).templates.some((entry) => entry.id === templateId));
    const cover = await http(`/api/templates/${templateId}/cover`); assert.equal(cover.status, 200); await cover.arrayBuffer();
    assert.deepEqual(Buffer.from(await (await http(`/api/rooms/${host.code}/media/${after.current.option.imageAssetId}`, undefined, host.token)).arrayBuffer()), originalImage);
    const replacement = await json(`/api/rooms/${host.code}/recover`, { recoveryCode: host.recoveryCode, confirmed: true }); await connect(replacement);
    assert.equal((await http(`/api/rooms/${host.code}`, undefined, host.token)).status, 401);
    await stop(); clients.forEach((socket) => socket.disconnect()); await start(restored);
    await connect(host); await connect(guest); after = await snapshot(); assert.equal(after.paused, true); assert.equal(after.players[0].balance, 17); assert.deepEqual(after.purchases, before.purchases);
    const totals = JSON.parse(await script(`import { loadConfig } from './dist/server/config.js'; import { openDatabase } from './dist/server/db/database.js'; const {db}=openDatabase(loadConfig().dataDir); try { console.log(JSON.stringify(db.prepare('SELECT COUNT(*) AS count, SUM(price) AS spent FROM room_purchases').get())); } finally {db.close();}`));
    assert.deepEqual(totals, { count: 1, spent: 3 });
    console.log(`${docker ? 'Docker named-volume' : 'Compiled production'} check passed: routes, native images, private admin modules/CLI guards, sessions, restart, recovery, receipt dedupe, consistent backup and separate restore.`);
    if (!docker && process.platform === 'win32') console.log('Windows process termination verifies crash recovery. Graceful SIGTERM is exercised by the Linux CI/Docker job; runtime drain has separate tests.');
  } finally {
    clients.forEach((socket) => socket.disconnect());
    try { await stop(); } finally {
      if (container) await run('docker', ['rm', '--force', id], { allowFailure: true });
      if (volume) {
        const label = await run('docker', ['volume', 'inspect', '--format', '{{index .Labels "bid-build-smoke"}}', id]);
        assert.equal(label.stdout.trim(), id, 'refuse cleanup of an unowned volume'); await run('docker', ['volume', 'rm', id]);
      }
      assert.ok(dirname(resolve(directory)) === temporaryRoot && basename(directory).startsWith('bid-build-deployment-'), 'Refusing cleanup outside the isolated test directory.');
      await rm(directory, { recursive: true, force: true });
    }
  }
}
