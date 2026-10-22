import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';

try {
  const { db, schemaVersion } = openDatabase(loadConfig().dataDir);
  db.close();
  console.log(`Database ready at schema version ${schemaVersion}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database migration failed.');
  process.exitCode = 1;
}
