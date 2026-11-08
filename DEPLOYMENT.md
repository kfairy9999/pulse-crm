# Cloudflare Free deployment handoff

## Current live package

Uploaded November 7, 2026, 7:57:46 PM Pacific. Deployment `97ad1b67-f257-4ffc-8cf4-9a0f0943bc61`, version `5c93bf48-e9de-4c8f-93a6-36bbe7930560`, rollout 100%. The downloaded script matches `deploy/cloudflare-upload/worker.js`: SHA-256 `da4def941eb1ba9963c16b9ac18303dbc09736e60fbcf9ac03c8903324e06e72`, 469,790 bytes. The shell asset is `/assets/index-tVPtbvvR.js`. `GET /api/health` returned 200. Anonymous CRM APIs returned 401. `AUTH_PEPPER`, the plain-text settings, the D1 records, and the Free plan were left unchanged. `SETUP_TOKEN` is absent. The task already stored as due Nov 9 was not rewritten. Signed-in browser acceptance is still in progress. This is not a full live pass, and it is not a Free CPU or large-board measurement.

Never enable a paid plan, usage-based add-on, or paid service to get past a limit. The November 6 notes below are the original handoff for how the package is built and uploaded. They are not a claim that the account is still empty.

Prepared November 6, 2026 (PST), before this package was uploaded.

## Artifacts

Run from `/workspace/pulse-crm`:

```bash
npm ci
npm test
npm run test:smoke
npm run test:smoke:bundle
npm run check
npm audit --audit-level=high
git diff --check
```

`npm test` builds the client, regenerates the asset map, then runs the legacy suite and the workerd suite. `npm run check` dry-runs both Wrangler configs and writes the upload package. None of these commands deploy.

### Connector upload (use this)

`deploy/cloudflare-upload/` is the multipart script package:

- `worker.js`: one self-contained ES module. Upload as `worker.js` with content type `application/javascript+module` and `main_module: "worker.js"`. The sign-in shell and hashed assets are inside this file. Do not upload a source map.
- `metadata.json`: the JSON `metadata` part. It binds the existing D1 database and the existing plain-text vars, sets `keep_bindings` to `secret_text` and `secret_key`, and has no assets JWT.
- `modules.json`, `SHA256SUMS`, and `UPLOAD.md`: instructions and checksums for the parent. Do not upload these three files as Worker modules.

This avoids the Workers Assets upload session. That session returns a short-lived JWT which must be sent as `Authorization`, and the connector's `cloudflare.request` cannot set headers.

### Local static-assets mode (do not use for this connector upload)

- `.wrangler/dry-run/`: bundled Worker from `wrangler.jsonc`, which still has the `ASSETS` binding for `wrangler dev` and for a client that can complete the assets upload session itself.
- `dist/`: Vite output used by that binding and by the asset-map generator. `run_worker_first: true` stays essential. Do not bypass the authentication router with a public SPA fallback.
- `migrations/0001_initial.sql`: initial schema, no customer data or default owner. Apply once with D1 migration tracking. Never blindly rerun its CREATE statements on an existing database.
- `wrangler.jsonc`: static-assets template. `wrangler.bundle.jsonc` is the no-assets config used to produce `worker.js`. `wrangler.test.jsonc` is local-test-only and must not be deployed.

## Authorized connector sequence (not executed)

1. Read the account's existing Workers plan, quota, existing Worker names, D1 databases, and workers.dev subdomain. If not on Free or if a collision/resource would be overwritten, stop for approval. Do not change the plan or overwrite an existing app.
2. After explicit approval, create **one D1 database**, `pulse-crm`, on Free. Save its returned UUID into the `DB` binding/template. No KV, R2, Durable Object, Workflow, Queue, or paid add-on is required.
3. Apply `0001_initial.sql` using the supported D1 migration/import mechanism. Confirm tables, schema version 3, revision 0, and zero contacts/users. Store the migration record; do not mutate schema from request handlers.
4. Upload the existing script with the connector multipart request in `deploy/cloudflare-upload/UPLOAD.md`. Read `metadata.json` and `worker.js` from that directory. `PUT /accounts/{account_id}/workers/scripts/pulse-crm` with two form parts only:
   - `metadata` (`application/json`): the object in `metadata.json`. It names `main_module: worker.js`, compatibility date `2026-11-06`, the existing D1 binding, the existing plain-text vars, `usage_model: "standard"`, `logpush: false`, and `keep_bindings: ["secret_text", "secret_key"]`.
   - `worker.js` (`application/javascript+module`): the bytes of `worker.js`.
   Do not call `assets-upload-session`, do not send an assets JWT, and do not set an `Authorization` header. Do not add an `assets` binding. The Worker serves the allowlisted files from the module when `ASSETS` is absent, and still uses the binding when it is present. Re-read the live settings first and stop if the D1 id or plain-text vars differ from `metadata.json`. The PUT deploys this script in place and keeps the existing workers.dev hostname. Do not create a second Worker or database, and do not enable preview URLs.
