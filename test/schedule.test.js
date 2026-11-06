import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from './helpers.js';

test('tasks support CRUD, partial edits, filtering, and idempotent completion toggles', async (t) => {
  const { request, contact } = await createFixture(t);
  const person = await contact();
  const created = (await request('/tasks', { method: 'POST', body: { title: 'Prepare proposal', contact_id: person.id, due_date: '2026-12-01', priority: 'High', notes: 'Include scope' }, expectedStatus: 201 })).payload.task;
  assert.equal(created.status, 'Open');
  assert.equal(created.completed_at, null);
  assert.equal(created.contact_name, person.name);
  const updated = (await request(`/tasks/${created.id}`, { method: 'PATCH', body: { title: 'Prepare focused proposal', priority: 'Low' }, expectedStatus: 200 })).payload.task;
  assert.equal(updated.title, 'Prepare focused proposal');
  assert.equal(updated.priority, 'Low');
  assert.equal(updated.due_date, '2026-12-01');
  assert.equal(updated.contact_id, person.id);
  const completed = (await request(`/tasks/${created.id}`, { method: 'PATCH', body: { completed: true }, expectedStatus: 200 })).payload.task;
  assert.equal(completed.status, 'Completed');
  assert.ok(completed.completed_at);
  const completedAgain = (await request(`/tasks/${created.id}`, { method: 'PATCH', body: { completed: true }, expectedStatus: 200 })).payload.task;
  assert.equal(completedAgain.completed_at, completed.completed_at);
  const counts = (await request('/tasks', { expectedStatus: 200 })).payload.counts;
  assert.deepEqual(counts, { all: 1, open: 0, completed: 1, highPriority: 0 });
  const reopened = (await request(`/tasks/${created.id}`, { method: 'PATCH', body: { completed: false }, expectedStatus: 200 })).payload.task;
  assert.equal(reopened.status, 'Open');
  assert.equal(reopened.completed_at, null);
  const dashboard = (await request('/dashboard', { expectedStatus: 200 })).payload;
  assert.equal(dashboard.metrics.openTasks, 1);
  await request(`/tasks/${created.id}`, { method: 'DELETE', expectedStatus: 200 });
  assert.equal((await request('/tasks', { expectedStatus: 200 })).payload.tasks.length, 0);
});

test('tasks reject invalid dates, priorities, references and statuses without changes', async (t) => {
  const { request } = await createFixture(t);
  await request('/tasks', { method: 'POST', body: { title: 'Bad task', due_date: '2026-02-30' }, expectedStatus: 400 });
  await request('/tasks', { method: 'POST', body: { title: 'Bad task', priority: 'Urgent!' }, expectedStatus: 400 });
  await request('/tasks', { method: 'POST', body: { title: 'Bad task', contact_id: 'not-there' }, expectedStatus: 400 });
  await request('/tasks', { method: 'POST', body: { title: 'Bad task', status: 'Closed' }, expectedStatus: 400 });
  const task = (await request('/tasks', { method: 'POST', body: { title: 'Good task' }, expectedStatus: 201 })).payload.task;
  await request(`/tasks/${task.id}`, { method: 'PATCH', body: { completed: 'yes' }, expectedStatus: 400 });
  assert.equal((await request('/tasks', { expectedStatus: 200 })).payload.tasks[0].status, 'Open');
});

test('appointments support local CRUD in UTC with no external calendar side effects', async (t) => {
  const { request, contact } = await createFixture(t);
  const person = await contact();
  const created = (await request('/appointments', { method: 'POST', body: { title: 'Discovery call', contact_id: person.id, starts_at: '2026-12-15T18:30:00-08:00', duration_minutes: 45, location: 'Video call · local record', notes: 'Discuss goals' }, expectedStatus: 201 })).payload.appointment;
  assert.equal(created.starts_at, '2026-12-16T02:30:00.000Z');
  assert.equal(created.duration_minutes, 45);
  assert.equal(created.contact_name, person.name);
  const updated = (await request(`/appointments/${created.id}`, { method: 'PATCH', body: { title: 'Focused discovery', duration_minutes: 60, location: '' }, expectedStatus: 200 })).payload.appointment;
  assert.equal(updated.title, 'Focused discovery');
  assert.equal(updated.duration_minutes, 60);
  assert.equal(updated.location, null);
  assert.equal(updated.starts_at, '2026-12-16T02:30:00.000Z');
  const response = await request('/appointments', { expectedStatus: 200 });
  assert.equal(response.payload.appointments.length, 1);
  assert.equal(response.payload.upcoming.length, 1);
  assert.equal(response.payload.past.length, 0);
  const inbox = (await request('/inbox', { expectedStatus: 200 })).payload;
  assert.deepEqual(inbox.externalConnections, []);
  await request(`/appointments/${created.id}`, { method: 'DELETE', expectedStatus: 200 });
  assert.equal((await request('/appointments', { expectedStatus: 200 })).payload.appointments.length, 0);
});

test('appointments validate timestamps and durations', async (t) => {
  const { request } = await createFixture(t);
  await request('/appointments', { method: 'POST', body: { title: 'Bad', starts_at: 'not-a-date', duration_minutes: 30 }, expectedStatus: 400 });
  await request('/appointments', { method: 'POST', body: { title: 'Bad', starts_at: '2026-12-01T18:00:00Z', duration_minutes: 0 }, expectedStatus: 400 });
  await request('/appointments', { method: 'POST', body: { title: 'Bad', starts_at: '2026-12-01T18:00:00Z', duration_minutes: 30.5 }, expectedStatus: 400 });
  const item = (await request('/appointments', { method: 'POST', body: { title: 'Good', starts_at: '2026-12-01T18:00:00Z', duration_minutes: 30 }, expectedStatus: 201 })).payload.appointment;
  await request(`/appointments/${item.id}`, { method: 'PATCH', body: { starts_at: '' }, expectedStatus: 400 });
  assert.equal((await request('/appointments', { expectedStatus: 200 })).payload.appointments[0].title, 'Good');
});
