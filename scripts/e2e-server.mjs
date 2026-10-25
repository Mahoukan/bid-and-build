// Real production HTTP/socket runtime; isolated test-only data, no fake state.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRuntime } from '../server/app.ts';
import { parseConfig } from '../server/config.ts';
import { openDatabase } from '../server/db/database.ts';
import { createAdministrator } from '../server/admin/accounts.ts';
const temporaryRoot = resolve(tmpdir());
const dataDir = await mkdtemp(join(temporaryRoot, 'bid-build-playwright-'));
const runtime = createRuntime(parseConfig({ NODE_ENV: 'production', PORT: '3197', HOST: '127.0.0.1', APP_ORIGIN: 'http://127.0.0.1:3197', DATA_DIR: dataDir, SESSION_SECRET: randomBytes(48).toString('hex') }), { revealMs: 60_000 });
// Test-only account, exclusively in the freshly allocated temporary database.
const fixtureDatabase = openDatabase(dataDir);
try { await createAdministrator(fixtureDatabase.db, 'browser-test-admin', 'Isolated-browser-test-password-2026'); }
finally { fixtureDatabase.db.close(); }
runtime.httpServer.listen(3197, '127.0.0.1');
const close = async () => {
  await runtime.close();
  if (dirname(resolve(dataDir)) !== temporaryRoot || !basename(dataDir).startsWith('bid-build-playwright-')) throw new Error('Refusing cleanup outside the isolated test directory.');
  await rm(dataDir, { recursive: true, force: true });
};
process.once('SIGTERM', () => void close()); process.once('SIGINT', () => void close());
