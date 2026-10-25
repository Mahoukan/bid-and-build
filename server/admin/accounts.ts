import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { adminNameSchema } from '../../shared/admin.js';
import { hashPassword } from './passwords.js';

/** Used only by the interactive owner CLI and isolated test setup; no signup API. */
export async function createAdministrator(db: Database.Database, username: string, password: string) {
  const name = adminNameSchema.parse(username); const encoded = await hashPassword(password);
  if (db.prepare('SELECT 1 FROM admin_accounts WHERE username = ?').get(name)) throw new Error('That administrator name already exists. Use the reset command if needed.');
  const id = randomUUID();
  db.prepare('INSERT INTO admin_accounts (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, name, encoded, Date.now());
  return id;
}
export async function resetAdministratorPassword(db: Database.Database, username: string, password: string) {
  const name = adminNameSchema.parse(username); const encoded = await hashPassword(password);
  db.transaction(() => {
    const account = db.prepare('SELECT id FROM admin_accounts WHERE username = ? AND is_admin = 1').get(name) as { id: string } | undefined;
    if (!account) throw new Error('No administrator has that exact name. Nothing was changed.');
    db.prepare('UPDATE admin_accounts SET password_hash = ? WHERE id = ?').run(encoded, account.id);
    db.prepare('DELETE FROM admin_sessions WHERE account_id = ?').run(account.id);
  }).immediate();
}
