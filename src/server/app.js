import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DomainError, PIPELINE_STAGES, STAGE_WEIGHTS, TASK_PRIORITIES, TASK_STATUSES,
  requiredText, optionalText, optionalEmail, optionalPhone, cleanTags,
  moneyToCents, isoDateTime, dueDate, choice, booleanValue, positiveInteger,
} from '../shared.js';
import {
  id, now, transaction, mapContact, mapOpportunity, getContact, getOpportunity,
  getTask, getAppointment, requireExists, assertUniqueEmail, recordActivity, fullContactName,
} from './db.js';
import { seedSampleData } from './seed.js';
import { createAuthRouter, getSession, requireAuth } from './auth.js';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);
const expectBody = (body) => { if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DomainError('A JSON request body is required.'); return body; };
const optionalRelation = (value) => value === '' || value === undefined ? null : optionalText(value, 'Contact', 100);
const contactSelect = `SELECT c.*,
  (SELECT COUNT(*) FROM opportunities o WHERE o.contact_id = c.id) AS opportunity_count,
  (SELECT COUNT(*) FROM contact_notes n WHERE n.contact_id = c.id) AS note_count
  FROM contacts c`;

function normalizeContact(db, body, previous = null) {
  const get = (key) => has(body, key) ? body[key] : previous?.[key];
  const result = {
    first_name: requiredText(get('first_name'), 'First name', 80),
    last_name: optionalText(get('last_name'), 'Last name', 80) || '',
    email: optionalEmail(get('email')),
    phone: optionalPhone(get('phone')),
    company: optionalText(get('company'), 'Company', 120),
    job_title: optionalText(get('job_title'), 'Job title', 120),
    tags: JSON.stringify(cleanTags(get('tags'))),
  };
  assertUniqueEmail(db, result.email, previous?.id);
  return result;
}

