// Build the multipart Worker package. Does not deploy and does not set secrets.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { bundledAssets } from "../src/generated/asset-map.js";
import {
  SHELL_PATH,
  contentTypeForPath,
  publicAsset,
} from "../src/static-assets.js";

const root = process.cwd();
const dryRunDir = path.join(root, ".wrangler", "bundle-dry-run");
const packageDir = path.join(root, "deploy", "cloudflare-upload");
const artifactDir = process.env.PULSE_ARTIFACT_DIR || path.join(root, ".wrangler", "worker-package-artifacts");
const origin = "https://pulse-crm.kfairley9999.workers.dev";
const accountId = "f0d8472cc77b71cb083b6b9824e909c3";
const databaseId = "7b391a6a-415e-4ad9-ae5d-eeaff7b3ded3";
const testPepper = "TF9URVNUX09OTFlfQUFBQUFBQUFBQUFBQUFBQUFBQUE";

const metadata = {
  main_module: "worker.js",
  compatibility_date: "2026-11-06",
  compatibility_flags: [],
  usage_model: "standard",
  logpush: false,
  keep_bindings: ["secret_text", "secret_key"],
  bindings: [
    { type: "d1", name: "DB", database_id: databaseId },
    { type: "plain_text", name: "APP_ORIGIN", text: origin },
    { type: "plain_text", name: "SESSION_TTL_DAYS", text: "7" },
    { type: "plain_text", name: "AUTH_PEPPER_ID", text: "pulse-owner-v1" },
  ],
  observability: {
    enabled: true,
    head_sampling_rate: 1,
    redact_query_string: false,
    logs: {
      enabled: true,
      head_sampling_rate: 1,
      persist: true,
      invocation_logs: true,
    },
    traces: {
      enabled: false,
      persist: true,
      head_sampling_rate: 1,
    },
  },
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function expectedBytes(entry) {
  return entry.encoding === "base64"
    ? Buffer.from(entry.body, "base64")
    : Buffer.from(entry.body, "utf8");
}

await rm(dryRunDir, { recursive: true, force: true });
const dry = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "deploy",
    "--dry-run",
    "--outdir",
    dryRunDir,
    "--config",
    "wrangler.bundle.jsonc",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
  },
);
if (dry.status !== 0) {
  throw new Error("Bundled wrangler dry-run failed. Nothing was deployed.");
}

const produced = (await readdir(dryRunDir)).filter((name) => name !== "README.md");
const maps = produced.filter((name) => name.endsWith(".map"));
const scripts = produced.filter((name) => name.endsWith(".js"));
assert.deepEqual(maps, [], `dry-run emitted source maps: ${maps.join(", ")}`);
assert.equal(
  scripts.length,
  1,
  `expected a single JavaScript bundle, found ${produced.join(", ")}`,
);
const workerBytes = await readFile(path.join(dryRunDir, scripts[0]));
const workerText = workerBytes.toString("utf8");
assert.equal(workerText.includes(testPepper), false);
assert.equal(workerText.includes("LOCAL_SMOKE_TEST_ONLY"), false);
assert.equal(workerText.includes('id=\\"root\\"') || workerText.includes('id="root"'), true);
const importSpecifiers = [
  ...workerText.matchAll(/(?:^|\n)\s*import\s[\s\S]*?\sfrom\s*["']([^"']+)["']/g),
].map((match) => match[1]);
assert.deepEqual(
  importSpecifiers,
  [],
  `bundle still imports modules: ${importSpecifiers.join(", ")}`,
);
assert.ok(workerBytes.length < 3 * 1024 * 1024, "bundle exceeded the small-package budget");

for (const [pathname, entry] of Object.entries(bundledAssets)) {
  assert.equal(entry.contentType, contentTypeForPath(pathname));
  assert.ok(pathname === SHELL_PATH || publicAsset(pathname));
  const disk = await readFile(path.join(root, "dist", pathname.slice(1)));
  assert.ok(expectedBytes(entry).equals(disk), `${pathname} drifted from dist`);
}

const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
assert.equal(Object.hasOwn(metadata, "assets"), false);
assert.equal(metadata.keep_assets, undefined);
assert.deepEqual(metadata.keep_bindings, ["secret_text", "secret_key"]);
for (const binding of metadata.bindings) {
  assert.notEqual(binding.type, "secret_text");
  assert.notEqual(binding.type, "secret_key");
  assert.notEqual(binding.type, "assets");
}
assert.equal(metadataBytes.includes(testPepper), false);

