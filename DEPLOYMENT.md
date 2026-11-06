# Cloudflare Free deployment handoff

Prepared November 6, 2026 (PST). **Local adaptation and dry-run only. No resource was created, deployed, migrated remotely, or upgraded.** The Cloudflare connector is authenticated; deployment still needs the owner's explicit approval. Never enable a paid plan, usage-based add-on, or paid service to get past a limit.

## Artifacts

Run from `/workspace/pulse-crm`:

```bash
npm ci
npm test
npm run test:smoke
npm run check
npm audit --audit-level=high
git diff --check
```

- `.wrangler/dry-run/worker.js`: bundled ES module; upload as `worker.js`, with `main_module: "worker.js"`. Do not upload the source map as a public static file.
- `dist/`: all static assets, including `/index.html`, `/404.html`, and hashed `/assets/*`. Use Cloudflare's supported Workers Assets upload-session/manifest flow; bind as `ASSETS`. `run_worker_first: true` is essential; do not bypass the authentication router with SPA fallback.
- `migrations/0001_initial.sql`: initial schema, no customer data or default owner. Apply once with D1 migration tracking. Never blindly rerun its CREATE statements on an existing database.
- `wrangler.jsonc`: deployment template. Actual provider IDs/origin must replace placeholders. `wrangler.test.jsonc` is local-test-only and must not be deployed.

## Authorized connector sequence (not executed)

1. Read the account's existing Workers plan, quota, existing Worker names, D1 databases, and workers.dev subdomain. If not on Free or if a collision/resource would be overwritten, stop for approval. Do not change the plan or overwrite an existing app.
2. After explicit approval, create **one D1 database**, `pulse-crm`, on Free. Save its returned UUID into the `DB` binding/template. No KV, R2, Durable Object, Workflow, Queue, or paid add-on is required.
3. Apply `0001_initial.sql` using the supported D1 migration/import mechanism. Confirm tables, schema version 3, revision 0, and zero contacts/users. Store the migration record; do not mutate schema from request handlers.
4. Upload the assets using Cloudflare's assets API; keep its returned asset JWT/manifest out of public files. Upload the Worker bundle with:
   - name `pulse-crm`, `main_module: worker.js`, compatibility date `2026-11-06`;
   - D1 binding `{ type: "d1", name: "DB", id: <actual database UUID> }` (follow the connector's current schema);
   - Assets binding `ASSETS` and metadata asset config `run_worker_first: true`, `not_found_handling: "404-page"`;
   - plain-text vars `APP_ORIGIN=<exact actual https://…workers.dev origin>`, `SESSION_TTL_DAYS=7`, `AUTH_PEPPER_ID=pulse-owner-v1`;
   - `workers_dev: true`, preview URLs disabled, no paid service bindings or schedules. Resolve the actual workers.dev subdomain before setting APP_ORIGIN.
5. Through the provider's approved secret UI/API, have the **user/provider generate** independent cryptographically random 32-byte secrets:
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

Official docs checked November 6, 2026 (PST): Workers Free has 100,000 requests/day and 10 ms CPU/invocation. D1 Free has 5 million rows read/day, 100,000 rows written/day, 5 GB total storage and 10 databases, subject to per-database limits. Queries/indices, auth reads, revision snapshots, and activity writes count toward those quotas; all routes currently run Worker-first, including assets. Exhaustion means denial/errors or waiting for quota reset, **not permission to upgrade**. No SLA or unlimited growth is promised.

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/

PBKDF2 runs in the browser (600,000 SHA-256 iterations); Worker verification is HMAC with a managed secret. The derived credential is password-equivalent and must not be logged or retained. This depends on HTTPS/client-code integrity and is not a PAKE, MFA, or memory-hard server hash. A combined D1+pepper compromise still permits offline guessing. Free CPU and browser latency require real measurements; local tests only establish correctness in the tested runtime.

D1 persistence is managed database storage, not application-managed off-site backup. Keep a separate approved export/recovery plan. The original Node SQLite owner/session database cannot simply be copied into D1: password protocols differ, and existing data migration/re-enrollment needs a separate approved plan.
