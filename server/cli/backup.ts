import { resolve } from 'node:path';
import { backupDatabase, restoreDatabase } from '../db/backup.js';
import { loadConfig } from '../config.js';

async function main() {
  const [action, source, destination, ...extra] = process.argv.slice(2);
  if (extra.length || !source || !['backup', 'restore'].includes(action ?? '') || (action === 'backup' ? destination !== undefined : !destination)) {
    throw new Error('Use npm run db:backup -- NEW_BACKUP_DIR or npm run db:restore -- BACKUP_DIR NEW_DATA_DIR.');
  }
  const config = loadConfig();
  if (action === 'backup') {
    await backupDatabase(config.dataDir, resolve(source));
    console.log('Consistent database and content-image backup verified. Protect it as private data and copy it off-server.');
  } else {
    await restoreDatabase(resolve(source), resolve(destination!));
    console.log('Restore verified in the new directory. Stop the old server before selecting this DATA_DIR. Keep the same SESSION_SECRET; recovered games resume paused.');
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error && !('code' in error) ? error.message : 'Backup/restore failed. Check paths, access and free space. No existing destination was overwritten. A new incomplete directory may remain; do not use it.');
  process.exitCode = 1;
});
