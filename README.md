# Pulse CRM

A working, original CRM for keeping relationships, revenue, and next steps in one calm workspace. Pulse is a **single-owner application** with a local mode and a guarded, single-instance hosted configuration. No multi-user/team features are implied.

Built with React, Express, and Node's durable built-in SQLite driver. Contacts, notes, opportunities, tasks, and appointments persist across application restarts. No third-party database service, account credentials, cloud sync, or paid API is required.

## What works

- **Overview** — live open/weighted pipeline, won revenue, closed-deal win rate, contacts and open/due-today task counts; a record-month pipeline chart; priority tasks, upcoming local appointments, and an activity log.
- **Contacts** — create, inspect, edit, and delete contacts; searchable names/companies/emails, tag filters, contact details, linked opportunities/tasks/appointments, and persistent local notes.
- **Pipeline** — all six curated stages (`New Lead`, `Contacted`, `Booked`, `Proposal`, `Won`, `Lost`), create/edit/delete, per-stage value totals, weighted planning estimate, drag/drop or select-based movement, and explicit card ordering. The stage selector is the touch-friendly and keyboard-friendly alternative to dragging.
- **Tasks** — create/edit/delete, priority and due date, optional contact link, open/completed filters, overdue/today/upcoming groups, and completion/reopen with durable timestamps.
- **Schedule** — monthly calendar, agenda, selected-day detail, and full local appointment CRUD with duration, location label, contact link, and notes. **No invitations are sent and no calendar is synced.** Displayed times use the computer's timezone; stored timestamps are UTC.
- **Inbox** — a clearly labeled **local contact-notes interface**, with search, note reading, and note composition. It does not import or receive personal email, and it never sends messages.
- **Workflows** — explicitly **not connected**. The page links to working follow-up, scheduling, and notes features instead of simulating automations.

## Important boundaries

**Local unauthenticated mode is localhost-only and must never be exposed to a network.** Production mode requires and enforces owner authentication, HTTPS-derived secure cookies, an exact application origin, a persistent-volume SQLite path, a provider-generated one-time setup secret, and a non-loopback bind address. This is a single-owner/single-replica MVP, not a multi-tenant SaaS. It has been integration-tested locally; deployment and resilience still require verification on the actual hosting provider before business use.

- No email, SMS, WhatsApp, telephone, payment, or social-media integrations.
- No sending or receiving of messages. `mailto:` and `tel:` links on a contact merely offer to open your own system application.
- No external calendar read/write and no automatic meeting invitations or cancellations.
- No background workflows, lead scoring, AI predictions, or pretend connected-state credentials.
- No cloud sync, multi-user collaboration, or application-managed off-site backup. A provider volume is durable across ordinary restarts, not a recovery guarantee.
- The six-stage chart groups open/won opportunity values by each record's last-updated month; it is an operational view, not a historical revenue report. The weighted forecast uses fixed stage weights (10% / 20% / 40% / 60%), not machine-learned probabilities.
- The built-in sample people and companies are fictional. No Gmail, inbox, or personal contacts are imported.

## Requirements

- Node.js **22.13 or newer** (`node:sqlite` is built in). This project was built and tested with Node 24.22.1.
- npm. No system SQLite installation or external service is needed.

## Running the app locally

```bash
cd /workspace/pulse-crm
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3000** in a browser on this computer.

This runs the production-built React app and JSON API on one Express server. The default database is `data/pulse.db`, and labeled fictional sample data is seeded only on the first launch. The `data/`, `dist/`, `node_modules/`, local logs, and environment files are ignored by Git.

### Development mode

```bash
npm ci
npm run dev
```

- Vite UI: `http://127.0.0.1:5173` (API requests proxy to port 3000)
- API: `http://127.0.0.1:3000/api`
- The API and client reload when their source changes. For the running production preview, rerun `npm run build` after source changes.

### Configuration
Local defaults: `HOST=127.0.0.1`, `PORT=3000`, `DATABASE_PATH=./data/pulse.db`, and `SEED_SAMPLE_DATA=true`. Set `SEED_SAMPLE_DATA=false` on first launch for an empty workspace.
Optional local authentication settings:
- `AUTH_ENABLED=true` enables a private local owner account; on a loopback origin only, omit `SETUP_TOKEN` to run owner setup without a bootstrap key.
- `SESSION_TTL_DAYS=7` may be set to 1–30.
- `TRUST_PROXY=true` trusts the first proxy hop for local HTTPS-proxy testing. Production cookie security is derived from the actual HTTPS request; never enable `COOKIE_SECURE` independently to simulate security on ordinary HTTP.

