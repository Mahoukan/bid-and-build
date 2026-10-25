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
  {
    version: 2,
    name: 'multiplayer_rooms',
    sql: `
      CREATE TABLE rooms (
        code TEXT PRIMARY KEY, game_id TEXT NOT NULL UNIQUE,
        manifest_json TEXT NOT NULL, state_json TEXT NOT NULL,
        revision INTEGER NOT NULL, started INTEGER NOT NULL DEFAULT 0 CHECK(started IN (0, 1)),
        reveal_at INTEGER, pause_reason TEXT,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX rooms_expiry ON rooms(expires_at);
      CREATE TABLE room_players (
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        player_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        PRIMARY KEY (room_code, player_id)
      ) STRICT;
      CREATE TABLE room_assets (
        id TEXT PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        option_id TEXT, bytes BLOB NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type = 'image/png')
      ) STRICT;
      CREATE INDEX room_assets_room ON room_assets(room_code);
      CREATE TABLE room_settlements (
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        game_id TEXT NOT NULL, run_id TEXT NOT NULL, option_id TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('purchase', 'unclaimed', 'unplayed')),
        PRIMARY KEY (game_id, run_id, option_id)
      ) STRICT;
      CREATE TABLE room_purchases (
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        game_id TEXT NOT NULL, run_id TEXT NOT NULL, option_id TEXT NOT NULL,
        auction_id TEXT NOT NULL, player_id TEXT NOT NULL,
        price INTEGER NOT NULL CHECK(price >= 1 AND price <= 1000000), reason TEXT NOT NULL,
        PRIMARY KEY (game_id, run_id, option_id),
        FOREIGN KEY (game_id, run_id, option_id) REFERENCES room_settlements(game_id, run_id, option_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE room_receipts (
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        game_id TEXT NOT NULL, run_id TEXT NOT NULL, player_id TEXT NOT NULL, command_id TEXT NOT NULL,
        command_json TEXT NOT NULL, receipt_json TEXT NOT NULL,
        PRIMARY KEY (game_id, run_id, player_id, command_id)
      ) STRICT;
    `,
  },
  {
    version: 3,
    name: 'seat_recovery',
    sql: `
      ALTER TABLE room_players ADD COLUMN recovery_hash TEXT;
      CREATE UNIQUE INDEX room_recovery_verifiers ON room_players(room_code, recovery_hash);
      CREATE TABLE room_operations (
        scope TEXT NOT NULL, key_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        response_encrypted TEXT NOT NULL,
        PRIMARY KEY (scope, key_hash)
      ) STRICT;
      CREATE TABLE room_handoffs (
        token_hash TEXT PRIMARY KEY, room_code TEXT NOT NULL,
        player_id TEXT NOT NULL, previous_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
        FOREIGN KEY (room_code, player_id) REFERENCES room_players(room_code, player_id) ON DELETE CASCADE
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: 'administrator_templates',
    sql: `
      CREATE TABLE admin_accounts (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 1 CHECK(is_admin IN (0, 1)), created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE admin_sessions (
        token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);
      CREATE TABLE request_limits (key_hash TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at INTEGER NOT NULL) STRICT;
      CREATE TABLE templates (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, option_count INTEGER NOT NULL,
        manifest_json TEXT NOT NULL, settings_json TEXT NOT NULL,
        revision INTEGER NOT NULL, published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0, 1)),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE template_assets (
        id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        bytes BLOB NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type = 'image/png')
      ) STRICT;
      CREATE INDEX template_assets_owner ON template_assets(template_id);
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
