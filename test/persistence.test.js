import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, transaction, id, now } from '../src/server/db.js';
import { seedSampleData } from '../src/server/seed.js';
import { createFixture } from './helpers.js';

test('real SQLite file preserves contacts, notes, deals, tasks and appointments across restart', async (t) => {
  const file = join(mkdtempSync(join(tmpdir(), 'pulse-crm-test-')), 'restart.db');
  const db = createDatabase(file);
  const first = await createFixture(t, { db });
  const person = await first.contact({ first_name: 'Durable', email: 'durable@example.test', tags: ['persisted'] });
  await first.request(`/contacts/${person.id}/notes`, { method: 'POST', body: { body: 'Still here after restart' }, expectedStatus: 201 });
  const deal = (await first.request('/opportunities', { method: 'POST', body: { title: 'Persistent deal', contact_id: person.id, stage: 'Booked', value: 4321 }, expectedStatus: 201 })).payload.opportunity;
  const task = (await first.request('/tasks', { method: 'POST', body: { title: 'Persistent task', contact_id: person.id, due_date: '2026-11-30' }, expectedStatus: 201 })).payload.task;
  await first.request(`/tasks/${task.id}`, { method: 'PATCH', body: { completed: true }, expectedStatus: 200 });
  const appointment = (await first.request('/appointments', { method: 'POST', body: { title: 'Persistent meeting', contact_id: person.id, starts_at: '2026-12-05T17:00:00Z', duration_minutes: 45 }, expectedStatus: 201 })).payload.appointment;
  await first.request(`/opportunities/${deal.id}`, { method: 'PATCH', body: { stage: 'Won' }, expectedStatus: 200 });
  db.close();
  const reopened = createDatabase(file);
  const second = await createFixture(t, { db: reopened });
  const detail = (await second.request(`/contacts/${person.id}`, { expectedStatus: 200 })).payload;
  assert.equal(detail.contact.email, 'durable@example.test');
  assert.deepEqual(detail.contact.tags, ['persisted']);
  assert.equal(detail.notes[0].body, 'Still here after restart');
  assert.equal(detail.opportunities[0].title, 'Persistent deal');
  assert.equal(detail.opportunities[0].stage, 'Won');
  assert.equal(detail.opportunities[0].value, 4321);
  assert.equal(detail.tasks[0].status, 'Completed');
  assert.ok(detail.tasks[0].completed_at);
  assert.equal(detail.appointments[0].starts_at, '2026-12-05T17:00:00.000Z');
  const dashboard = (await second.request('/dashboard', { expectedStatus: 200 })).payload;
  assert.equal(dashboard.metrics.openPipeline, 0);
  assert.equal(dashboard.metrics.wonValue, 4321);
  assert.equal(dashboard.metrics.activeContacts, 1);
  assert.equal(dashboard.metrics.openTasks, 0);
  reopened.close();
  rmSync(file, { force: true });
  rmSync(`${file}-wal`, { force: true });
  rmSync(`${file}-shm`, { force: true });
  rmSync(join(file, '..'), { recursive: true, force: true });
});

test('sample seed is idempotent, labeled, and does not resurrect deleted user data', async (t) => {
  const db = createDatabase('file::memory:');
  t.after(() => db.close());
  assert.equal(seedSampleData(db), true);
  const firstContacts = db.prepare('SELECT id,email FROM contacts ORDER BY created_at').all();
  const counts = Object.fromEntries(['contacts', 'contact_notes', 'opportunities', 'tasks', 'appointments', 'activities'].map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  assert.equal(counts.contacts, 6);
  assert.equal(counts.opportunities, 8);
  assert.equal(counts.tasks, 6);
  assert.equal(counts.appointments, 3);
  assert.equal(db.prepare('SELECT COUNT(DISTINCT author) AS count FROM contact_notes').get().count, 1);
  assert.equal(db.prepare('SELECT MIN(author) AS author FROM contact_notes').get().author, 'Sample note');
  assert.equal(seedSampleData(db), false);
  assert.deepEqual(db.prepare('SELECT id,email FROM contacts ORDER BY created_at').all(), firstContacts);
  for (const [table, count] of Object.entries(counts)) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, count, table);
  transaction(db, () => {
    db.prepare("DELETE FROM opportunities WHERE title = 'Member onboarding flow'").run();
    db.prepare('DELETE FROM contacts WHERE id = ?').run(firstContacts.find((row) => row.email === 'noah@cobalt.example').id);
  });
  db.prepare("DELETE FROM tasks WHERE title = 'Review Northstar proposal'").run();
  assert.equal(seedSampleData(db), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM contacts').get().count, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 5);
});

test('transaction rollback preserves all records when activity insertion fails', async (t) => {
  const db = createDatabase('file::memory:');
  t.after(() => db.close());
  const contactId = id();
  const timestamp = now();
  db.prepare(`INSERT INTO contacts(id,first_name,last_name,email,phone,company,job_title,tags,created_at,updated_at) VALUES(?,'Atomic','Test',NULL,NULL,NULL,NULL,'[]',?,?)`).run(contactId, timestamp, timestamp);
  assert.throws(() => transaction(db, () => {
    db.prepare('UPDATE contacts SET first_name = ? WHERE id = ?').run('Should not commit', contactId);
    db.prepare('INSERT INTO activities(id,kind,summary,contact_id,created_at) VALUES(?,?,?,?,?)').run(contactId, 'test', 'Violates primary key', contactId, timestamp);
    db.prepare('INSERT INTO activities(id,kind,summary,contact_id,created_at) VALUES(?,?,?,?,?)').run(contactId, 'test', 'Violates primary key', contactId, timestamp);
  }));
  assert.equal(db.prepare('SELECT first_name FROM contacts WHERE id = ?').get(contactId).first_name, 'Atomic');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM activities').get().count, 0);
});
