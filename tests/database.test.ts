import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db/database.js';
import { migrate, migrations } from '../server/db/migrations.js';
import Database from 'better-sqlite3';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('SQLite initialization and transactional migration', () => {
  it('upgrades a real version-2 database without dropping existing rooms, seats or immutable assets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-build-db-test-')); directories.push(directory);
    const db = new Database(join(directory, 'legacy.sqlite'));
    try {
      expect(migrate(db, migrations.slice(0, 2))).toBe(2);
      db.prepare('INSERT INTO rooms (code, game_id, manifest_json, state_json, revision, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run('ABCDEFGH', 'legacy-game', '{"test":"manifest"}', '{"test":"state"}', 5, Date.now() + 60_000);
      db.prepare('INSERT INTO room_players (room_code, player_id, token_hash) VALUES (?, ?, ?)').run('ABCDEFGH', 'legacy-seat', 'test-only-verifier');
      db.prepare('INSERT INTO room_assets (id, room_code, bytes, mime_type) VALUES (?, ?, ?, ?)').run('legacy-asset', 'ABCDEFGH', Buffer.from('test-only-image'), 'image/png');
      expect(migrate(db)).toBe(4);
      expect(db.prepare('SELECT state_json, revision FROM rooms').get()).toEqual({ state_json: '{"test":"state"}', revision: 5 });
      expect(db.prepare('SELECT player_id, token_hash, recovery_hash FROM room_players').get()).toEqual({ player_id: 'legacy-seat', token_hash: 'test-only-verifier', recovery_hash: null });
      expect(db.prepare('SELECT bytes FROM room_assets').get()).toEqual({ bytes: Buffer.from('test-only-image') });
    } finally { db.close(); }
  });
  it('creates nested storage, persists across reopening, and does not repeat migrations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-build-db-test-'));
    directories.push(directory);
    const dataDir = join(directory, 'nested', 'data');
    const first = openDatabase(dataDir);
    try {
      expect(first.schemaVersion).toBe(4);
      expect(first.db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(first.db.pragma('journal_mode', { simple: true })).toBe('wal');
      first.db.prepare('INSERT INTO runtime_metadata (key, value) VALUES (?, ?)').run('test-only', 'survives restart');
      expect(migrate(first.db)).toBe(4);
    } finally { first.db.close(); }
    const second = openDatabase(dataDir);
    try {
      expect(second.db.prepare('SELECT value FROM runtime_metadata WHERE key = ?').get('test-only')).toEqual({ value: 'survives restart' });
      expect(second.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 4 });
    } finally { second.db.close(); }
  });
  it('rolls back a failed migration including its DDL and refuses newer schema history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-build-db-test-'));
    directories.push(directory);
    const { db } = openDatabase(directory);
    try {
      expect(() => migrate(db, [...migrations, {
        version: 5, name: 'test_only_broken_migration',
        sql: 'CREATE TABLE test_only_partial (id INTEGER); INSERT INTO missing_table VALUES (1);',
      }])).toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'test_only_partial'").get()).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 4 });
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(5, 'future_version');
      expect(() => migrate(db)).toThrow('does not match');
    } finally { db.close(); }
  });
});
