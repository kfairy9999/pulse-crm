import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createDatabase, transaction } from '../src/server/db.js';
import { seedSampleData } from '../src/server/seed.js';

if (existsSync('.env')) for (const [key, value] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) if (process.env[key] === undefined) process.env[key] = value;
const db = createDatabase();
try {
  transaction(db, () => {
    db.exec('DELETE FROM activities; DELETE FROM appointments; DELETE FROM tasks; DELETE FROM opportunities; DELETE FROM contact_notes; DELETE FROM contacts;');
    seedSampleData(db, { force: true });
  });
  console.log('Sample database reset. Stop the server before running this script when possible.');
} finally { db.close(); }
