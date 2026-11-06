// No account/API login: local Wrangler runtime + disposable D1 only.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { deriveCredential } from "../src/auth/password.js";
const origin = "http://127.0.0.1:8799";
const config = process.env.PULSE_SMOKE_CONFIG || "wrangler.test.jsonc";
const database = process.env.PULSE_SMOKE_DATABASE || "local-test-only";
const bundled = process.env.PULSE_SMOKE_BUNDLED === "1";
const setupToken = "LOCAL_SMOKE_TEST_ONLY_NOT_A_PRODUCTION_SECRET";
const storage = mkdtempSync(path.join(tmpdir(), "pulse-crm-smoke-"));
const migrated = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "migrations",
    "apply",
    database,
    "--local",
    "--config",
    config,
    "--persist-to",
    storage,
  ],
  { stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
if (migrated.status !== 0) {
  rmSync(storage, { recursive: true, force: true });
  throw new Error("Disposable local D1 migration failed.");
}
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--local",
    "--config",
    config,
    "--ip",
    "127.0.0.1",
    "--port",
    "8799",
    "--persist-to",
    storage,
    "--var",
    `APP_ORIGIN:${origin}`,
    "--var",
    "PULSE_RUNTIME:development",
    "--var",
    "AUTH_PEPPER:TF9URVNUX09OTFlfQUFBQUFBQUFBQUFBQUFBQUFBQUE",
    "--var",
    `SETUP_TOKEN:${setupToken}`,
  ],
  {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
let output = "";
child.stdout.on("data", (v) => (output += v));
child.stderr.on("data", (v) => (output += v));
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null)
      throw new Error("Local Wrangler exited before readiness.");
    if (output.includes("Ready on")) {
      ready = true;
      break;
    }
    await delay(100);
  }
  assert(ready, "Local Wrangler did not reach readiness.");
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  const anonymous = await fetch(`${origin}/api/contacts`);
  assert.equal(anonymous.status, 401);
  const root = await fetch(origin, { redirect: "manual" });
  assert.equal(root.status, 302);
  const signin = await fetch(`${origin}/signin`);
  assert.equal(signin.status, 200);
  const shell = await signin.text();
  assert.match(shell, /id="root"/);
  if (bundled) {
    const script = shell.match(/src="(\/assets\/[^"]+\.js)"/)[1];
    const style = shell.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
    for (const [asset, mime] of [
      [script, /^text\/javascript/],
      [style, /^text\/css/],
    ].filter(([asset]) => asset)) {
      const response = await fetch(origin + asset);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", mime);
      assert.equal(
        response.headers.get("cache-control"),
        "public, max-age=31536000, immutable",
      );
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
    assert.notEqual((await fetch(`${origin}/404.html`)).status, 200);
    assert.notEqual(
      (await fetch(`${origin}/assets/not-a-real-file.js`)).status,
      200,
    );
  }
  const setup = await fetch(`${origin}/api/auth/setup`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "127.0.0.1",
    },
    body: JSON.stringify({
      email: "smoke@example.test",
      ...(await deriveCredential("Local Smoke Test Password Only!")),
      setupToken,
    }),
  });
  assert.equal(setup.status, 201);
  const cookies = setup.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
    csrf = decodeURIComponent(
      setup.headers
        .getSetCookie()
        .find((c) => c.startsWith("__Host-pulse_csrf="))
        .split(";")[0]
        .split("=")[1],
    );
  const response = await fetch(`${origin}/api/contacts`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookies,
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({ first_name: "Local smoke record" }),
  });
  assert.equal(response.status, 201);
  assert.equal(
    (
      await (
        await fetch(`${origin}/api/contacts`, { headers: { Cookie: cookies } })
      ).json()
    ).total,
    1,
  );
  console.log(
    "Local Wrangler HTTP smoke passed: health, sign-in shell, anonymous API denial, owner setup, CSRF-protected D1 create/read.",
  );
} catch (e) {
  console.error(output);
  throw e;
} finally {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3000),
  ]);
  rmSync(storage, { recursive: true, force: true });
}