export function createApp({ db, staticDir = DIST, auth = { enabled: false } } = {}) {
  if (!db) throw new Error('A database is required.');
  const app = express();
  app.disable('x-powered-by');
  if (auth.enabled) app.set('trust proxy', auth.trustProxy ? 1 : false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '200kb', strict: true }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Pulse CRM', version: 1 }));
  if (!auth.enabled) {
    app.get('/api/auth/session', (req, res) => res.json({ authenticated: true, user: null, setupRequired: false }));
  }
  if (auth.enabled) {
    app.use('/api/auth', createAuthRouter({ db, ttlDays: auth.ttlDays, appOrigin: auth.appOrigin, production: auth.production, setupToken: auth.setupToken }));
    app.use('/api', requireAuth(db));
  }
  app.get('/api/metadata', (req, res) => res.json({
    name: 'Pulse CRM',
    pipelineStages: PIPELINE_STAGES,
    sampleDataSeeded: Boolean(db.prepare("SELECT 1 FROM app_metadata WHERE key = 'sample_seed'").get()),
    mode: 'local-single-user',
  }));

  app.get('/api/dashboard', route((req, res) => {
    const opportunities = db.prepare('SELECT stage, value_cents, updated_at FROM opportunities').all();
    const open = opportunities.filter((item) => !['Won', 'Lost'].includes(item.stage));
    const won = opportunities.filter((item) => item.stage === 'Won');
    const lost = opportunities.filter((item) => item.stage === 'Lost');
    const openValue = open.reduce((sum, item) => sum + item.value_cents, 0);
    const weightedValue = open.reduce((sum, item) => sum + Math.round(item.value_cents * STAGE_WEIGHTS[item.stage]), 0);
    const today = new Date().toISOString().slice(0, 10);
    const tasks = db.prepare(`SELECT t.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, CASE t.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, t.created_at DESC LIMIT 8`).all();
    const upcoming = db.prepare(`SELECT a.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name FROM appointments a LEFT JOIN contacts c ON c.id = a.contact_id WHERE a.starts_at >= ? ORDER BY a.starts_at LIMIT 5`).all(now());
    const activity = db.prepare(`SELECT a.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name FROM activities a LEFT JOIN contacts c ON c.id = a.contact_id ORDER BY a.created_at DESC LIMIT 8`).all();
    const monthly = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() - (5 - index));
      const key = date.toISOString().slice(0, 7);
      return {
        month: date.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), key,
        value: opportunities.filter((item) => item.updated_at.startsWith(key) && item.stage !== 'Lost').reduce((sum, item) => sum + item.value_cents, 0) / 100,
      };
    });
    res.json({
      metrics: {
        openPipeline: openValue / 100,
        weightedPipeline: weightedValue / 100,
        wonValue: won.reduce((sum, item) => sum + item.value_cents, 0) / 100,
        activeContacts: db.prepare('SELECT COUNT(*) AS count FROM contacts').get().count,
        openTasks: db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'Open'").get().count,
        dueToday: db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'Open' AND due_date = ?").get(today).count,
        winRate: won.length + lost.length ? Math.round(won.length / (won.length + lost.length) * 100) : null,
      },
      tasks, upcoming, activity, monthly,
      recentContacts: db.prepare(`${contactSelect} ORDER BY c.created_at DESC LIMIT 5`).all().map(mapContact),
    });
  }));

  app.get('/api/contacts', route((req, res) => {
    const q = optionalText(req.query.q, 'Search', 160);
    const tag = optionalText(req.query.tag, 'Tag', 32)?.toLowerCase();
    const params = [];
    const clauses = [];
    if (q) {
      clauses.push(`(c.first_name LIKE ? ESCAPE char(92) OR c.last_name LIKE ? ESCAPE char(92) OR c.company LIKE ? ESCAPE char(92) OR c.email LIKE ? ESCAPE char(92) OR (c.first_name || ' ' || c.last_name) LIKE ? ESCAPE char(92))`);
      const slash = String.fromCharCode(92);
      const escaped = q.replaceAll(slash, slash + slash).replaceAll('%', slash + '%').replaceAll('_', slash + '_');
      params.push(...Array(5).fill(`%${escaped}%`));
    }
    if (tag) { clauses.push('EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = ?)'); params.push(tag); }
    const rows = db.prepare(`${contactSelect}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY LOWER(c.first_name), LOWER(c.last_name), c.created_at DESC`).all(...params);
    res.json({ contacts: rows.map(mapContact), total: rows.length, tags: [...new Set(db.prepare('SELECT tags FROM contacts').all().flatMap((row) => JSON.parse(row.tags)))].sort() });
  }));

  app.get('/api/contacts/:contactId', route((req, res) => {
    const contact = getContact(db, req.params.contactId);
    res.json({
      contact,
      notes: db.prepare('SELECT * FROM contact_notes WHERE contact_id = ? ORDER BY created_at DESC').all(contact.id),
      opportunities: db.prepare('SELECT * FROM opportunities WHERE contact_id = ? ORDER BY updated_at DESC').all(contact.id).map(mapOpportunity),
      tasks: db.prepare('SELECT * FROM tasks WHERE contact_id = ? ORDER BY status, due_date').all(contact.id),
      appointments: db.prepare('SELECT * FROM appointments WHERE contact_id = ? ORDER BY starts_at DESC').all(contact.id),
    });
  }));

  app.post('/api/contacts', route((req, res) => {
    const body = normalizeContact(db, expectBody(req.body));
    const contactId = id();
    transaction(db, () => {
      db.prepare('INSERT INTO contacts(id, first_name, last_name, email, phone, company, job_title, tags, created_at, updated_at) VALUES(@id, @first_name, @last_name, @email, @phone, @company, @job_title, @tags, @created_at, @updated_at)').run({ ...body, id: contactId, created_at: now(), updated_at: now() });
      const contact = getContact(db, contactId);
      recordActivity(db, 'contact', `Added ${contact.name} to contacts`, contactId);
    });
    res.status(201).json({ contact: getContact(db, contactId) });
  }));

  app.patch('/api/contacts/:contactId', route((req, res) => {
    const previous = getContact(db, req.params.contactId);
    transaction(db, () => {
      const body = normalizeContact(db, expectBody(req.body), previous);
      db.prepare('UPDATE contacts SET first_name=@first_name, last_name=@last_name, email=@email, phone=@phone, company=@company, job_title=@job_title, tags=@tags, updated_at=@updated_at WHERE id=@id').run({ ...body, updated_at: now(), id: previous.id });
      recordActivity(db, 'contact', `Updated ${fullContactName(body)}'s contact`, previous.id);
    });
    res.json({ contact: getContact(db, previous.id) });
  }));

  app.delete('/api/contacts/:contactId', route((req, res) => {
    const contact = getContact(db, req.params.contactId);
    const deals = db.prepare('SELECT COUNT(*) AS count FROM opportunities WHERE contact_id = ?').get(contact.id).count;
    if (deals) throw new DomainError(`This contact has ${deals} ${deals === 1 ? 'opportunity' : 'opportunities'}. Delete or reassign ${deals === 1 ? 'it' : 'them'} first.`, 409);
    transaction(db, () => {
      recordActivity(db, 'contact', `Removed ${contact.name} from contacts`);
      db.prepare('DELETE FROM contacts WHERE id = ?').run(contact.id);
    });
    res.json({ deleted: contact.id });
  }));

  app.post('/api/contacts/:contactId/notes', route((req, res) => {
    const contact = getContact(db, req.params.contactId);
    const body = requiredText(expectBody(req.body).body, 'Note', 5000);
    const noteId = id();
    transaction(db, () => {
      db.prepare('INSERT INTO contact_notes(id, contact_id, body, author, created_at) VALUES(?, ?, ?, \'You\', ?)').run(noteId, contact.id, body, now());
      recordActivity(db, 'note', `Added a note for ${contact.name}`, contact.id);
    });
    res.status(201).json({ note: db.prepare('SELECT * FROM contact_notes WHERE id = ?').get(noteId) });
  }));

  app.get('/api/opportunities/:opportunityId', route((req, res) => res.json({ opportunity: getOpportunity(db, req.params.opportunityId) })));

  app.get('/api/opportunities', route((req, res) => {
    const q = optionalText(req.query.q, 'Search', 160);
    const rows = db.prepare(`SELECT o.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name, c.company FROM opportunities o JOIN contacts c ON c.id = o.contact_id ${q ? 'WHERE o.title LIKE ? OR c.company LIKE ? OR (c.first_name || \' \' || c.last_name) LIKE ?' : ''} ORDER BY o.position, o.created_at`).all(...(q ? Array(3).fill(`%${q}%`) : []));
    const stages = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, rows.filter((row) => row.stage === stage).map(mapOpportunity)]));
    res.json({ stages, total: rows.length });
  }));

  function opportunityInput(body, previous = null) {
    const get = (key) => has(body, key) ? body[key] : previous?.[key];
    const contactId = requiredText(get('contact_id'), 'Contact', 100);
    requireExists(db, 'contacts', contactId);
    return {
      title: requiredText(get('title'), 'Title', 180),
      contact_id: contactId,
      stage: choice(get('stage') || 'New Lead', PIPELINE_STAGES, 'Stage'),
      value_cents: moneyToCents(has(body, 'value_cents') ? Number(get('value_cents')) / 100 : get('value')),
      expected_close_date: dueDate(get('expected_close_date')),
      notes: optionalText(get('notes'), 'Notes', 4000),
    };
  }

  function reorderStage(db, moving, targetStage, requestedPosition) {
    const source = db.prepare('SELECT id FROM opportunities WHERE stage = ? AND id != ? ORDER BY position, created_at').all(moving.stage, moving.id).map((row) => row.id);
    const target = targetStage === moving.stage ? [...source] : db.prepare('SELECT id FROM opportunities WHERE stage = ? AND id != ? ORDER BY position, created_at').all(targetStage, moving.id).map((row) => row.id);
    const index = Math.max(0, Math.min(Number.isInteger(requestedPosition) ? requestedPosition : target.length, target.length));
    target.splice(index, 0, moving.id);
    const stamp = now();
    source.forEach((opportunityId, position) => db.prepare('UPDATE opportunities SET position = ?, updated_at = ? WHERE id = ?').run(position, stamp, opportunityId));
    target.forEach((opportunityId, position) => db.prepare('UPDATE opportunities SET stage = ?, position = ?, updated_at = ? WHERE id = ?').run(targetStage, position, stamp, opportunityId));
  }

  app.post('/api/opportunities', route((req, res) => {
    const body = opportunityInput(expectBody(req.body));
    const opportunityId = id();
    transaction(db, () => {
      const position = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS position FROM opportunities WHERE stage = ?').get(body.stage).position;
      db.prepare('INSERT INTO opportunities(id, title, contact_id, stage, value_cents, position, expected_close_date, notes, created_at, updated_at) VALUES(@id, @title, @contact_id, @stage, @value_cents, @position, @expected_close_date, @notes, @created_at, @updated_at)').run({ ...body, id: opportunityId, position, created_at: now(), updated_at: now() });
      const opportunity = getOpportunity(db, opportunityId);
      recordActivity(db, 'opportunity', `Created ${opportunity.title} in ${opportunity.stage}`, opportunity.contact_id);
    });
    res.status(201).json({ opportunity: getOpportunity(db, opportunityId) });
  }));

  app.patch('/api/opportunities/:opportunityId', route((req, res) => {
    const previous = getOpportunity(db, req.params.opportunityId);
    const request = expectBody(req.body);
    const body = opportunityInput(request, previous);
    const position = has(request, 'position') ? (Number.isInteger(request.position) && request.position >= 0 && request.position <= 100000 ? request.position : (() => { throw new DomainError('Position must be a whole number from 0 to 100,000.'); })()) : null;
    transaction(db, () => {
      const { stage, ...values } = body;
      db.prepare('UPDATE opportunities SET title=@title, contact_id=@contact_id, value_cents=@value_cents, expected_close_date=@expected_close_date, notes=@notes, updated_at=@updated_at WHERE id=@id').run({ ...values, id: previous.id, updated_at: now() });
      reorderStage(db, previous, body.stage, position ?? (previous.stage === body.stage ? previous.position : null));
      recordActivity(db, 'opportunity', previous.stage === body.stage ? `Updated ${body.title}` : `Moved ${body.title} from ${previous.stage} to ${body.stage}`, body.contact_id);
    });
    res.json({ opportunity: getOpportunity(db, previous.id) });
  }));

  app.delete('/api/opportunities/:opportunityId', route((req, res) => {
    const opportunity = getOpportunity(db, req.params.opportunityId);
    transaction(db, () => {
      db.prepare('DELETE FROM opportunities WHERE id = ?').run(opportunity.id);
      db.prepare('SELECT id FROM opportunities WHERE stage = ? ORDER BY position').all(opportunity.stage).forEach((row, position) => db.prepare('UPDATE opportunities SET position = ? WHERE id = ?').run(position, row.id));
      recordActivity(db, 'opportunity', `Deleted opportunity ${opportunity.title}`, opportunity.contact_id);
    });
    res.json({ deleted: opportunity.id });
  }));

  function taskInput(body, previous = null) {
    const get = (key) => has(body, key) ? body[key] : previous?.[key];
    const contactId = optionalRelation(get('contact_id'));
    if (contactId) requireExists(db, 'contacts', contactId);
    const explicitStatus = has(body, 'status') ? choice(body.status, TASK_STATUSES, 'Status') : null;
    const status = has(body, 'completed') ? (booleanValue(body.completed) ? 'Completed' : 'Open') : explicitStatus || previous?.status || 'Open';
    const completedAt = status === 'Completed' ? (previous?.status === 'Completed' && !has(body, 'status') && !has(body, 'completed') ? previous.completed_at : previous?.status === 'Completed' && status === 'Completed' ? previous.completed_at : now()) : null;
    return {
      title: requiredText(get('title'), 'Title', 180),
      contact_id: contactId,
      due_date: dueDate(get('due_date')),
      priority: choice(get('priority') || 'Medium', TASK_PRIORITIES, 'Priority'),
      status,
      notes: optionalText(get('notes'), 'Notes', 4000),
      completed_at: completedAt,
    };
  }

  app.get('/api/tasks', route((req, res) => {
    const status = req.query.status ? choice(req.query.status, ['All', ...TASK_STATUSES], 'Status') : 'All';
    const tasks = db.prepare(`SELECT t.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id ORDER BY CASE t.status WHEN 'Open' THEN 0 ELSE 1 END, CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, CASE t.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, t.created_at DESC`).all();
    const filtered = status === 'All' ? tasks : tasks.filter((task) => task.status === status);
    res.json({ tasks: filtered, counts: { all: tasks.length, open: tasks.filter((task) => task.status === 'Open').length, completed: tasks.filter((task) => task.status === 'Completed').length, highPriority: tasks.filter((task) => task.status === 'Open' && task.priority === 'High').length }, today: new Date().toISOString().slice(0, 10) });
  }));

  app.get('/api/tasks/:taskId', route((req, res) => res.json({ task: getTask(db, req.params.taskId) })));

  app.post('/api/tasks', route((req, res) => {
    const body = taskInput(expectBody(req.body));
    const taskId = id();
    const timestamp = now();
    if (body.completed_at) body.completed_at = timestamp;
    transaction(db, () => {
      db.prepare('INSERT INTO tasks(id, title, contact_id, due_date, priority, status, notes, completed_at, created_at, updated_at) VALUES(@id, @title, @contact_id, @due_date, @priority, @status, @notes, @completed_at, @created_at, @updated_at)').run({ ...body, id: taskId, created_at: timestamp, updated_at: timestamp });
      recordActivity(db, 'task', `Created task ${body.title}`, body.contact_id);
    });
    res.status(201).json({ task: getTask(db, taskId) });
  }));

  app.patch('/api/tasks/:taskId', route((req, res) => {
    const previous = getTask(db, req.params.taskId);
    const body = taskInput(expectBody(req.body), previous);
    transaction(db, () => {
      db.prepare('UPDATE tasks SET title=@title, contact_id=@contact_id, due_date=@due_date, priority=@priority, status=@status, notes=@notes, completed_at=@completed_at, updated_at=@updated_at WHERE id=@id').run({ ...body, id: previous.id, updated_at: now() });
      recordActivity(db, 'task', body.status === 'Completed' && previous.status !== 'Completed' ? `Completed ${body.title}` : `Updated task ${body.title}`, body.contact_id);
    });
    res.json({ task: getTask(db, previous.id) });
  }));

  app.delete('/api/tasks/:taskId', route((req, res) => {
    const task = getTask(db, req.params.taskId);
    transaction(db, () => {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
      recordActivity(db, 'task', `Deleted task ${task.title}`, task.contact_id);
    });
    res.json({ deleted: task.id });
  }));

  function appointmentInput(body, previous = null) {
    const get = (key) => has(body, key) ? body[key] : previous?.[key];
    const contactId = optionalRelation(get('contact_id'));
    if (contactId) requireExists(db, 'contacts', contactId);
    return {
      title: requiredText(get('title'), 'Title', 180),
      contact_id: contactId,
      starts_at: isoDateTime(get('starts_at')),
      duration_minutes: positiveInteger(get('duration_minutes') ?? 30, 'Duration', 1440),
      location: optionalText(get('location'), 'Location', 240),
      notes: optionalText(get('notes'), 'Notes', 4000),
    };
  }

  app.get('/api/appointments', route((req, res) => {
    const appointments = db.prepare(`SELECT a.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name, c.company FROM appointments a LEFT JOIN contacts c ON c.id = a.contact_id ORDER BY a.starts_at`).all();
    res.json({ appointments, upcoming: appointments.filter((appointment) => appointment.starts_at >= now()), past: appointments.filter((appointment) => appointment.starts_at < now()) });
  }));

  app.get('/api/appointments/:appointmentId', route((req, res) => res.json({ appointment: getAppointment(db, req.params.appointmentId) })));

  app.post('/api/appointments', route((req, res) => {
    const body = appointmentInput(expectBody(req.body));
    const appointmentId = id();
    transaction(db, () => {
      db.prepare('INSERT INTO appointments(id, title, contact_id, starts_at, duration_minutes, location, notes, created_at, updated_at) VALUES(@id, @title, @contact_id, @starts_at, @duration_minutes, @location, @notes, @created_at, @updated_at)').run({ ...body, id: appointmentId, created_at: now(), updated_at: now() });
      recordActivity(db, 'appointment', `Booked local appointment ${body.title}`, body.contact_id);
    });
    res.status(201).json({ appointment: getAppointment(db, appointmentId) });
  }));

  app.patch('/api/appointments/:appointmentId', route((req, res) => {
    const previous = getAppointment(db, req.params.appointmentId);
    const body = appointmentInput(expectBody(req.body), previous);
    transaction(db, () => {
      db.prepare('UPDATE appointments SET title=@title, contact_id=@contact_id, starts_at=@starts_at, duration_minutes=@duration_minutes, location=@location, notes=@notes, updated_at=@updated_at WHERE id=@id').run({ ...body, id: previous.id, updated_at: now() });
      recordActivity(db, 'appointment', `Updated local appointment ${body.title}`, body.contact_id);
    });
    res.json({ appointment: getAppointment(db, previous.id) });
  }));

  app.delete('/api/appointments/:appointmentId', route((req, res) => {
    const appointment = getAppointment(db, req.params.appointmentId);
    transaction(db, () => {
      db.prepare('DELETE FROM appointments WHERE id = ?').run(appointment.id);
      recordActivity(db, 'appointment', `Deleted local appointment ${appointment.title}`, appointment.contact_id);
    });
    res.json({ deleted: appointment.id });
  }));

  app.get('/api/inbox', route((req, res) => {
    const notes = db.prepare(`SELECT n.*, c.first_name, c.last_name, c.company, c.email, TRIM(c.first_name || ' ' || c.last_name) AS contact_name FROM contact_notes n JOIN contacts c ON c.id = n.contact_id ORDER BY n.created_at DESC`).all();
    res.json({ notes, mode: 'local-notes', externalConnections: [] });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  if (auth.enabled && staticDir && existsSync(staticDir)) {
    app.get(['/', '/{*path}'], (req, res, next) => {
      if (req.path !== '/' && !req.path.endsWith('.html')) return next();
      if (!getSession(db, req)) return res.status(401).send('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pulse CRM · Sign in required</title></head><body><main><h1>Sign in required</h1><p>This private CRM needs owner authentication. Enable JavaScript and open the app to sign in.</p><script>location.replace("/login")</script></main></body></html>');
      next();
    });
  }
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false }));
    app.get('/{*path}', (req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  } else {
    app.get('/', (req, res) => res.json({ name: 'Pulse CRM API', status: 'ok', message: 'Run npm run build to serve the web app on this port, or npm run dev for Vite on port 5173.' }));
  }

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Request body must be valid JSON.' });
    const status = error.status || (error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500);
    if (status >= 500) console.error('Pulse CRM request error:', error.message);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : error.message, ...(error.fields ? { fields: error.fields } : {}) });
  });
  return app;
}
