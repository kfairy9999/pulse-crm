export const PASSWORD_SCHEME = "pbkdf2-sha256";
export const PASSWORD_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const bytes = (value) =>
  value instanceof Uint8Array ? value : new Uint8Array(value);
export const encode64 = (value) => {
  let text = "";
  for (const byte of bytes(value)) text += String.fromCharCode(byte);
  return btoa(text)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};
export function decode64(value, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("Invalid credential encoding.");
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    decoded = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (decoded.length !== length || encode64(decoded) !== value)
    throw new Error("Invalid credential encoding.");
  return decoded;
}
export async function deriveCredential(password, providedSalt) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256 ||
    encoder.encode(password).length > 1024
  )
    throw new Error("Use 12 to 256 characters for your password.");
  if (typeof crypto?.subtle?.deriveBits !== "function")
    throw new Error(
      "This browser cannot securely process your password. Use an updated browser.",
    );
  if (providedSalt !== undefined) decode64(providedSalt, 16);
  const salt =
      providedSalt === undefined
        ? crypto.getRandomValues(new Uint8Array(16))
        : decode64(providedSalt, 16),
    material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations: PASSWORD_ITERATIONS,
      },
      material,
      256,
    ),
  );
  return { credential: encode64(derived), salt: encode64(salt) };
}
export const randomToken = () =>
  encode64(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async (value) =>
  encode64(
    await crypto.subtle.digest(
      "SHA-256",
      typeof value === "string" ? encoder.encode(value) : bytes(value),
    ),
  );
export const hashedToken = sha256;
async function hmac(secret, domain, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prefix = encoder.encode(`pulse-crm/${domain}/v1\0`),
    part = bytes(value),
    joined = new Uint8Array(prefix.length + part.length);
  joined.set(prefix);
  joined.set(part, prefix.length);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, joined));
}
export const authPepper = (env) => {
  if (
    typeof env.AUTH_PEPPER_ID !== "string" ||
    !/^[a-z0-9-]{1,40}$/.test(env.AUTH_PEPPER_ID)
  )
    throw new Error("AUTH_PEPPER_ID is not configured.");
  return { id: env.AUTH_PEPPER_ID, bytes: decode64(env.AUTH_PEPPER, 32) };
};
export async function credentialRecord(credential, salt, env) {
  const derived = decode64(credential, 32);
  decode64(salt, 16);
  const pepper = authPepper(env),
    tag = await hmac(pepper.bytes, `credential/${pepper.id}`, derived);
  return `${PASSWORD_SCHEME}$${PASSWORD_ITERATIONS}$${salt}$${pepper.id}$${encode64(tag)}`;
}
export async function verifyCredential(credential, salt, record, env) {
  try {
    const [scheme, iterations, storedSalt, keyId, storedTag] =
      String(record).split("$");
    if (
      scheme !== PASSWORD_SCHEME ||
      Number(iterations) !== PASSWORD_ITERATIONS ||
      storedSalt !== salt ||
      keyId !== env.AUTH_PEPPER_ID
    )
      return false;
    const actual = await credentialRecord(credential, salt, env),
      actualTag = actual.split("$").at(-1);
    return crypto.subtle.timingSafeEqual(
      decode64(storedTag, 32),
      decode64(actualTag, 32),
    );
  } catch {
    return false;
  }
}
export async function attemptKey(subject, env) {
  return encode64(
    await hmac(
      authPepper(env).bytes,
      "attempt-subject",
      encoder.encode(subject),
    ),
  );
}

export async function fakeSalt(email, env) {
  return encode64(
    (
      await hmac(
        authPepper(env).bytes,
        "unknown-login-salt",
        encoder.encode(email),
      )
    ).slice(0, 16),
  );
}
