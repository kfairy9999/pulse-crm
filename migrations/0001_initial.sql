-- D1 migrations are applied by Wrangler, never by application request handling.
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE contacts (
 id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL DEFAULT '',
 email TEXT UNIQUE, phone TEXT, company TEXT, job_title TEXT,
 tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE contact_notes (
 id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(length(trim(body)) > 0), author TEXT NOT NULL DEFAULT 'You', created_at TEXT NOT NULL
);
CREATE TABLE opportunities (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
 stage TEXT NOT NULL CHECK(stage IN ('New Lead','Contacted','Booked','Proposal','Won','Lost')),
 value_cents INTEGER NOT NULL DEFAULT 0 CHECK(value_cents >= 0),
 position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0), expected_close_date TEXT, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE tasks (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
 due_date TEXT, priority TEXT NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High')),
 status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Completed')), notes TEXT, completed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK((status='Completed')=(completed_at IS NOT NULL))
);
CREATE TABLE appointments (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
 starts_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK(duration_minutes BETWEEN 1 AND 1440),
 location TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE activities (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, summary TEXT NOT NULL,
 contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);
CREATE TABLE board_state (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0), claim TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
INSERT INTO board_state(id,revision,updated_at) VALUES(1,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE pipeline_assertion (id INTEGER PRIMARY KEY CHECK(id=1), ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE TABLE login_attempts (
 subject_hash TEXT PRIMARY KEY, attempt_count INTEGER NOT NULL DEFAULT 0,
 window_started_at TEXT NOT NULL, blocked_until TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX idx_contacts_updated ON contacts(updated_at DESC);
CREATE INDEX idx_notes_contact ON contact_notes(contact_id,created_at DESC);
CREATE INDEX idx_opportunities_stage ON opportunities(stage,position);
CREATE INDEX idx_opportunities_contact ON opportunities(contact_id);
CREATE INDEX idx_tasks_due ON tasks(status,due_date);
CREATE INDEX idx_tasks_contact ON tasks(contact_id);
CREATE INDEX idx_appointments_start ON appointments(starts_at);
CREATE INDEX idx_activities_created ON activities(created_at DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_login_attempts_cleanup ON login_attempts(updated_at);

INSERT INTO schema_migrations(version,applied_at) VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- Added by the baseline schema above; included as part of the first migration.
-- Do not run table DDL from an application request.
