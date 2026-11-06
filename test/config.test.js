import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/server/config.js';

const required = { REQUIRE_SECURE_DEPLOYMENT: 'true', AUTH_ENABLED: 'true', APP_ORIGIN: 'https://pulse-crm.onrender.com', TRUST_PROXY: 'true', COOKIE_SECURE: 'true', HOST: '0.0.0.0', DATABASE_PATH: '/var/data/pulse.db', SETUP_TOKEN: 'a-provider-generated-test-value-1234567890', SESSION_TTL_DAYS: '7' };
const keys = ['REQUIRE_SECURE_DEPLOYMENT', 'AUTH_ENABLED', 'APP_ORIGIN', 'TRUST_PROXY', 'COOKIE_SECURE', 'HOST', 'DATABASE_PATH', 'SETUP_TOKEN', 'SESSION_TTL_DAYS'];
function withEnv(t, values) { const backup = Object.fromEntries(keys.map((key) => [key, process.env[key]])); for (const key of keys) delete process.env[key]; for (const [key, value] of Object.entries(values)) { if (value !== undefined) process.env[key] = value; } t.after(() => { for (const key of keys) { if (backup[key] === undefined) delete process.env[key]; else process.env[key] = backup[key]; } }); }
test('production accepts secure, single-owner, durable SQLite configuration', (t) => { withEnv(t, required); assert.equal(loadConfig().enabled, true); });
test('production restarts after the one-time setup key is removed', (t) => { withEnv(t, { ...required, SETUP_TOKEN: undefined }); assert.equal(loadConfig().enabled, true); });
test('production rejects a short setup key when configured', (t) => { withEnv(t, { ...required, SETUP_TOKEN: 'short' }); assert.throws(loadConfig); });
for (const key of ['APP_ORIGIN', 'TRUST_PROXY', 'COOKIE_SECURE', 'DATABASE_PATH']) test(`production fails closed without safe ${key}`, (t) => { withEnv(t, { ...required, [key]: undefined }); assert.throws(loadConfig); });
test('production refuses an explicitly disabled authentication setting', (t) => { withEnv(t, { ...required, AUTH_ENABLED: 'false' }); assert.throws(loadConfig); });
test('production rejects HTTP, paths and ephemeral storage', (t) => { for (const value of ['http://example.test', 'https://example.test/path', 'https://example.test/']) { withEnv(t, { ...required, APP_ORIGIN: value }); assert.throws(loadConfig); } });
