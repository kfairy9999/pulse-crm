import { id, now, transaction, recordActivity } from './db.js';

export function seedSampleData(db, { force = false, allowSample = true } = {}) {
  if (!allowSample) throw new Error('Production cannot seed fictional sample data.');
  const state = db.prepare("SELECT value FROM app_metadata WHERE key = 'sample_seed'").get();
  if (state && !force) return false;
  transaction(db, () => {
    const seedId = id();
    db.prepare(`INSERT INTO app_metadata(key, value, created_at) VALUES('sample_seed', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`).run(seedId, now());
    const contacts = [
      ['Ava', 'Martinez', 'ava@northstar.studio', '+1 415 555 0164', 'Northstar Studio', 'Founder', ['qualified', 'design'], '2026-10-22T15:30:00.000Z'],
      ['Liam', 'Chen', 'liam@brightside.example', '+1 628 555 0112', 'Brightside Media', 'Marketing Director', ['new-lead', 'inbound'], '2026-10-29T17:45:00.000Z'],
      ['Maya', 'Patel', 'maya@fieldwork.example', '+1 310 555 0121', 'Fieldwork Events', 'Operations Lead', ['referral', 'priority'], '2026-10-18T20:10:00.000Z'],
      ['Noah', 'Williams', 'noah@cobalt.example', '+1 206 555 0183', 'Cobalt Fitness', 'Owner', ['website', 'new-lead'], '2026-11-03T14:20:00.000Z'],
      ['Sofia', 'Brooks', 'sofia@solace.example', '+1 323 555 0144', 'Solace Wellness', 'Practice Manager', ['qualified', 'referral'], '2026-10-07T19:00:00.000Z'],
      ['Ethan', 'Kim', 'ethan@commonthread.example', '+1 510 555 0139', 'Common Thread', 'Creative Director', ['past-client', 'design'], '2026-09-28T18:15:00.000Z'],
    ];
    const contactIds = [];
    const addContact = db.prepare('INSERT INTO contacts(id, first_name, last_name, email, phone, company, job_title, tags, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [first, last, email, phone, company, job, tags, created] of contacts) {
      const contactId = id();
      contactIds.push(contactId);
      addContact.run(contactId, first, last, email, phone, company, job, JSON.stringify(tags), created, created);
    }
    const notes = [
      [0, 'Ava wants one shared place for leads, follow-ups, and client onboarding. Send a focused proposal.', '2026-11-05T16:30:00.000Z'],
      [2, 'Referred by Sofia. Planning a spring workshop series and needs an easy booking workflow.', '2026-11-04T18:20:00.000Z'],
      [4, 'Prefers a concise recap after calls. Their current process lives across several spreadsheets.', '2026-11-02T21:10:00.000Z'],
    ];
    const addNote = db.prepare('INSERT INTO contact_notes(id, contact_id, body, author, created_at) VALUES(?, ?, ?, \'Sample note\', ?)');
    notes.forEach(([index, body, created]) => addNote.run(id(), contactIds[index], body, created));
    const opportunities = [
      ['Brand refresh & lead capture', 0, 'Proposal', 1240000, 1, '2026-11-20', 'Scope agreed. Proposal needs final approval.', '2026-11-05T16:45:00.000Z'],
      ['Workshop launch campaign', 2, 'Booked', 780000, 1, '2026-11-28', 'Discovery call scheduled for next week.', '2026-11-04T18:30:00.000Z'],
      ['Content engine pilot', 1, 'Contacted', 450000, 1, '2026-12-04', 'Sent capabilities overview; awaiting reply.', '2026-11-05T20:00:00.000Z'],
      ['Member onboarding flow', 3, 'New Lead', 320000, 1, '2026-12-12', 'Inbound website enquiry.', '2026-11-03T14:30:00.000Z'],
      ['Wellness client portal', 4, 'Proposal', 950000, 0, '2026-11-25', 'Two package options presented.', '2026-11-03T19:20:00.000Z'],
      ['Studio automation blueprint', 0, 'Won', 860000, 0, '2026-11-01', 'Completed discovery and roadmap engagement.', '2026-11-01T16:00:00.000Z'],
      ['Seasonal campaign retainer', 5, 'New Lead', 280000, 0, '2026-12-15', 'Past client exploring a new engagement.', '2026-10-30T17:00:00.000Z'],
      ['Event lead nurture sequence', 2, 'Contacted', 540000, 0, '2026-12-01', null, '2026-10-31T14:30:00.000Z'],
    ];
    const addOpportunity = db.prepare('INSERT INTO opportunities(id, title, contact_id, stage, value_cents, position, expected_close_date, notes, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    opportunities.forEach(([title, contact, stage, cents, position, close, note, created]) => addOpportunity.run(id(), title, contactIds[contact], stage, cents, position, close, note, created, created));
    const tasks = [
      ['Review Northstar proposal', 0, '2026-11-06', 'High', 'Open', null, 'Confirm final scope and success metrics.', '2026-11-05T17:00:00.000Z'],
      ['Send Fieldwork discovery questions', 2, '2026-11-06', 'High', 'Open', null, null, '2026-11-05T19:00:00.000Z'],
      ['Prepare Brightside capabilities deck', 1, '2026-11-09', 'Medium', 'Open', null, 'Use the new studio campaign as a case study.', '2026-11-04T20:00:00.000Z'],
      ['Schedule Solace check-in', 4, '2026-11-10', 'Medium', 'Open', null, null, '2026-11-04T15:00:00.000Z'],
      ['Invite Noah to discovery call', 3, '2026-11-07', 'Medium', 'Open', null, null, '2026-11-03T15:00:00.000Z'],
      ['Log Northstar project handoff', 0, '2026-11-04', 'Low', 'Completed', '2026-11-04T18:00:00.000Z', null, '2026-11-02T15:00:00.000Z'],
    ];
    const addTask = db.prepare('INSERT INTO tasks(id, title, contact_id, due_date, priority, status, notes, completed_at, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    tasks.forEach(([title, contact, due, priority, status, completed, note, created]) => addTask.run(id(), title, contactIds[contact], due, priority, status, note, completed, created, completed || created));
    const appointments = [
      ['Discovery call with Fieldwork', 2, '2026-11-09T18:00:00.000Z', 45, 'Video call · local record', 'Discuss the spring workshop launch.', '2026-11-04T18:35:00.000Z'],
      ['Solace proposal review', 4, '2026-11-11T17:30:00.000Z', 30, 'Video call · local record', 'Walk through both package options.', '2026-11-03T19:30:00.000Z'],
      ['Brightside campaign workshop', 1, '2026-11-13T19:00:00.000Z', 60, 'Studio · local record', 'Define campaign goals and audience.', '2026-11-05T20:10:00.000Z'],
    ];
    const addAppointment = db.prepare('INSERT INTO appointments(id, title, contact_id, starts_at, duration_minutes, location, notes, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)');
    appointments.forEach(([title, contact, start, duration, location, note, created]) => addAppointment.run(id(), title, contactIds[contact], start, duration, location, note, created, created));
    const activity = [
      ['opportunity', 'Won Studio automation blueprint · $8,600', contactIds[0], '2026-11-01T16:00:00.000Z'],
      ['appointment', 'Booked Discovery call with Fieldwork', contactIds[2], '2026-11-04T18:35:00.000Z'],
      ['note', 'Added a project note for Ava Martinez', contactIds[0], '2026-11-05T16:30:00.000Z'],
      ['opportunity', 'Moved Brand refresh & lead capture to Proposal', contactIds[0], '2026-11-05T16:45:00.000Z'],
      ['task', 'Created Review Northstar proposal', contactIds[0], '2026-11-05T17:00:00.000Z'],
    ];
    activity.forEach(([kind, summary, contact, created]) => recordActivity(db, kind, summary, contact, created));
  });
  return true;
}
