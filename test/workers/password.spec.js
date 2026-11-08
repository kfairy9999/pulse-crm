import { it, expect } from "vitest";
import { env } from "cloudflare:workers";
import {
  deriveCredential,
  credentialRecord,
  verifyCredential,
  authPepper,
  decode64,
  encode64,
} from "../../src/auth/password.js";
it("server verifier is deterministic and rejects a different derived credential", async () => {
  const a = await deriveCredential("Correct Horse Battery Staple!"),
    record = await credentialRecord(a.credential, a.salt, env),
    b = await deriveCredential("Correct Horse Battery Staple!");
  expect(record).toBe(await credentialRecord(a.credential, a.salt, env));
  expect(record).not.toBe(await credentialRecord(b.credential, b.salt, env));
  expect(await verifyCredential(a.credential, a.salt, record, env)).toBe(true);
  expect(await verifyCredential(b.credential, b.salt, record, env)).toBe(false);
  expect(new TextDecoder().decode(authPepper(env).bytes)).toHaveLength(32);
});
it("accepts only canonical base64url credentials of the required length", () => {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index + 3);
  const canonical = encode64(bytes);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const nonCanonical = `${canonical.slice(0, -1)}${alphabet[alphabet.indexOf(canonical.at(-1)) + 1]}`;
  expect(canonical).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(Array.from(decode64(canonical, 32))).toEqual(Array.from(bytes));
  expect(nonCanonical).toMatch(/^[A-Za-z0-9]{43}$/);
  for (const value of [
    nonCanonical,
    `${canonical}=`,
    canonical.slice(0, 42),
    `${canonical.slice(0, 42)}+`,
    `${canonical.slice(0, 42)}.`,
  ])
    expect(() => decode64(value, 32)).toThrow("Invalid credential encoding.");
  expect(() =>
    authPepper({ AUTH_PEPPER_ID: "local-test-v1", AUTH_PEPPER: nonCanonical }),
  ).toThrow("Invalid credential encoding.");
  expect(
    Array.from(
      authPepper({ AUTH_PEPPER_ID: "local-test-v1", AUTH_PEPPER: canonical })
        .bytes,
    ),
  ).toEqual(Array.from(bytes));
});
