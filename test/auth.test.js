import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from './helpers.js';
import { hashPassword, verifyPassword } from '../src/server/auth.js';

test('password hashes are salted scrypt records and reject wrong/tampered input', () => {
  const a = hashPassword('a-test-only-password');
  assert.notEqual(a, hashPassword('a-test-only-password'));
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.equal(a.length > 100, true);
  assert.equal(verifyPassword('a-test-only-password', a), true);
  assert.equal(verifyPassword('wrong-password', a), false);
  assert.equal(verifyPassword('a-test-only-password', `${a}tampered`), false);
  assert.equal(verifyPassword('a-test-only-password', 'bad-record'), false);
});

test('authenticated production requires setup key, protects CRM, issues secure sessions, enforces CSRF, expirations and logout', async (t) => {
  const { request, db } = await createFixture(t, { auth: { enabled: true, production: true, trustProxy: true, appOrigin: 'https://crm.example.test', setupToken: 'test-setup-token-0123456789abcdef-0123456789', ttlDays: 7 }, forwardedProto: 'https', origin: 'https://crm.example.test' });
  await request('/health', { expectedStatus: 200 });
  await request('/auth/session', { expectedStatus: 403, forwardedProto: 'http' });
  await request('/contacts', { expectedStatus: 401 });
  await request('/metadata', { expectedStatus: 401 });
  assert.equal((await request('/auth/session')).payload.setupRequired, true);
  await request('/auth/setup', { method: 'POST', expectedStatus: 415, contentType: 'text/plain', body: 'abc' });
  await request('/auth/setup', { method: 'POST', expectedStatus: 403, origin: 'https://attacker.example', body: {} });
  await request('/auth/setup', { method: 'POST', expectedStatus: 403, body: { email: 'owner@example.test', password: 'long-password-for-tests', setupToken: 'wrong' } });
  await request('/auth/setup', { method: 'POST', expectedStatus: 400, body: { email: 'owner@example.test', password: 'short', setupToken: 'test-setup-token-0123456789abcdef-0123456789' } });
  const signup = await request('/auth/setup', { method: 'POST', expectedStatus: 201, body: { email: 'OWNER@example.test', password: 'long-password-for-tests', setupToken: 'test-setup-token-0123456789abcdef-0123456789' } });
  assert.equal(signup.payload.user.email, 'owner@example.test');
  const user = db.prepare('SELECT * FROM users').get();
  assert.doesNotMatch(user.password_hash, /long-password-for-tests/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 1);
  assert.equal(user.password_hash.startsWith('scrypt$'), true);
  assert.match(db.prepare('SELECT token_hash FROM sessions').get().token_hash, /^[a-f0-9]{64}$/);
  assert.match(signup.response.headers.get('set-cookie'), /__Host-pulse_session=.*HttpOnly.*SameSite=Strict.*Secure/);
  let session = signup.cookie;
  let csrf = signup.csrf;
  await request('/auth/setup', { method: 'POST', expectedStatus: 403, body: { email: 'other@example.test', password: 'long-password-for-tests', setupToken: 'test-setup-token-0123456789abcdef-0123456789' } });
  await request('/auth/setup', { method: 'POST', expectedStatus: 403, setupToken: false, body: { email: 'other@example.test', password: 'long-password-for-tests' } });
  await request('/dashboard', { expectedStatus: 200, session });
  const list = await request('/contacts', { expectedStatus: 200, session });
  assert.deepEqual(list.payload.contacts, []);
  const badCsrf = await request('/contacts', { method: 'POST', expectedStatus: 403, session, csrf: 'wrong', body: { first_name: 'No', last_name: 'Write' } });
  assert.match(badCsrf.payload.error, /security token/);
  const created = await request('/contacts', { method: 'POST', expectedStatus: 201, session, csrf, body: { first_name: 'Private', last_name: 'Contact', email: 'private@example.test' } });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM contacts').get().count, 1);
  db.prepare('UPDATE sessions SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
  await request('/contacts', { expectedStatus: 401, session });
  const login = await request('/auth/login', { method: 'POST', expectedStatus: 200, body: { email: 'owner@example.test', password: 'long-password-for-tests' } });
  session = login.cookie; csrf = login.csrf;
  await request('/auth/login', { method: 'POST', expectedStatus: 401, body: { email: 'unknown@example.test', password: 'wrong-password' } });
  await request('/auth/logout', { method: 'POST', expectedStatus: 403, session, csrf: 'wrong' });
  await request('/contacts', { expectedStatus: 200, session });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 1);
  await request('/auth/logout', { method: 'POST', expectedStatus: 204, session, csrf });
  await request('/contacts', { expectedStatus: 401, session });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM contacts WHERE id = ?').get(created.payload.contact.id).count, 1);
});

test('login attempt throttling has generic credential and setup key errors', async (t) => {
  const { request } = await createFixture(t, { auth: { enabled: true, production: false, trustProxy: false, ttlDays: 7 }, originAuto: true });
  for (let index = 0; index < 8; index += 1) await request('/auth/login', { method: 'POST', expectedStatus: 401, body: { email: 'wrong@example.test', password: 'not-the-password' } });
  await request('/auth/login', { method: 'POST', expectedStatus: 429, body: { email: 'wrong@example.test', password: 'not-the-password' } });
  const response = await request('/auth/login', { method: 'POST', expectedStatus: 429, body: {} });
  assert.doesNotMatch(JSON.stringify(response.payload), /not found/);
});


test('authenticated owner can return after setup-token removal, but public re-registration stays closed', async (t) => {
  const fixture = await createFixture(t, { auth: { enabled: true, production: false, trustProxy: false, ttlDays: 7 }, originAuto: true });
  await fixture.request('/auth/setup', { method: 'POST', expectedStatus: 201, body: { email: 'owner@example.test', password: 'long-password-for-tests' } });
  const { db } = fixture;
  const replacement = (await import('../src/server/app.js')).createApp({ db, staticDir: null, auth: { enabled: true, production: false, trustProxy: false, ttlDays: 7 } });
  const server = replacement.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base.slice(0, -4) }, body: JSON.stringify(body) });
  const login = await call('/auth/login', { email: 'owner@example.test', password: 'long-password-for-tests' });
  assert.equal(login.status, 200);
  const secondSetup = await call('/auth/setup', { email: 'attacker@example.test', password: 'another-password-value' });
  assert.equal(secondSetup.status, 403);
});
