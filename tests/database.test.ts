import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db/database.js';
import { migrate, migrations } from '../server/db/migrations.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('SQLite initialization and transactional migration', () => {
  it('creates nested storage, persists across reopening, and does not repeat migrations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-build-db-test-'));
    directories.push(directory);
    const dataDir = join(directory, 'nested', 'data');
    const first = openDatabase(dataDir);
    try {
      expect(first.schemaVersion).toBe(1);
      expect(first.db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(first.db.pragma('journal_mode', { simple: true })).toBe('wal');
      first.db.prepare('INSERT INTO runtime_metadata (key, value) VALUES (?, ?)').run('test-only', 'survives restart');
      expect(migrate(first.db)).toBe(1);
    } finally { first.db.close(); }
    const second = openDatabase(dataDir);
    try {
      expect(second.db.prepare('SELECT value FROM runtime_metadata WHERE key = ?').get('test-only')).toEqual({ value: 'survives restart' });
      expect(second.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 1 });
    } finally { second.db.close(); }
  });
  it('rolls back a failed migration including its DDL and refuses newer schema history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-build-db-test-'));
    directories.push(directory);
    const { db } = openDatabase(directory);
    try {
      expect(() => migrate(db, [...migrations, {
        version: 2, name: 'test_only_broken_migration',
        sql: 'CREATE TABLE test_only_partial (id INTEGER); INSERT INTO missing_table VALUES (1);',
      }])).toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'test_only_partial'").get()).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 1 });
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(2, 'future_version');
      expect(() => migrate(db)).toThrow('does not match');
    } finally { db.close(); }
  });
});
