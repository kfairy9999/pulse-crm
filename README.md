# Pulse CRM

Private, single-owner CRM: React static assets + a native Fetch Worker + Cloudflare D1. The recommended deployment uses **Workers Free only**. No Express server, Node SQLite driver, persistent disk, Durable Object binding, paid plan, or external messaging service is needed by the Worker.

## Features

- Contacts: CRUD, searchable names/companies/email, normalized tags, durable notes, relationship safeguards.
- Pipeline: six stages, USD integer cents, CRUD, drag/drop and keyboard-friendly stage selection, explicit card ordering, computed weighted forecast.
- Tasks: CRUD, priorities, due dates, completion/reopen and timestamps.
- Appointments: CRUD, duration/location/notes; UTC storage, browser-local time display. **No invitations, calendar sync, or calls.**
- Overview: computed metrics, task priorities, upcoming appointments, activity, record-month value chart (not historical revenue).
- Inbox is a contact-notes reader/composer, **not an email connection**. Workflows are explicitly not connected. No messages are sent.

D1 starts empty: no fictional sample records or owner account. This is not multi-user SaaS; no MFA, password reset/recovery, tenant isolation, security audit log, or application-managed backups are provided.

## Development and verification

Node 22.13+ and npm are needed for build/test tooling; the deployed runtime is Fetch/WebCrypto/D1, not Node.

```bash
npm ci
npm run build
npm test             # legacy regression suite + actual workerd/D1 tests
npm run test:smoke   # disposable local D1 + local Wrangler HTTP checks, static-assets mode
npm run test:smoke:bundle  # same HTTP checks against the no-assets bundled Worker
npm run check        # build + both dry-runs + upload package, NOT a deployment
npm audit --audit-level=high
```

For interactive Cloudflare-local development:

1. Copy `.dev.vars.example` to ignored `.dev.vars` and replace its placeholders with separately generated local-only random secrets. Never reuse production secrets.
2. `npx wrangler d1 migrations apply pulse-crm --local`.
3. `npm run build`, then `npx wrangler dev --local --https --ip 127.0.0.1 --port 8787`.
4. Open `https://127.0.0.1:8787/signin`, accept only the local development certificate, and create a test owner with your local setup key. Secure cookies require HTTPS; the smoke script's HTTP cookie forwarding is an API test, not a browser-security substitute.

No CLI account login is needed for local operations. `npm start`/`npm run dev` are local Wrangler workflows. Production is never provisioned or deployed by a package install or test.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md). The connector package is `deploy/cloudflare-upload/`: one Worker module with the shell and hashed assets embedded, plus multipart metadata that keeps the existing D1 binding and any secrets already stored. `wrangler.jsonc` still serves `dist/` through the `ASSETS` binding for local development. `wrangler.bundle.jsonc` has no assets binding and is the config behind the upload package. Missing bindings, migrations, origin, or managed auth secret fail closed. Free-tier CPU and provider persistence still need live verification after an authorized deployment; local tests do not establish an SLA or guarantee 10 ms CPU for every dataset/device.

Public `/signin` and hashed assets contain only application code. `/` redirects anonymous visitors to sign-in; every CRM API request requires a valid owner session. No customer records or secret values belong in the bundle/repository.

## Storage, consistency, and authentication

- `migrations/0001_initial.sql` supplies CRM, owner/session/throttle, and pipeline revision tables. It is applied explicitly, never during a user request.
- D1 batches commit business writes and activity together. Pipeline snapshot+revision reads use one batch; compare-and-swap claims use a unique nonce and a SQL CHECK assertion **inside** the write batch. A stale writer gets 409 and the entire write rolls back. Reorders use one JSON/CTE SQL update, not one query per card.
- Primary-first D1 sessions avoid using replica-stale reads for write decisions. Session token/CSRF digests and auth throttles are persisted in D1, not in Worker memory.
- Browser PBKDF2-SHA256 (600,000 iterations, random 128-bit per-owner salt) derives the login credential. A server-side HMAC-SHA256 pepper protects its stored verifier. The expensive KDF is not run inside the Free Worker's 10 ms CPU allowance.
- The derived credential is **password-equivalent**: never log it, send it outside HTTPS, or store it in the browser. This is not a PAKE or a server memory-hard password hash. Client code/TLS integrity is required; simultaneous database+pepper compromise permits offline password guessing. A compromised browser can capture a password. Device-dependent KDF latency and production Worker CPU are not benchmarked here.
- One owner, one active session. Setup uses a separate provider-generated bootstrap key and an atomic uniqueness marker. Login rotates/revokes previous sessions; logout and expiration are server-enforced. Cookies are `__Host-`, Secure, SameSite Strict; the session is HttpOnly. Writes require same-origin JSON and session-bound CSRF (empty DELETE allowed with valid origin/CSRF).
- Login/setup have persisted per-IP/email and global-IP throttles; challenges have an IP throttle. Known/unknown challenge responses share a shape and use stable real/keyed-fallback salts. Cloudflare's verified `CF-Connecting-IP` is used, not user-supplied X-Forwarded-For.

## Legacy local implementation

`src/server/` retains the original Express/Node `node:sqlite` implementation and its 30 API/component tests for regression. Run `npm run start:legacy` or `npm run dev:legacy` only on loopback, with `.env.example` local settings. AuthGate negotiates the legacy server's scrypt-password protocol separately from the Worker's browser-credential protocol.

Legacy SQLite files, owner hashes, and sample data are **not automatically imported into D1**. A real-data migration needs a separate approved export/import plan and a fresh owner enrollment; back up the old database first. The destructive `reset:sample` script is legacy-local only and must never target business data or D1.

## Source layout

`src/worker.js`: native entry, origin/auth/static gates; `src/static-assets.js`: allowlist, MIME, and bundled or `ASSETS` fetch; `src/crm.js`: CRM API; `src/d1.js`: prepared queries; `src/pipeline.js`: atomic ordering; `src/auth/`: credential/session/CSRF/throttles; `src/client/`: React UI; `test/workers/`: actual workerd/D1 coverage; `dist/`: generated public assets; `deploy/cloudflare-upload/`: multipart upload package. Generated asset map, databases, local secrets, and dependencies are ignored by Git.
