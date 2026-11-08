import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createDatabase } from '../src/server/db.js';
import { createApp } from '../src/server/app.js';

export async function createFixture(t, { db: suppliedDb, auth = { enabled: false }, forwardedProto, origin, originAuto = false, staticDir = null } = {}) {
  let filename;
  if (!suppliedDb) filename = join(process.cwd(), 'data', `test-${process.pid}-${randomUUID()}.db`);
  const db = suppliedDb || createDatabase(filename);
  const app = createApp({ db, staticDir, auth });
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
  const request = async (path, { method = 'GET', body, expectedStatus, session, csrf, contentType = 'application/json', origin: requestOrigin = origin, forwardedProto: protocol = forwardedProto } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': contentType, Accept: 'application/json', ...(session ? { Cookie: session } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(protocol ? { 'X-Forwarded-Proto': protocol } : {}), ...(requestOrigin || originAuto ? { Origin: requestOrigin || (protocol ? `${protocol}://` : 'http://') + `127.0.0.1:${server.address().port}` } : {}) },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    const contentTypeHeader = response.headers.get('content-type') || '';
    const payload = response.status === 204 ? {} : contentTypeHeader.includes('application/json') ? await response.json() : await response.text();
    const cookiePairs = response.headers.getSetCookie().map((value) => value.split(';')[0]);
    const cookie = cookiePairs.length ? cookiePairs.join('; ') : session;
    if (expectedStatus !== undefined) assert.equal(response.status, expectedStatus, JSON.stringify(payload));
    return { response, payload, status: response.status, cookie, csrf: cookiePairs.find((value) => value.startsWith('__Host-pulse_csrf='))?.split('=').slice(1).join('=') || csrf };
  };
  const contact = async (values = {}) => (await request('/contacts', { method: 'POST', expectedStatus: 201, body: { first_name: 'Test', last_name: 'Contact', email: `test-${Date.now()}-${Math.random()}@example.test`, company: 'Example Company', tags: ['test'], ...values } })).payload.contact;
  return { request, base, db, contact };
}
