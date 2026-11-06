import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../../src/worker.js";

function runtime(overrides = {}) {
  return new Proxy(env, {
    get(target, key) {
      if (Object.prototype.hasOwnProperty.call(overrides, key))
        return overrides[key];
      if (key === "ASSETS") return undefined;
      return Reflect.get(target, key);
    },
  });
}
function raw(path, init, binding = env) {
  return worker.fetch(new Request(`https://pulse.test${path}`, init), binding);
}
async function bytes(response) {
  return new Uint8Array(await response.arrayBuffer());
}
function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i++) if (left[i] !== right[i]) return false;
  return true;
}

describe("bundled assets match the static-assets binding", () => {
  it("serves the same shell, MIME, CSP, and immutable hashed files without ASSETS", async () => {
    const bundled = runtime();
    const signin = await raw("/signin");
    const bundledSignin = await raw("/signin", undefined, bundled);
    expect(bundledSignin.status).toBe(signin.status);
    expect(bundledSignin.headers.get("content-type")).toBe(
      signin.headers.get("content-type"),
    );
    expect(bundledSignin.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(bundledSignin.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    const shell = new TextDecoder().decode(await bytes(signin));
    expect(sameBytes(await bytes(bundledSignin), new TextEncoder().encode(shell))).toBe(
      true,
    );
    expect(shell).toContain('id="root"');
    expect(shell).not.toContain("owner@example.test");
    const script = shell.match(/src="(\/assets\/[^"]+\.js)"/)[1];
    const style = shell.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
    for (const asset of [script, style].filter(Boolean)) {
      const fromBinding = await raw(asset);
      const fromBundle = await raw(asset, undefined, bundled);
      expect(fromBundle.status).toBe(200);
      expect(fromBundle.headers.get("content-type")).toBe(
        fromBinding.headers.get("content-type"),
      );
      expect(fromBundle.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(fromBinding.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(fromBundle.headers.get("x-content-type-options")).toBe("nosniff");
      expect(sameBytes(await bytes(fromBundle), await bytes(fromBinding))).toBe(
        true,
      );
      const head = await raw(asset, { method: "HEAD" }, bundled);
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toBe(
        fromBundle.headers.get("content-type"),
      );
      expect(head.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect((await bytes(head)).byteLength).toBe(0);
    }
  });
  it("keeps the allowlist closed when the asset binding is absent", async () => {
    const bundled = runtime();
    expect((await raw("/", undefined, bundled)).status).toBe(302);
    expect((await raw("/api/contacts", undefined, bundled)).status).toBe(401);
    expect((await raw("/api/health", undefined, bundled)).status).toBe(200);
    for (const path of [
      "/unknown",
      "/404.html",
      "/index.html",
      "/.dev.vars",
      "/src/worker.js",
      "/src/generated/asset-map.js",
      "/assets/../index.html",
      "/assets/not-a-real-file.js",
      "/assets/not-a-real-file.js.map",
    ])
      expect((await raw(path, undefined, bundled)).status).not.toBe(200);
    const script = (
      await (await raw("/signin", undefined, bundled)).text()
    ).match(/src="(\/assets\/[^"]+\.js)"/)[1];
    expect(
      (await raw(script, { method: "POST" }, bundled)).status,
    ).not.toBe(200);
    expect(
      (
        await raw(
          "/signin",
          undefined,
          runtime({ AUTH_PEPPER: "" }),
        )
      ).status,
    ).toBe(503);
  });
});
