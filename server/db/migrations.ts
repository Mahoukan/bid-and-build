import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'runtime_metadata',
    sql: `
      CREATE TABLE runtime_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      ) STRICT;
      INSERT INTO runtime_metadata (key, value) VALUES ('application', 'bid-and-build');
    `,
  },
];

export function migrate(db: Database.Database, steps: readonly Migration[] = migrations): number {
  return db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;`);
    const applied = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as { version: number; name: string }[];
    for (let index = 0; index < applied.length; index++) {
      const row = applied[index]!;
      const step = steps[index];
      if (!step || row.version !== step.version || row.name !== step.name) {
        throw new Error('Database migration history does not match this application. Restore a compatible application version.');
      }
    }
    for (const step of steps.slice(applied.length)) {
      db.exec(step.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(step.version, step.name);
    }
    return steps.at(-1)?.version ?? 0;
  }).immediate();
}