const workerSha = sha256(workerBytes);
const metadataSha = sha256(metadataBytes);
const modules = {
  endpoint: "PUT /accounts/{account_id}/workers/scripts/pulse-crm",
  account_id: accountId,
  script_name: "pulse-crm",
  existing_origin: origin,
  existing_d1: databaseId,
  note: "Upload only metadata and worker.js. This package does not call the assets upload session and does not contain secrets.",
  do_not_upload: ["UPLOAD.md", "modules.json", "SHA256SUMS"],
  parts: [
    {
      name: "metadata",
      filename: "metadata.json",
      content_type: "application/json",
      bytes: metadataBytes.length,
      sha256: metadataSha,
    },
    {
      name: "worker.js",
      filename: "worker.js",
      content_type: "application/javascript+module",
      bytes: workerBytes.length,
      sha256: workerSha,
      gzip_bytes: gzipSync(workerBytes).length,
    },
  ],
};
const sums = `${workerSha}  worker.js\n${metadataSha}  metadata.json\n`;
const instructions = `# Pulse CRM bundled Worker upload

Upload this directory through the sanctioned Cloudflare connector. Do not deploy with Wrangler, do not log in with the CLI, and do not call the Workers Assets upload session. That session returns a JWT that must be sent as \`Authorization\`, and \`cloudflare.request\` cannot set that header.

The package is one Worker module. \`worker.js\` already contains the sign-in shell and the exact hashed \`/assets/\` allowlist (${Object.keys(bundledAssets).length} files). No separate asset parts are required.

## Before the upload

1. Confirm the connector \`accountId\` is \`${accountId}\`. If it is not, stop.
2. \`GET /accounts/${accountId}/workers/scripts/pulse-crm/settings\`.
3. Stop if the D1 binding is not \`${databaseId}\`, or if \`APP_ORIGIN\`, \`SESSION_TTL_DAYS\`, or \`AUTH_PEPPER_ID\` differ from \`metadata.json\`. Do not create another Worker or D1 database.
4. \`GET /accounts/${accountId}/workers/scripts/pulse-crm/secrets\` and remember the names. This package does not contain secret values. \`keep_bindings\` preserves \`secret_text\` and \`secret_key\` bindings already stored on the script.
5. Confirm \`GET /accounts/${accountId}/workers/scripts/pulse-crm/subdomain\` is \`enabled: true\` and \`previews_enabled: false\`. Do not change that setting in this upload.

## Connector request

Read \`metadata.json\` and \`worker.js\` from this directory. Put the worker bytes in a Blob; do not paste the source into a template literal (\`worker.js\` contains quotes and \`\${\`). Base64 is safe if the connector function cannot read the file.

\`\`\`javascript
async () => {
  const metadata = /* parsed metadata.json */;
  const code = /* Uint8Array or string bytes of worker.js */;
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append(
    "worker.js",
    new Blob([code], { type: "application/javascript+module" }),
    "worker.js",
  );
  return cloudflare.request({
    method: "PUT",
    path: \`/accounts/\${accountId}/workers/scripts/pulse-crm\`,
    body: form,
  });
}
\`\`\`

Do not set \`contentType\` on the connector request. Do not add an \`Authorization\` header, an \`assets\` binding, an assets JWT, \`keep_assets\`, a secret value, or any paid binding (KV, R2, Durable Objects, Queues, Workflows, AI).

\`usage_model\` stays \`standard\`. That is the existing Free-plan model. Do not set \`limits.cpu_ms\` and do not change the account plan.

## After the upload

Read the settings and secret names again. The D1 id and plain-text vars must be unchanged, and every secret name from step 4 must still be present. This upload does not create \`AUTH_PEPPER\` or \`SETUP_TOKEN\`. Until the provider stores \`AUTH_PEPPER\`, the Worker correctly returns 503 and does not serve the application. The user generates those secrets outside this package; do not invent them.

SHA-256: worker.js \`${workerSha}\`, metadata.json \`${metadataSha}\`. Uncompressed worker \`${workerBytes.length}\` bytes (gzip \`${gzipSync(workerBytes).length}\`). The Free Worker size limit is 64 MiB uncompressed.
`;

