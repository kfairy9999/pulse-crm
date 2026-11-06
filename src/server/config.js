function envBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false.`);
  return value === 'true';
}
export function loadConfig() {
  const production = envBoolean('REQUIRE_SECURE_DEPLOYMENT', process.env.NODE_ENV === 'production');
  if (production && process.env.SEED_SAMPLE_DATA === 'true') throw new Error('Production cannot start with sample seeding enabled.');
  const enabled = envBoolean('AUTH_ENABLED', production);
  const setupToken = process.env.SETUP_TOKEN;
  const databasePath = process.env.DATABASE_PATH || './data/pulse.db';
  const trustProxy = envBoolean('TRUST_PROXY', false);
  const appOrigin = process.env.APP_ORIGIN;
  const ttlDays = Number(process.env.SESSION_TTL_DAYS || 7);
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 30) throw new Error('SESSION_TTL_DAYS must be an integer from 1 to 30.');
  if (production) {
    if (!enabled) throw new Error('Production cannot start with authentication disabled.');
    if (!appOrigin) throw new Error('Production requires an exact HTTPS APP_ORIGIN.');
    let origin;
    try { origin = new URL(appOrigin); } catch { throw new Error('APP_ORIGIN must be a valid origin.'); }
    if (origin.protocol !== 'https:' || origin.origin !== appOrigin || origin.username || origin.password) throw new Error('APP_ORIGIN must be an exact HTTPS origin without a path or credentials.');
    if (process.env.COOKIE_SECURE !== 'true') throw new Error('Production requires COOKIE_SECURE=true.');
    if (!trustProxy) throw new Error('Production requires TRUST_PROXY=true behind the hosting provider proxy.');
    if (process.env.COOKIE_SECURE !== 'true') throw new Error('Production requires COOKIE_SECURE=true.');
    if (process.env.DATABASE_PATH !== databasePath || !process.env.DATABASE_PATH?.startsWith('/var/data/')) throw new Error('Production requires DATABASE_PATH on the provider persistent volume mounted at /var/data.');
    if (databasePath.includes('..')) throw new Error('DATABASE_PATH is invalid.');
    if (setupToken !== undefined && setupToken.length < 32) throw new Error('SETUP_TOKEN must be a provider-generated value of at least 32 characters when configured.');
    const host = process.env.HOST || '127.0.0.1';
    if (['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Production requires HOST=0.0.0.0 to receive health checks.');
  }
  return { production, enabled, trustProxy, appOrigin, setupToken, ttlDays };
}