Production refuses to start unless all of these are true: `REQUIRE_SECURE_DEPLOYMENT=true` (or the default with `NODE_ENV=production`), `AUTH_ENABLED=true`, `HOST=0.0.0.0`, `TRUST_PROXY=true`, `COOKIE_SECURE=true`, `SEED_SAMPLE_DATA=false`, an exact `APP_ORIGIN=https://…` without a path, and `DATABASE_PATH` under `/var/data/`. During initial owner setup, a provider-generated `SETUP_TOKEN` of at least 32 characters is also required; remove it after ownership is created so the server can restart normally while registration stays closed. `APP_ORIGIN` must match the service’s actual hostname; alter it before applying the Blueprint if the provider gives a different hostname.

### Owner authentication
At the first hosted launch, the owner opens the displayed URL and enters their own email and unique 12–256-character password plus the provider-generated `SETUP_TOKEN`. Use the password manager’s generated password rather than choosing one in chat. Only one owner can be registered in a database; subsequent setup attempts return `403`. **Remove `SETUP_TOKEN` from the provider environment after verified setup.** Retain the owner password in a password manager: there is no account recovery or password-reset integration yet.
Passwords use salted Node scrypt (N=16384, r=8, p=1, 64-byte output) and fixed-length Buffer comparison. Only SHA-256 digests of opaque 256-bit session tokens are stored. Sessions are revocable, expire server-side after seven days by default, and use `__Host-` cookies with `Path=/`, `HttpOnly`, `SameSite=Strict`, and `Secure` on HTTPS. CSRF tokens are held in separate `Secure`/`SameSite=Strict` cookies readable by this app; their SHA-256 digests are bound to the session and compare against a custom request header. Authentication also requires JSON and exact Origin/Referer matching. Login/setup requests are throttled per IP after eight failures in a 15-minute window.
CRM JSON endpoints require a valid session in authenticated mode; HTML entry routes return `401` without one. `/api/auth/session`, `/api/auth/setup`, `/api/auth/login`, `/api/auth/logout`, and health-check requests are public routes without CRM data. **Static JavaScript and stylesheet assets are not secrets and are not treated as authenticated resources.** Do not put customer data or credentials into the client bundle or repository.
This is deliberately one-owner software with a single active server-side session at any time. Logging in on a new device revokes earlier sessions. Database-stored session digests survive process restarts on the persistent disk and remain valid until expiration, logout, or the next login. Loss of the persistent volume loses owner/session and CRM data.

### Starting fresh or restoring sample data

To use an empty database from the start:

```bash
SEED_SAMPLE_DATA=false DATABASE_PATH=./data/my-empty-crm.db npm start
```

To deliberately replace the configured database with a fresh sample dataset (stop the app first):

```bash
npm run reset:sample
```

**The reset command deletes all records in that database.** Use `DATABASE_PATH` to avoid targeting the wrong file. To back up your work, stop the app and copy the SQLite `.db` file (and its `-wal` file if present) somewhere safe. Do not rely on the repository: the database is intentionally not committed.

## Tests and quality checks

```bash
npm test
npm run build
```

The suite runs entirely on the local machine with isolated test databases and ephemeral loopback API servers. It does not touch `data/pulse.db`, use personal accounts, or require browser automation.

Coverage includes:

- Live HTTP API integration tests for contact CRUD, editing and duplicate-email protection, filtering, tags, notes, relationship safeguards, task CRUD/completion, appointment CRUD, and validation.
- Create, edit & value totals across all pipeline stages; ordered cross-stage moves and same-column repositioning.
- On-disk SQLite restart persistence for all main record types; transaction rollback and seed idempotency/no-resurrection behavior.
- Programmatic React server-rendered component checks for loaded dashboard metrics, form fields and defaults, contact prerequisites, and honest local-only messaging.

- Owner auth/session/CSRF/origin/password-hash/expiry/revocation/rate-limit and fail-closed deployment configuration tests.

## Architecture

```text
src/
  shared.js                  Shared stage/priority constants and validation rules
  client/
    App.jsx                  Workspace shell, navigation, global search, forms, toasts
    api.js                   Typed error wrapper for fetch; date/money display helpers
    components/              Accessible modal/form primitives and CRUD forms
    pages/                   Overview, contacts, pipeline, tasks, schedule, notes inbox
    styles.css               Original responsive design system
  server/
    index.js                 Local configuration, startup, graceful shutdown
    app.js                   Express routes, validation, transactional mutations
    db.js                    Migrations, relationships, lookup/map helpers
    seed.js                  Idempotent, labeled fictional sample data
scripts/reset-sample-data.js Explicit destructive sample reset
 test/                      HTTP integration + React server-rendered tests
data/pulse.db                Runtime SQLite file (not committed)
dist/                        Vite production output (not committed)
```

### Data model

