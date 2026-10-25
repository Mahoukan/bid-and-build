import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { migrations } from './migrations.js';

const filename = 'bid-and-build.sqlite';
const manifestSchema = z.strictObject({
  format: z.literal('bid-and-build-backup'), version: z.literal(1),
  schemaVersion: z.number().int().positive(), createdAt: z.iso.datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function verifyDatabase(path: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const history = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
    if (JSON.stringify(history) !== JSON.stringify(migrations.map(({ version, name }) => ({ version, name })))) throw new Error('Backup schema does not match this application. Use its matching application version.');
    const app = db.prepare('SELECT value FROM runtime_metadata WHERE key = ?').pluck().get('application');
    if (app !== 'bid-and-build' || db.pragma('integrity_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Database integrity verification failed.');
    return migrations.at(-1)!.version;
  } finally { db.close(); }
}

async function newDirectory(path: string) {
  // No recursive creation or deletion: the chosen parent must exist, and even
  // an empty existing destination is refused. Never overwrite the live DB.
  try { await mkdir(path, { mode: 0o700 }); }
  catch { throw new Error('Choose a new destination directory under an existing writable parent. Existing directories are never overwritten.'); }
}

export async function backupDatabase(dataDir: string, destination: string) {
  const db = new Database(join(dataDir, filename), { readonly: true, fileMustExist: true });
  try {
    await newDirectory(destination);
    const target = join(destination, filename);
    // SQLite's backup API includes committed WAL data. All content images are
    // BLOBs in this database, so their snapshot is atomic with the room/template.
    await db.backup(target);
    await chmod(target, 0o600);
    const schemaVersion = verifyDatabase(target);
    const manifest = { format: 'bid-and-build-backup' as const, version: 1 as const, schemaVersion, createdAt: new Date().toISOString(), sha256: await digest(target) };
    await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return manifest;
  } finally { db.close(); }
}

export async function restoreDatabase(source: string, destination: string) {
  if (resolve(source) === resolve(destination)) throw new Error('Restore requires a separate new destination directory.');
  const metadata = join(source, 'manifest.json');
  if ((await stat(metadata)).size > 4096) throw new Error('Invalid backup manifest.');
  const parsed = manifestSchema.safeParse(JSON.parse(await readFile(metadata, 'utf8')));
  if (!parsed.success) throw new Error('Invalid or incomplete backup manifest.');
  const original = join(source, filename);
  if (await digest(original) !== parsed.data.sha256) throw new Error('Backup checksum failed. Nothing has been restored.');
  if (verifyDatabase(original) !== parsed.data.schemaVersion) throw new Error('Backup schema metadata does not match.');
  await newDirectory(destination);
  const target = join(destination, filename);
  await copyFile(original, target, constants.COPYFILE_EXCL);
  await chmod(target, 0o600);
  if (await digest(target) !== parsed.data.sha256) throw new Error('Restored checksum failed. Do not start this directory.');
  verifyDatabase(target);
  return parsed.data;
}
