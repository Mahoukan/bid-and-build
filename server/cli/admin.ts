import { adminNameSchema, passwordSchema } from '../../shared/admin.js';
import { createAdministrator, resetAdministratorPassword } from '../admin/accounts.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { privatePrompt } from './private-prompt.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['create', 'reset-password'].includes(args[0]!)) throw new Error('Use npm run admin:create or npm run admin:reset-password without credential arguments.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Use an interactive terminal (docker exec -it in a container). Credentials must not be piped.');
  const config = loadConfig();
  console.log('Administrator setup. Input is hidden. No room or player credentials are changed.');
  const name = adminNameSchema.safeParse(await privatePrompt('Administrator name (3–64 letters, digits, . _ -): '));
  if (!name.success) throw new Error('Invalid administrator name. Use 3–64 letters, digits, dot, underscore or hyphen, starting with a letter or digit.');
  const password = passwordSchema.safeParse(await privatePrompt('New password (15–128 characters): '));
  if (!password.success) throw new Error('Password must contain 15–128 characters.');
  if (await privatePrompt('Repeat new password: ') !== password.data) throw new Error('Passwords did not match. Nothing was changed.');
  if (args[0] === 'reset-password' && await privatePrompt('Type RESET to revoke this administrator’s sessions and replace the password: ') !== 'RESET') throw new Error('Cancelled. Nothing was changed.');
  const { db } = openDatabase(config.dataDir);
  try {
    if (args[0] === 'create') await createAdministrator(db, name.data, password.data);
    else await resetAdministratorPassword(db, name.data, password.data);
  } finally { db.close(); }
  console.log(args[0] === 'create' ? 'Administrator created. Sign in at /admin.' : 'Password replaced; this administrator’s previous sessions are revoked.');
}
void main().catch((error: unknown) => {
  // Only known, value-free operational messages are printed; no stack/arguments.
  const message = error instanceof Error && !('code' in error) ? error.message : 'Administrator update failed. Check configuration and database access.';
  console.error(message); process.exitCode = 1;
});
