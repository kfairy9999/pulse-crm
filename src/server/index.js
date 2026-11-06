import { existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import { createDatabase } from './db.js';
import { seedSampleData } from './seed.js';
import { createApp } from './app.js';

if (existsSync('.env')) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a number from 0 to 65535.');
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) console.warn('Warning: this MVP has no authentication. Binding beyond localhost exposes your CRM to the network.');
const db = createDatabase();
if (process.env.SEED_SAMPLE_DATA !== 'false') seedSampleData(db);
const app = createApp({ db });
const server = app.listen(port, host, () => {
  const address = server.address();
  console.log(`Pulse CRM is ready at http://${host}:${address.port}`);
  console.log(`SQLite: ${process.env.DATABASE_PATH || './data/pulse.db'}`);
  console.log('Local single-user MVP. No external messages or calendar invites are sent.');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing Pulse CRM.`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
