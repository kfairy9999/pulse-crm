# Secure hosted-launch handoff

Prepared November 6, 2026 (Pacific). This is a plan, **not evidence of a running hosted service**.

## Provider choice and approval needed
Use one Render Hobby workspace: $0/month workspace fee + $7/month `0.5c-512mb` web compute + $0.25/month 1 GB persistent SSD = **$7.25/month**, before applicable prorations/overages. The owner must explicitly approve resource charges and any account terms. Official live sources: https://render.com/pricing and https://render.com/docs/disks.
Free web compute cannot hold durable SQLite data and is not supported here; free Postgres expires after 30 days and does not support this SQLite codebase.

## Supported access
Use the Grok Bot Render connector: `https://cursor.com/grok-bot/link/v1/plugin/add?id=1295` (plugin 1295). It is not currently installed or authenticated. The owner must connect/sign in via Render OAuth. Do not read/copy tokens or cookies from the browser. No CLI authentication, signup, paid resource, or Blueprint apply has happened in this preparation.

## Apply / verify sequence
1. Owner approves paid resources, connects the Render connector, and authorizes the private GitHub repository.
2. Inspect the actual target hostname from the chosen Render service **before** applying. Update `APP_ORIGIN` if `pulse-crm.onrender.com` is unavailable or renamed; exact HTTPS origins are enforced for authentication state changes.
3. Apply `render.yaml` from `feat/working-mvp` only after approval. It creates one instance (`numInstances: 1`), paid compute, persistent disk mounted at `/var/data`, and Render-generated 256-bit `SETUP_TOKEN` (no committed password/token). No preview environments or spin-down configuration is used.
4. Owner opens the HTTPS URL and enters their own login email, vault/password-manager-generated unique password, and the generated provider `SETUP_TOKEN` in the first-run form. The agent does not select or see the password.
5. Confirm owner login, then remove `SETUP_TOKEN` from the provider's environment; keep the owner password in the password manager. There is currently no password-recovery mechanism; one owner account and one active session are supported.
6. Verify live reachable HTTPS and `/api/health` (public, no CRM data); anonymous `/`, `/login`, `/api/metadata`, `/api/contacts`, and `/api/dashboard` contain no CRM or customer content without a session. Static asset requests should contain only public application code, not customer content. Verify successful authenticated access, new login revokes an older session, logout revokes this session, mutation without/incorrect `X-CSRF-Token` is `403`, and Origin mismatch is `403`.
7. Insert a test CRM record, perform a provider restart/redeploy, confirm the same record and auth owner survive on `/var/data/pulse.db`, then delete the test record. Do not alter/restart a customer's database without approval.
8. Configure and verify an application-appropriate SQLite backup before business-critical use. A disk is durable over ordinary restarts, not a complete recovery strategy. Local integration coverage is not a hosted persistence test or penetration test.

## Local verification already completed
Run `npm test`, `npm run build`, `npm audit --audit-level=high`, `git diff --check`; test output may be captured locally in the ignored `test-results.log`. A 28-test suite includes original working CRUD/browser-independent component checks, scrypt records, cookie/session lifecycle, CSRF, login throttling, and production configuration fail-closed guards. No service URL is being claimed without step 6.

## Hosting limits
A persistent disk attaches to one service and one instance. Disabling horizontal scaling is necessary for this SQLite design. Ordinary deploys incur a brief downtime. Data outside `/var/data` is ephemeral. Render volume snapshots are not a replacement for database-aware backups. Backups, MFA, identity recovery, multi-user authorization/team isolation, HA, audit logs and external review remain future work.