5. Through the provider's approved secret UI/API, have the **user/provider generate** independent cryptographically random 32-byte secrets. The upload metadata deliberately omits secret values and uses `keep_bindings` so a later upload does not delete secrets that were stored before it. If none are stored yet, the Worker keeps failing closed until they are:
   - `AUTH_PEPPER`: canonical base64url of exactly 32 bytes (43 characters). Keep this stable: losing/changing it locks out the owner's password verifier. Do not paste it into chat or commit it.
   - `SETUP_TOKEN`: a separate high-entropy bootstrap key, at least 32 random bytes (43-char base64url recommended). Never reuse a Cloudflare API token, owner password, or AUTH_PEPPER.
     Do not substitute agent-chosen values or the public test fixtures. If the connector cannot safely generate/store secrets without exposing them, stop for the user's provider-side secret entry. A deployment with missing secrets intentionally returns 503.
6. Expose only the final configured HTTPS origin; no alias/wildcard CORS. Owner visits `/signin`, enters their own email, password-manager-generated unique 12–256-character password, and provider setup key. The agent neither chooses nor sees the password.
7. After verified owner login, remove only `SETUP_TOKEN` through the provider. Registration stays closed by the database marker. Preserve `AUTH_PEPPER` and its matching ID. No password-recovery integration exists.
8. Perform the live acceptance checks below, only with approved test records/actions. Record the URL and deployment ID only after they exist.

The connector must discover its current upload/migration schemas before executing. CLI login, token extraction, browser cookies, undocumented internal endpoints, or enabling paid plans are not fallbacks.

## Live acceptance gate

- HTTPS valid; `/api/health` returns 200 without customer content.
- Anonymous `/` redirects to `/signin`; `/signin`/hashed assets contain only application code. Anonymous contacts/dashboard/metadata APIs are 401. Unknown routes, DB paths, environment files, and source files are not public.
- Setup succeeds exactly once; login uses stored per-owner salt, rotates old sessions; logout and expiry revoke access. Removal of SETUP_TOKEN does not reopen setup.
- Wrong Origin, absent/mismatched CSRF, malformed/oversized JSON, invalid relations/money/stages, and duplicate contact emails are rejected safely. Internal SQL/stack/secret values never reach clients.
- Verify contacts, notes, all pipeline reorder/move/delete cases (including sole-card columns), tasks, appointments, dashboard/inbox. Concurrent pipeline writes either succeed consistently or return retryable 409 without partial data.
- With explicit approval, create a test record, redeploy/restart, verify both session and record persistence, then remove only that test record. Local D1 eviction tests are not hosted persistence proof.
- Inspect actual Worker CPU/error/limit metrics for login, setup, dashboard, and representative board sizes. **No production 10 ms CPU claim has been measured.** If limits fail, optimize or stop; do not upgrade.
- Verify D1 export and recovery on an approved non-production copy before business-critical use. Retain provider secret recovery securely; exports contain sensitive CRM/auth data and must not go into the repository or chat.

## Free-tier constraints

Official docs checked November 6, 2026 (PST): Workers Free has 100,000 requests/day and 10 ms CPU/invocation. The uncompressed Worker size limit is 64 MiB on Free and Paid; this package is a few hundred kilobytes. D1 Free has 5 million rows read/day, 100,000 rows written/day, 5 GB total storage and 10 databases, subject to per-database limits. Queries/indices, auth reads, revision snapshots, and activity writes count toward those quotas; all routes currently run Worker-first, including the bundled shell and hashed assets. Exhaustion means denial/errors or waiting for quota reset, **not permission to upgrade**. No SLA or unlimited growth is promised.

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/wrangler/bundling/
- https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/

PBKDF2 runs in the browser (600,000 SHA-256 iterations); Worker verification is HMAC with a managed secret. The derived credential is password-equivalent and must not be logged or retained. This depends on HTTPS/client-code integrity and is not a PAKE, MFA, or memory-hard server hash. A combined D1+pepper compromise still permits offline guessing. Free CPU and browser latency require real measurements; local tests only establish correctness in the tested runtime.

D1 persistence is managed database storage, not application-managed off-site backup. Keep a separate approved export/recovery plan. The original Node SQLite owner/session database cannot simply be copied into D1: password protocols differ, and existing data migration/re-enrollment needs a separate approved plan.