- `contacts`: person/company fields, normalized unique email (when provided), JSON tags, timestamps.
- `contact_notes`: durable notes with foreign-key cascade on contact deletion.
- `opportunities`: contact relationship, title, integer monetary cents, validated stage, explicit card order, close date, notes.
- `tasks`: title, optional contact, due date, priority, status, notes, required completion timestamp consistency.
- `appointments`: local-only schedule records with UTC start, duration, location/notes, optional contact.
- `activities`: local history generated in the same transaction as writes; not a security audit log.
- `app_metadata`: seed marker and future local metadata.
- `schema_migrations`: migration version.

Foreign keys, type/domain validation, JSON tags validity, database constraints, relationship checks, and transactions are used together. Creating a contact with a duplicate email returns `409`; deleting a contact with opportunities returns `409` until those opportunities are explicitly deleted or reassigned. Deleting an unlinked-to-deals contact removes their notes and intentionally detaches tasks and appointments. Deleting an opportunity is a separate explicit action.

## API overview

All endpoints are under `/api`; request bodies are JSON. Errors return `{ "error": "Explanation" }` with a suitable `400`, `404`, `409`, or `500` status. Successful creates return `201`.

| Resource | Endpoints |
| --- | --- |
| Health & metadata | `GET /health`, `GET /metadata` |
| Computed overview | `GET /dashboard` |
| Contacts | `GET/POST /contacts`; `GET/PATCH/DELETE /contacts/:id`; `GET /contacts?q=...&tag=...` |
| Contact notes | `POST /contacts/:id/notes` (notes also appear in the contact details and `GET /inbox`) |
| Opportunities | `GET/POST /opportunities`; `GET/PATCH/DELETE /opportunities/:id` |
| Tasks | `GET/POST /tasks`; `GET/PATCH/DELETE /tasks/:id`; optional `?status=Open|Completed|All` |
| Local appointments | `GET/POST /appointments`; `GET/PATCH/DELETE /appointments/:id` |
| Local notes inbox | `GET /inbox` |

`PATCH` is a partial update. An opportunity stage change is `{ "stage": "Proposal" }`; an optional non-negative integer `position` sets its exact card order. Monetary API inputs and outputs are in USD units (`value`); SQLite stores integer cents to avoid binary floating-point money drift. A task toggle is `{ "completed": true }` or `{ "completed": false }`. Appointment `starts_at` accepts a valid ISO datetime and is normalized to UTC.

## Prepared Render deployment (not provisioned by this repository)
`render.yaml` is a documented production configuration for one Node web service and one 1 GB persistent disk at `/var/data`, with no fictional sample data. The blueprint includes no password or committed secret; `SETUP_TOKEN` is generated by Render. **Creating these resources requires owner approval and a connected, authorized Render account.**
As verified in the official docs/pricing on November 6, 2026: the `0.5c-512mb` compute plan is **$7/month** and a 1 GB disk is **$0.25/month** at $0.25/GB/month, totaling **$7.25/month before any prorations or applicable charges**. The free web tier is unsuitable because it cannot attach persistent disks; free Render PostgreSQL expires after 30 days and Pulse currently uses SQLite.
Official sources: [pricing](https://render.com/pricing), [persistent disks](https://render.com/docs/disks), [Blueprint reference](https://render.com/docs/blueprint-spec), and [free-web limits](https://render.com/docs/free).
Deployment requires the owner to approve Render’s account terms/costs and authorize the GitHub connection, apply this Blueprint from `feat/working-mvp`, verify the actual `APP_ORIGIN` equals the resulting public hostname (possibly `https://pulse-crm.onrender.com` or an alternate available name), then create their own owner account. Remove the generated setup secret from the environment after setup. Never commit the database, generated `SETUP_TOKEN`, or a password.
The disk is attached to exactly one instance (the Blueprint enforces `numInstances: 1`). Files outside `/var/data` are ephemeral. A disk preserves data over ordinary restarts/deploys but does not protect against every failure; arrange a verified SQLite-consistent off-site backup before business-critical use. A disk increases deploy downtime by a few seconds (zero-downtime deploys unavailable). Snapshots are not a substitute for application-aware database backups. For a larger multi-user or high-availability service, migrate to managed PostgreSQL, centralized session storage/rate limiting, encrypted backups, and an external security review.
Before declaring a hosted deployment working, verify live HTTPS, health checks, anonymous CRM/SPA denial, correct owner login/logout, invalid CSRF rejection, persistence across a real provider restart, and provider backup/recovery expectations. Local tests alone do not establish these hosted guarantees.

## Deliberate MVP scope
Pulse prioritizes the CRM records and follow-up loop over feature-parity theater. It supports a guarded single-owner deployment, but still lacks multi-user authorization/tenant isolation, password recovery, external identity/MFA, audit logs, application-managed off-site backups, HA, external integration consent/token handling, and a production security review.
