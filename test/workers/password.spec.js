import { it, expect } from "vitest";
import { env } from "cloudflare:workers";
import {
  deriveCredential,
  credentialRecord,
  verifyCredential,
  authPepper,
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
