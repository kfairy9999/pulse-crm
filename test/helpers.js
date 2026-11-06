import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createDatabase } from '../src/server/db.js';
import { createApp } from '../src/server/app.js';

export async function createFixture(t, { db: suppliedDb } = {}) {
  let filename;
  if (!suppliedDb) filename = join(process.cwd(), 'data', `test-${process.pid}-${randomUUID()}.db`);
  const db = suppliedDb || createDatabase(filename);
  const app = createApp({ db, staticDir: null });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (!suppliedDb) {
      db.close();
      [filename, `${filename}-wal`, `${filename}-shm`].forEach((file) => rmSync(file, { force: true }));
    }
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, { method = 'GET', body, expectedStatus } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    if (expectedStatus !== undefined) assert.equal(response.status, expectedStatus, JSON.stringify(payload));
    return { response, payload, status: response.status };
  };
  const contact = async (values = {}) => (await request('/contacts', { method: 'POST', expectedStatus: 201, body: { first_name: 'Test', last_name: 'Contact', email: `test-${Date.now()}-${Math.random()}@example.test`, company: 'Example Company', tags: ['test'], ...values } })).payload.contact;
  return { request, base, db, contact };
}
