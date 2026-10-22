import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrations.js';

export function openDatabase(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'bid-and-build.sqlite'));
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    const schemaVersion = migrate(db);
    return { db, schemaVersion };
  } catch (error) {
    db.close();
    throw error;
  }
}
