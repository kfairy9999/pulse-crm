# Pulse CRM

A working, original CRM for keeping relationships, revenue, and next steps in one calm workspace. Pulse is a **local, single-user MVP**, not a hosted product or a copy of another CRM's interface.

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

**Pulse has no production authentication, authorization, tenant isolation, encrypted backup, rate limiting, CSRF protection, or audit-grade security controls.** It is designed for one user on a trusted, local computer. The default bind address is `127.0.0.1`. Do not expose it on a public or untrusted network, do not use it for sensitive production customer data, and do not treat it as a production deployment.

- No email, SMS, WhatsApp, telephone, payment, or social-media integrations.
- No sending or receiving of messages. `mailto:` and `tel:` links on a contact merely offer to open your own system application.
- No external calendar read/write and no automatic meeting invitations or cancellations.
- No background workflows, lead scoring, AI predictions, or pretend connected-state credentials.
- No cloud sync, multi-user collaboration, or automatic backup.
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

Optional environment variables (copy `.env.example` to `.env`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind interface. Keep this on localhost without production authentication. |
| `PORT` | `3000` | HTTP server port. Set `0` to choose a free port; the log reports the selected one. |
| `DATABASE_PATH` | `./data/pulse.db` | Durable SQLite file path, resolved relative to the working directory. |
| `SEED_SAMPLE_DATA` | `true` | Set to `false` to begin a new empty database. A seed marker prevents sample data from being recreated or resurrecting deleted sample records after startup. |

Environment variables explicitly exported by the shell take precedence over `.env`. A sample `.env` is included; real `.env` files are ignored. No credentials are needed.

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

## Deliberate MVP scope

Pulse prioritizes the CRM records and follow-up loop over feature-parity theater. Before any networked or multi-user release, it needs production identity and authorization, configurable per-user storage, secure session handling, CSRF/rate-limit defenses, resilient database migrations/backups, integration-specific consent and token storage, and appropriate privacy/security review. Those are **not implemented or claimed here**.
