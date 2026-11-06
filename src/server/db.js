import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();
export const id = () => randomUUID();

export function createDatabase(filePath = process.env.DATABASE_PATH || './data/pulse.db') {
  const inMemory = [':memory:', 'file::memory:'].includes(filePath) || filePath.startsWith('file::memory:?');
  const filename = inMemory ? filePath : resolve(filePath);
  if (!inMemory) mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
  if (current < 1) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL DEFAULT '',
        email TEXT UNIQUE,
        phone TEXT,
        company TEXT,
        job_title TEXT,
        tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE contact_notes (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        body TEXT NOT NULL CHECK(length(trim(body)) > 0),
        author TEXT NOT NULL DEFAULT 'You',
        created_at TEXT NOT NULL
      );
      CREATE TABLE opportunities (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
        stage TEXT NOT NULL CHECK(stage IN ('New Lead','Contacted','Booked','Proposal','Won','Lost')),
        value_cents INTEGER NOT NULL DEFAULT 0 CHECK(value_cents >= 0),
        position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
        expected_close_date TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
        due_date TEXT,
        priority TEXT NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High')),
        status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Completed')),
        notes TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK((status = 'Completed') = (completed_at IS NOT NULL))
      );
      CREATE TABLE appointments (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
        starts_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK(duration_minutes BETWEEN 1 AND 1440),
        location TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_contacts_updated ON contacts(updated_at DESC);
      CREATE INDEX idx_notes_contact ON contact_notes(contact_id, created_at DESC);
      CREATE INDEX idx_opportunities_stage ON opportunities(stage, position);
      CREATE INDEX idx_opportunities_contact ON opportunities(contact_id);
      CREATE INDEX idx_tasks_due ON tasks(status, due_date);
      CREATE INDEX idx_tasks_contact ON tasks(contact_id);
      CREATE INDEX idx_appointments_start ON appointments(starts_at);
      CREATE INDEX idx_activities_created ON activities(created_at DESC);
      INSERT INTO schema_migrations VALUES (1, '${now()}');
      COMMIT;
    `);
  }
}

export function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = callback();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function fullContactName(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ');
}

export function requireExists(db, table, recordId, label = 'Contact') {
  if (!recordId) return;
  const allowed = { contacts: 'contacts' };
  if (!allowed[table]) throw new Error('Invalid relationship table.');
  if (!db.prepare(`SELECT id FROM ${allowed[table]} WHERE id = ?`).get(recordId)) {
    const error = new Error(`${label} not found.`);
    error.status = 400;
    throw error;
  }
}

export function assertUniqueEmail(db, email, contactId = null) {
  if (!email) return;
  const row = db.prepare('SELECT id FROM contacts WHERE email = ? AND id != COALESCE(?, \'\')').get(email, contactId);
  if (row) {
    const error = new Error('A contact with this email already exists.');
    error.status = 409;
    error.fields = { email: 'This email is already in use.' };
    throw error;
  }
}

export function mapContact(row) {
  return {
    ...row,
    name: fullContactName(row),
    tags: JSON.parse(row.tags || '[]'),
  };
}

export function mapOpportunity(row) {
  if (!row) return row;
  const { value_cents, ...rest } = row;
  return { ...rest, value: value_cents / 100, value_cents };
}

export function recordActivity(db, kind, summary, contactId = null, createdAt = now()) {
  db.prepare('INSERT INTO activities(id, kind, summary, contact_id, created_at) VALUES(?, ?, ?, ?, ?)')
    .run(id(), kind, summary, contactId, createdAt);
}

export function getContact(db, contactId) {
  const contact = db.prepare(`SELECT c.*,
    (SELECT COUNT(*) FROM opportunities o WHERE o.contact_id = c.id) AS opportunity_count,
    (SELECT COUNT(*) FROM contact_notes n WHERE n.contact_id = c.id) AS note_count
    FROM contacts c WHERE c.id = ?`).get(contactId);
  if (!contact) {
    const error = new Error('Contact not found.');
    error.status = 404;
    throw error;
  }
  return mapContact(contact);
}

export function getOpportunity(db, opportunityId) {
  const row = db.prepare(`SELECT o.*, c.first_name, c.last_name, c.company,
    c.first_name || CASE WHEN c.last_name <> '' THEN ' ' || c.last_name ELSE '' END AS contact_name
    FROM opportunities o JOIN contacts c ON c.id = o.contact_id WHERE o.id = ?`).get(opportunityId);
  if (!row) {
    const error = new Error('Opportunity not found.');
    error.status = 404;
    throw error;
  }
  return mapOpportunity(row);
}

export function getTask(db, taskId) {
  const row = db.prepare(`SELECT t.*, c.first_name || CASE WHEN c.last_name <> '' THEN ' ' || c.last_name ELSE '' END AS contact_name
    FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = ?`).get(taskId);
  if (!row) {
    const error = new Error('Task not found.');
    error.status = 404;
    throw error;
  }
  return row;
}

export function getAppointment(db, appointmentId) {
  const row = db.prepare(`SELECT a.*, c.first_name || CASE WHEN c.last_name <> '' THEN ' ' || c.last_name ELSE '' END AS contact_name
    FROM appointments a LEFT JOIN contacts c ON c.id = a.contact_id WHERE a.id = ?`).get(appointmentId);
  if (!row) {
    const error = new Error('Appointment not found.');
    error.status = 404;
    throw error;
  }
  return row;
}
