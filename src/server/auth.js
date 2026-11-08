import express from 'express';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { transaction } from './db.js';

const DUMMY_HASH = hashPassword('not-a-user-password');
export const cookieNames = { session: '__Host-pulse_session', csrf: '__Host-pulse_csrf' };

export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function equal(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password, record) {
  try {
    const [scheme, n, r, p, salt, hash] = record.split('$');
    if (scheme !== 'scrypt' || [n, r, p].some((v) => !/^\d+$/.test(v))) throw new Error();
    const expected = Buffer.from(hash, 'base64');
    const actualSalt = Buffer.from(salt, 'base64');
    if (actualSalt.toString('base64') !== salt || expected.toString('base64') !== hash || expected.length !== 64 || actualSalt.length !== 16 || Number(n) !== 16384 || Number(r) !== 8 || Number(p) !== 1) throw new Error();
    const actual = scryptSync(password, actualSalt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return expected.equals(actual);
  } catch { return false; }
}
export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* Reject malformed authentication cookies. */ }
  }
  return cookies;
}
function cookie(name, value, secure, expires) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; ${secure ? 'Secure; ' : ''}Expires=${expires.toUTCString()}`;
}
function csrfCookie(value, secure, expires) { return `${cookieNames.csrf}=${encodeURIComponent(value)}; Path=/; SameSite=Strict; ${secure ? 'Secure; ' : ''}Expires=${expires.toUTCString()}`; }
function clearCookie(name, secure) { return cookie(name, '', secure, new Date(0)); }
export function setSession(res, token, csrf, expires, secure) {
  res.append('Set-Cookie', cookie(cookieNames.session, token, secure, expires));
  res.append('Set-Cookie', csrfCookie(csrf, secure, expires));
}
export function clearSession(res, secure) {
  res.append('Set-Cookie', clearCookie(cookieNames.session, secure));
  res.append('Set-Cookie', csrfCookie('', secure, new Date(0)));
}
export function createSession(db, res, userId, ttlDays, secure) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 86400000);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(digest(token), userId, digest(csrf), expires.toISOString(), now.toISOString(), now.toISOString());
  setSession(res, token, csrf, expires, secure);
  return { user: db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId), expiresAt: expires.toISOString() };
}
export function getSession(db, req) {
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies[cookieNames.session]) return null;
  const session = db.prepare('SELECT sessions.*, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash = ?').get(digest(cookies[cookieNames.session]));
  if (!session || session.expires_at <= new Date().toISOString()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
    return null;
  }
  return { rawToken: cookies[cookieNames.session], ...session, csrfToken: cookies[cookieNames.csrf] || '' };
}
export function validCsrf(session, req) {
  const supplied = req.get('x-csrf-token');
  return Boolean(session?.csrfToken && supplied && equal(digest(session.csrfToken), session.csrf_hash) && equal(session.csrfToken, supplied));
}
export function isSecureRequest(req) { return req.secure; }
export function isLoopback(req) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress); }
export function createOwner(db, email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) return 'Use 12 to 256 characters for your password.';
  const now = new Date().toISOString();
  transaction(db, () => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (count) throw Object.assign(new Error('Workspace setup is closed.'), { status: 403 });
    db.prepare('INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), email.trim().toLowerCase(), hashPassword(password), now, now);
  });
  return null;
}
function sameOrigin(req, appOrigin) {
  const source = req.get('origin') || req.get('referer');
  if (!source) return false;
  try {
    const origin = new URL(source).origin;
    return origin === (appOrigin || `${req.protocol}://${req.get('host')}`);
  } catch { return false; }
}
export function createAuthRouter({ db, ttlDays, appOrigin, production, setupToken }) {
  const router = express.Router();
  const attempts = new Map();
  const limited = (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const state = attempts.get(key);
    if (state?.until > now) return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
    req.authAttempts = state?.expires > now ? state : { count: 0, expires: now + 900000 };
    if (attempts.size > 10000) for (const [ip, value] of attempts) if (value.expires < now && (!value.until || value.until < now)) attempts.delete(ip);
    next();
  };
  const failed = (req) => {
    req.authAttempts.count += 1;
    if (req.authAttempts.count >= 8) req.authAttempts.until = Date.now() + 900000;
    attempts.set(req.ip, req.authAttempts);
  };
  const origin = (req, res, next) => {
    if (!sameOrigin(req, appOrigin)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    next();
  };
  router.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'JSON content is required.' });
    express.json({ limit: '8kb' })(req, res, next);
  });
  router.use((req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : origin(req, res, next));
  router.get('/session', (req, res) => {
    if (production && !req.secure) return res.status(403).json({ error: 'Secure HTTPS is required.' });
    const session = getSession(db, req);
    const user = session ? { id: session.user_id, email: session.email } : null;
    res.json({ authenticated: Boolean(session), user, setupRequired: db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0 });
  });
  router.post('/setup', limited, (req, res) => {
    if (!isLoopback(req) && (!production || !req.secure)) return res.status(403).json({ error: 'Secure HTTPS is required.' });
    if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0) return res.status(403).json({ error: 'Workspace setup is closed.' });
    if (!setupToken && !isLoopback(req)) return res.status(403).json({ error: 'Workspace setup is closed until a new setup key is configured.' });
    if (setupToken && (typeof req.body?.setupToken !== 'string' || !equal(req.body.setupToken, setupToken))) {
      failed(req);
      return res.status(403).json({ error: 'Email, password, or setup key is incorrect.' });
    }
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = req.body?.password;
    const invalid = createOwner(db, email, password);
    if (invalid) { if (!invalid.includes('closed')) failed(req); return res.status(invalid.includes('closed') ? 403 : 400).json({ error: invalid }); }
    res.status(201).json({ user: createSession(db, res, db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase()).id, ttlDays, isSecureRequest(req)).user });
  });
  router.post('/login', limited, (req, res) => {
    if (production && !req.secure) return res.status(403).json({ error: 'Secure HTTPS is required.' });
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' && req.body.password.length <= 256 ? req.body.password : '';
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
    if (!verifyPassword(password, user?.password_hash || DUMMY_HASH)) { failed(req); return res.status(401).json({ error: 'Email or password is incorrect.' }); }
    attempts.delete(req.ip);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    res.json(createSession(db, res, user.id, ttlDays, isSecureRequest(req)));
  });
  router.post('/logout', (req, res) => {
    const session = getSession(db, req);
    if (!session) return res.status(401).json({ error: 'Please sign in to continue.' });
    if (!validCsrf(session, req)) return res.status(403).json({ error: 'Your security token is invalid. Please refresh and try again.' });
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
    clearSession(res, isSecureRequest(req));
    res.status(204).end();
  });
  return router;
}
export function requireAuth(db) {
  return (req, res, next) => {
    const session = getSession(db, req);
    if (!session) return res.status(401).json({ error: 'Please sign in to continue.' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && !validCsrf(session, req)) return res.status(403).json({ error: 'Your security token is invalid. Please refresh and try again.' });
    req.authSession = session;
    next();
  };
}
