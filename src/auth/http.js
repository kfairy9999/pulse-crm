import { DomainError } from "../shared.js";
import { hashedToken } from "./password.js";
export { one } from "../d1.js";
export const cookieNames = {
  session: "__Host-pulse_session",
  csrf: "__Host-pulse_csrf",
};
export function parseCookies(header) {
  header = typeof header === "string" ? header : "";
  const cookies = {};
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    try {
      cookies[part.slice(0, at).trim()] = decodeURIComponent(
        part.slice(at + 1).trim(),
      );
    } catch {
      /* Ignore malformed cookies. */
    }
  }
  return cookies;
}
const cookie = (name, value, seconds = 0, httpOnly = false) =>
  `${name}=${encodeURIComponent(value)}; Path=/; ${httpOnly ? "HttpOnly; " : ""}SameSite=Strict; Secure; Max-Age=${seconds}; Expires=${value ? new Date(Date.now() + seconds * 1000).toUTCString() : new Date(0).toUTCString()}`;
export function sessionCookies(token, csrf, seconds = 604800) {
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    cookie(cookieNames.session, token, seconds, true),
  );
  headers.append("Set-Cookie", cookie(cookieNames.csrf, csrf, seconds));
  return headers;
}
export const clearCookies = () => {
  const headers = new Headers();
  headers.append("Set-Cookie", cookie(cookieNames.session, "", 0, true));
  headers.append("Set-Cookie", cookie(cookieNames.csrf, "", 0));
  return headers;
};
export const securityHeaders = () => ({
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
});
function responsePathname(response, request) {
  try {
    if (request) return new URL(request.url).pathname;
    if (response.url) return new URL(response.url).pathname;
  } catch {
    /* A malformed URL cannot select the hashed-asset cache policy. */
  }
  return "/";
}
export function secureResponse(response, isApi = false, request) {
  const result = new Response(response.body, response);
  for (const [k, v] of Object.entries(securityHeaders()))
    result.headers.set(k, v);
  // Hashed /assets/ responses are immutable. Constructed module responses have
  // an empty URL, so the request path selects the same policy as an asset fetch.
  const hashedAsset =
    !isApi &&
    result.status < 400 &&
    /assets\//i.test(responsePathname(result, request));
  result.headers.set(
    "Cache-Control",
    hashedAsset ? "public, max-age=31536000, immutable" : "private, no-store",
  );
  if (isApi)
    result.headers.set("Content-Type", "application/json; charset=utf-8");
  return result;
}
export const json = (value, status = 200, headers) => {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "private, no-store");
  return new Response(JSON.stringify(value), { status, headers: h });
};
export function validateOrigin(request, env) {
  if (env.PULSE_RUNTIME === "development")
    return (
      new URL(request.url).protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)
    );
  try {
    const expected = new URL(env.APP_ORIGIN);
    return (
      expected.protocol === "https:" &&
      expected.origin === env.APP_ORIGIN &&
      !expected.username &&
      !expected.password &&
      new URL(request.url).origin === expected.origin
    );
  } catch {
    return false;
  }
}
export function sameOrigin(request) {
  try {
    return (
      new URL(
        request.headers.get("Origin") ||
          request.headers.get("Referer") ||
          "invalid:",
      ).origin === new URL(request.url).origin
    );
  } catch {
    return false;
  }
}
export async function getSession(db, request) {
  const raw = parseCookies(request.headers.get("Cookie"))[cookieNames.session];
  if (!raw) return null;
  const tokenHash = await hashedToken(raw),
    session = await db
      .prepare(
        "SELECT sessions.*,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=?",
      )
      .bind(tokenHash)
      .first();
  if (!session || session.expires_at <= new Date().toISOString()) return null;
  return {
    ...session,
    rawToken: raw,
    csrfToken:
      parseCookies(request.headers.get("Cookie"))[cookieNames.csrf] || "",
  };
}
export async function validCsrf(session, request) {
  const supplied = request.headers.get("X-CSRF-Token");
  if (!session?.csrfToken || !supplied) return false;
  try {
    const expected = new TextEncoder().encode(
      await hashedToken(session.csrfToken),
    );
    return (
      expected.length === session.csrf_hash.length &&
      crypto.subtle.timingSafeEqual(
        expected,
        new TextEncoder().encode(session.csrf_hash),
      ) &&
      crypto.subtle.timingSafeEqual(
        new TextEncoder().encode(supplied),
        new TextEncoder().encode(session.csrfToken),
      )
    );
  } catch {
    return false;
  }
}
export function needJson(request) {
  if (request.method === "DELETE" && !request.headers.has("Content-Type"))
    return;
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new DomainError("JSON content is required.", 415);
}
export async function readJson(request, limit = 200 * 1024) {
  if (Number(request.headers.get("Content-Length") || 0) > limit)
    throw new DomainError("Request body is too large.", 413);
  const reader = request.body?.getReader();
  let size = 0;
  const chunks = [];
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new DomainError("Request body is too large.", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(data);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new DomainError("Request body must be a valid JSON object.");
  }
}
export const sourceIp = (request, env) => {
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) return ip;
  if (env.PULSE_RUNTIME === "development" && env.TEST_CLIENT_IP)
    return env.TEST_CLIENT_IP;
  throw new DomainError(
    "The verified request IP is unavailable. Check the Cloudflare connection.",
    503,
  );
};
