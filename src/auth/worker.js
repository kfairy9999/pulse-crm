import { DomainError } from "../shared.js";
import { id, now, one } from "../d1.js";
import {
  authPepper,
  credentialRecord,
  verifyCredential,
  randomToken,
  hashedToken,
  attemptKey,
  fakeSalt,
} from "./password.js";
import {
  sourceIp,
  validCsrf,
  getSession,
  sessionCookies,
  clearCookies,
  json,
} from "./http.js";
const windowMs = 15 * 60 * 1000;
const ttl = (env) => {
  const days = Number(env.SESSION_TTL_DAYS || 7);
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new DomainError("Session duration is not configured.", 503);
  return days;
};
async function newSession(userId, env) {
  const token = randomToken(),
    csrf = randomToken(),
    stamp = now(),
    seconds = ttl(env) * 86400,
    expires = new Date(Date.now() + seconds * 1000).toISOString();
  return {
    token,
    csrf,
    expires,
    stmt: env.DB.prepare(
      "INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)",
    ).bind(
      await hashedToken(token),
      userId,
      await hashedToken(csrf),
      expires,
      stamp,
      stamp,
    ),
    headers: sessionCookies(token, csrf, seconds),
  };
}
async function keys(ip, email, env) {
  return [
    await attemptKey(`${ip}\n${email}`, env),
    await attemptKey(`global\0${ip}`, env),
  ];
}
async function assertAllowed(db, ip, email, env) {
  const [key, global] = await keys(ip, email, env),
    stamp = now();
  const active = await db
    .prepare(
      "SELECT COUNT(*) count FROM login_attempts WHERE subject_hash IN (?,?) AND blocked_until>?",
    )
    .bind(key, global, stamp)
    .first();
  if (active.count)
    throw new DomainError(
      "Too many attempts. Please try again in 15 minutes.",
      429,
    );
  return [key, global];
}
async function failedAttempt(db, key, limit) {
  const stamp = now(),
    cutoff = new Date(Date.now() - windowMs).toISOString(),
    until = new Date(Date.now() + windowMs).toISOString();
  const sql = `INSERT INTO login_attempts(subject_hash,attempt_count,window_started_at,blocked_until,updated_at) VALUES(?,1,?,NULL,?)
 ON CONFLICT(subject_hash) DO UPDATE SET attempt_count=CASE WHEN window_started_at<? THEN 1 ELSE attempt_count+1 END,
 window_started_at=CASE WHEN window_started_at<? THEN excluded.window_started_at ELSE window_started_at END,
 blocked_until=CASE WHEN window_started_at>=? AND attempt_count>=? THEN ? ELSE NULL END,updated_at=excluded.updated_at
 RETURNING attempt_count,blocked_until`;
  const result = await db
    .prepare(sql)
    .bind(key, stamp, stamp, cutoff, cutoff, cutoff, limit - 1, until)
    .first();
  if (
    result.attempt_count >= limit ||
    (result.blocked_until &&
      new Date(result.blocked_until).getTime() > Date.now())
  )
    throw new DomainError(
      "Too many attempts. Please try again in 15 minutes.",
      429,
    );
}
async function failed(db, key, ip, env) {
  await db
    .prepare("DELETE FROM login_attempts WHERE updated_at<?")
    .bind(new Date(Date.now() - windowMs).toISOString())
    .run();
  await failedAttempt(db, key, 8);
  await failedAttempt(db, await attemptKey(`global\0${ip}`, env), 32);
}
export async function handleAuth(request, env, { method, path, body }) {
  const db = env.DB;
  authPepper(env);
  if (method === "GET" && path === "/api/auth/session") {
    const session = await getSession(db, request);
    return json({
      passwordProtocol: "browser-pbkdf2-sha256-v1",
      authenticated: !!session,
      user: session ? { id: session.user_id, email: session.email } : null,
      setupRequired: !(await one(db, "SELECT 1 present FROM users LIMIT 1")),
    });
  }
  if (method === "POST" && path === "/api/auth/logout") {
    const session = await getSession(db, request);
    if (!session) throw new DomainError("Please sign in to continue.", 401);
    if (!(await validCsrf(session, request)))
      throw new DomainError(
        "Your security token is invalid. Please refresh and try again.",
        403,
      );
    await db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(session.token_hash)
      .run();
    return new Response(null, { status: 204, headers: clearCookies() });
  }
  if (method === "GET" && path === "/api/auth/challenge") {
    const email = (new URL(request.url).searchParams.get("email") || "")
      .trim()
      .toLowerCase();
    if (email.length > 254)
      throw new DomainError("Email or password is incorrect.", 401);
    const ip = sourceIp(request, env);
    await assertAllowed(db, ip, email, env);
    await failedAttempt(db, await attemptKey(`challenge\0${ip}`, env), 64);
    const user = await one(
      db,
      "SELECT password_salt FROM users WHERE email=? COLLATE NOCASE",
      email,
    );
    // Same shape and stable keyed fallback: challenge does not explicitly disclose account existence.
    return json({ salt: user?.password_salt || (await fakeSalt(email, env)) });
  }
  if (
    method !== "POST" ||
    !["/api/auth/login", "/api/auth/setup"].includes(path)
  )
    throw new DomainError("API route not found.", 404);
  const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "",
    salt = body.salt,
    ip = sourceIp(request, env);
  if (
    !email ||
    email.length > 254 ||
    typeof salt !== "string" ||
    salt.length !== 22
  )
    throw new DomainError("Email or password is incorrect.", 401);
  const [key, globalKey] = await assertAllowed(db, ip, email, env),
    user = await one(
      db,
      "SELECT * FROM users WHERE email=? COLLATE NOCASE",
      email,
    );
  if (path === "/api/auth/setup") {
    if (user || (await one(db, "SELECT 1 present FROM users LIMIT 1")))
      throw new DomainError("Workspace setup is closed.", 403);
    if (typeof env.SETUP_TOKEN !== "string" || env.SETUP_TOKEN.length < 32)
      throw new DomainError(
        "Workspace setup is closed until a provider-generated setup key is configured.",
        503,
      );
    const supplied = typeof body.setupToken === "string" ? body.setupToken : "",
      a = new TextEncoder().encode(env.SETUP_TOKEN),
      b = new TextEncoder().encode(supplied);
    if (a.length !== b.length || !crypto.subtle.timingSafeEqual(a, b)) {
      await failed(db, key, ip, env);
      throw new DomainError("Email, password, or setup key is incorrect.", 403);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new DomainError("Enter a valid email address.");
    if (typeof body.credential !== "string" || body.credential.length !== 43)
      throw new DomainError("A securely derived password is required.");
    const hash = await credentialRecord(body.credential, salt, env),
      userId = id(),
      stamp = now(),
      session = await newSession(userId, env);
    try {
      const result = await db.batch([
        db
          .prepare(
            "INSERT INTO app_metadata(key,value,created_at) VALUES('owner_setup','closed',?)",
          )
          .bind(stamp),
        db
          .prepare(
            "INSERT INTO users(id,email,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?)",
          )
          .bind(userId, email, hash, salt, stamp, stamp),
        session.stmt,
      ]);
      if (result[0].meta.changes !== 1)
        throw new DomainError("Workspace setup is closed.", 403);
    } catch (e) {
      if (String(e.message).includes("UNIQUE"))
        throw new DomainError("Workspace setup is closed.", 403);
      throw e;
    }
    return json(
      { user: { id: userId, email }, expiresAt: session.expires },
      201,
      session.headers,
    );
  }
  if (user) {
    // supplied.b argument is re-derived with the stored per-owner salt. Setup's stored comparison matches exactly that value.
    const valid = await verifyCredential(
      body.credential,
      salt,
      user.password_hash,
      env,
    );
    if (valid) {
      const session = await newSession(user.id, env);
      await db.batch([
        db
          .prepare("DELETE FROM sessions WHERE user_id=? OR expires_at<=?")
          .bind(user.id, now()),
        session.stmt,
        db
          .prepare("DELETE FROM login_attempts WHERE subject_hash IN (?,?)")
          .bind(key, globalKey),
      ]);
      return json(
        {
          user: { id: user.id, email: user.email },
          expiresAt: session.expires,
        },
        200,
        session.headers,
      );
    }
  }
  await failed(db, key, ip, env);
  throw new DomainError("Email or password is incorrect.", 401);
}
