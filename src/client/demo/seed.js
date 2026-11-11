// Fictional sample data for the public demo. Mirrors src/server/seed.js, with every date moved
// so the sample week lines up with today.
const BASE_DAY = Date.UTC(2026, 10, 6); // The day the original sample was written around.

export function shiftFor(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - BASE_DAY) / 86_400_000);
}

const shiftDate = (value, days) => {
  if (!value) return value;
  const date = new Date(/T/.test(value) ? value : `${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return /T/.test(value) ? date.toISOString() : date.toISOString().slice(0, 10);
};

export function seedStatements(db, days = shiftFor()) {
  const d = (value) => shiftDate(value, days);
  const uuid = () => crypto.randomUUID();
  const out = [];
  const contacts = [
    ["Ava", "Martinez", "ava@northstar.example", "+1 415 555 0164", "Northstar Studio", "Founder", ["qualified", "design"], "2026-10-22T15:30:00.000Z"],
    ["Liam", "Chen", "liam@brightside.example", "+1 628 555 0112", "Brightside Media", "Marketing Director", ["new-lead", "inbound"], "2026-10-29T17:45:00.000Z"],
    ["Maya", "Patel", "maya@fieldwork.example", "+1 310 555 0121", "Fieldwork Events", "Operations Lead", ["referral", "priority"], "2026-10-18T20:10:00.000Z"],
    ["Noah", "Williams", "noah@cobalt.example", "+1 206 555 0183", "Cobalt Fitness", "Owner", ["website", "new-lead"], "2026-11-03T14:20:00.000Z"],
    ["Sofia", "Brooks", "sofia@solace.example", "+1 323 555 0144", "Solace Wellness", "Practice Manager", ["qualified", "referral"], "2026-10-07T19:00:00.000Z"],
    ["Ethan", "Kim", "ethan@commonthread.example", "+1 510 555 0139", "Common Thread", "Creative Director", ["past-client", "design"], "2026-09-28T18:15:00.000Z"],
  ];
  const ids = contacts.map(() => uuid());
  contacts.forEach(([first, last, email, phone, company, job, tags, created], i) =>
    out.push(db.prepare("INSERT INTO contacts(id,first_name,last_name,email,phone,company,job_title,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(ids[i], first, last, email, phone, company, job, JSON.stringify(tags), d(created), d(created))));
  [
    [0, "Ava wants one shared place for leads, follow-ups, and client onboarding. Send a focused proposal.", "2026-11-05T16:30:00.000Z"],
    [2, "Referred by Sofia. Planning a spring workshop series and needs an easy booking workflow.", "2026-11-04T18:20:00.000Z"],
    [4, "Prefers a concise recap after calls. Their current process lives across several spreadsheets.", "2026-11-02T21:10:00.000Z"],
  ].forEach(([i, body, created]) =>
    out.push(db.prepare("INSERT INTO contact_notes(id,contact_id,body,author,created_at) VALUES(?,?,?,?,?)").bind(uuid(), ids[i], body, "Sample note", d(created))));
  [
    ["Brand refresh & lead capture", 0, "Proposal", 1240000, 1, "2026-11-20", "Scope agreed. Proposal needs final approval.", "2026-11-05T16:45:00.000Z"],
    ["Workshop launch campaign", 2, "Booked", 780000, 1, "2026-11-28", "Discovery call scheduled for next week.", "2026-11-04T18:30:00.000Z"],
    ["Content engine pilot", 1, "Contacted", 450000, 1, "2026-12-04", "Sent capabilities overview; awaiting reply.", "2026-11-05T20:00:00.000Z"],
    ["Member onboarding flow", 3, "New Lead", 320000, 1, "2026-12-12", "Inbound website enquiry.", "2026-11-03T14:30:00.000Z"],
    ["Wellness client portal", 4, "Proposal", 950000, 0, "2026-11-25", "Two package options presented.", "2026-11-03T19:20:00.000Z"],
    ["Studio automation blueprint", 0, "Won", 860000, 0, "2026-11-01", "Completed discovery and roadmap engagement.", "2026-11-01T16:00:00.000Z"],
    ["Seasonal campaign retainer", 5, "New Lead", 280000, 0, "2026-12-15", "Past client exploring a new engagement.", "2026-10-30T17:00:00.000Z"],
    ["Event lead nurture sequence", 2, "Contacted", 540000, 0, "2026-12-01", null, "2026-10-31T14:30:00.000Z"],
  ].forEach(([title, i, stage, cents, position, close, note, created]) =>
    out.push(db.prepare("INSERT INTO opportunities(id,title,contact_id,stage,value_cents,position,expected_close_date,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(uuid(), title, ids[i], stage, cents, position, d(close), note, d(created), d(created))));
  [
    ["Review Northstar proposal", 0, "2026-11-06", "High", "Open", null, "Confirm final scope and success metrics.", "2026-11-05T17:00:00.000Z"],
    ["Send Fieldwork discovery questions", 2, "2026-11-06", "High", "Open", null, null, "2026-11-05T19:00:00.000Z"],
    ["Prepare Brightside capabilities deck", 1, "2026-11-09", "Medium", "Open", null, "Use the new studio campaign as a case study.", "2026-11-04T20:00:00.000Z"],
    ["Schedule Solace check-in", 4, "2026-11-10", "Medium", "Open", null, null, "2026-11-04T15:00:00.000Z"],
    ["Invite Noah to discovery call", 3, "2026-11-05", "Medium", "Open", null, null, "2026-11-03T15:00:00.000Z"],
    ["Log Northstar project handoff", 0, "2026-11-04", "Low", "Completed", "2026-11-04T18:00:00.000Z", null, "2026-11-02T15:00:00.000Z"],
  ].forEach(([title, i, due, priority, status, completed, note, created]) =>
    out.push(db.prepare("INSERT INTO tasks(id,title,contact_id,due_date,priority,status,notes,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(uuid(), title, ids[i], d(due), priority, status, note, d(completed), d(created), d(completed || created))));
  [
    ["Discovery call with Fieldwork", 2, "2026-11-06T18:00:00.000Z", 45, "Video call", "Discuss the spring workshop launch.", "2026-11-04T18:35:00.000Z"],
    ["Solace proposal review", 4, "2026-11-07T17:30:00.000Z", 30, "Video call", "Walk through both package options.", "2026-11-03T19:30:00.000Z"],
    ["Brightside campaign workshop", 1, "2026-11-10T19:00:00.000Z", 60, "Studio", "Define campaign goals and audience.", "2026-11-05T20:10:00.000Z"],
  ].forEach(([title, i, start, minutes, location, note, created]) =>
    out.push(db.prepare("INSERT INTO appointments(id,title,contact_id,starts_at,duration_minutes,location,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(uuid(), title, ids[i], d(start), minutes, location, note, d(created), d(created))));
  [
    ["opportunity", "Won Studio automation blueprint · $8,600", 0, "2026-11-01T16:00:00.000Z"],
    ["appointment", "Booked Discovery call with Fieldwork", 2, "2026-11-04T18:35:00.000Z"],
    ["note", "Added a project note for Ava Martinez", 0, "2026-11-05T16:30:00.000Z"],
    ["opportunity", "Moved Brand refresh & lead capture to Proposal", 0, "2026-11-05T16:45:00.000Z"],
    ["task", "Created Review Northstar proposal", 0, "2026-11-05T17:00:00.000Z"],
  ].forEach(([kind, summary, i, created]) =>
    out.push(db.prepare("INSERT INTO activities(id,kind,summary,contact_id,created_at) VALUES(?,?,?,?,?)").bind(uuid(), kind, summary, ids[i], d(created))));
  return out;
}