await mkdir(packageDir, { recursive: true });
await writeFile(path.join(packageDir, "worker.js"), workerBytes);
await writeFile(path.join(packageDir, "metadata.json"), metadataBytes);
await writeFile(
  path.join(packageDir, "modules.json"),
  `${JSON.stringify(modules, null, 2)}\n`,
);
await writeFile(path.join(packageDir, "SHA256SUMS"), sums);
await writeFile(path.join(packageDir, "UPLOAD.md"), instructions);

const testConfig = path.join(root, "wrangler.package-test.jsonc");
await writeFile(
  testConfig,
  JSON.stringify(
    {
      name: "pulse-crm-package-test",
      main: "./deploy/cloudflare-upload/worker.js",
      compatibility_date: "2026-11-06",
      upload_source_maps: false,
      workers_dev: false,
      preview_urls: false,
      d1_databases: [
        {
          binding: "DB",
          database_name: "package-test-only",
          database_id: "package-test-only",
          migrations_dir: "migrations",
        },
      ],
    },
    null,
    2,
  ),
);
const storage = mkdtempSync(path.join(tmpdir(), "pulse-package-"));
const migrated = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "migrations",
    "apply",
    "package-test-only",
    "--local",
    "--config",
    testConfig,
    "--persist-to",
    storage,
  ],
  { stdio: "inherit", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } },
);
if (migrated.status !== 0) {
  rmSync(storage, { recursive: true, force: true });
  await rm(testConfig, { force: true });
  throw new Error("Local package D1 migration failed.");
}
const port = process.env.PULSE_PACKAGE_PORT || "8791";
const localOrigin = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--local",
    "--no-bundle",
    "--config",
    testConfig,
    "--ip",
    "127.0.0.1",
    "--port",
    port,
    "--persist-to",
    storage,
    "--var",
    `APP_ORIGIN:${localOrigin}`,
    "--var",
    "PULSE_RUNTIME:development",
    "--var",
    "AUTH_PEPPER_ID:pulse-owner-v1",
    "--var",
    "SESSION_TTL_DAYS:7",
    "--var",
    `AUTH_PEPPER:${testPepper}`,
  ],
  {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
  },
);
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));
try {
  let ready = false;
  for (let i = 0; i < 400; i++) {
    if (child.exitCode !== null) break;
    if (output.includes("Ready on")) {
      ready = true;
      break;
    }
    await delay(100);
  }
  assert.equal(ready, true, `packaged worker did not start\n${output}`);
  const health = await fetch(`${localOrigin}/api/health`);
  const healthText = await health.text();
  assert.equal(health.status, 200, healthText);
  assert.equal((await fetch(`${localOrigin}/api/contacts`)).status, 401);
  const rootResponse = await fetch(localOrigin, { redirect: "manual" });
  assert.equal(rootResponse.status, 302);
  const signin = await fetch(`${localOrigin}/signin`);
  assert.equal(signin.status, 200);
  assert.equal(signin.headers.get("cache-control"), "private, no-store");
  assert.match(signin.headers.get("content-security-policy") || "", /script-src 'self'/);
  const shell = Buffer.from(await signin.arrayBuffer());
  assert.ok(shell.equals(await readFile(path.join(root, "dist", "index.html"))));
  for (const [pathname, entry] of Object.entries(bundledAssets)) {
    if (!publicAsset(pathname)) continue;
    const response = await fetch(localOrigin + pathname);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get("content-type"), entry.contentType);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    const body = Buffer.from(await response.arrayBuffer());
    assert.ok(body.equals(expectedBytes(entry)), pathname);
  }
  assert.notEqual((await fetch(`${localOrigin}/404.html`)).status, 200);
  assert.notEqual(
    (await fetch(`${localOrigin}/assets/not-a-real-file.js`)).status,
    200,
  );
  console.log(
    `Packaged worker.js ${workerBytes.length} bytes (gzip ${gzipSync(workerBytes).length}), sha256 ${workerSha}. Local workerd served the bundled shell and allowlisted assets.`,
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* The dev process may already have exited. */
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3000),
  ]);
  rmSync(storage, { recursive: true, force: true });
  await rm(testConfig, { force: true });
}

await mkdir(artifactDir, { recursive: true });
for (const name of ["worker.js", "metadata.json", "modules.json", "SHA256SUMS", "UPLOAD.md"]) {
  await writeFile(path.join(artifactDir, name), await readFile(path.join(packageDir, name)));
}
console.log(`Wrote ${packageDir} and ${artifactDir}`);
