import {
  DomainError,
  PIPELINE_STAGES,
  TASK_PRIORITIES,
  requiredText,
  optionalText,
  optionalEmail,
  optionalPhone,
  cleanTags,
  dueDate,
  choice,
} from "./shared.js";
import { id, now, one, all, statement, insertSQL, activity } from "./d1.js";

export const EXPORT_VERSION = 1;
export const IMPORT_ROW_LIMIT = 100;
export const EXPORT_ROW_LIMIT = 2000;
const WORKSPACE_KEY = "sales_workspace";
const RECURRENCES = ["daily", "weekly", "monthly"];

const emptyWorkspace = () => ({ tasks: {}, spawned: {}, rules: [], views: [] });

export function csvCell(value) {
  const text = value == null ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

export function contactsToCsv(contacts) {
  const header = ["First name", "Last name", "Email", "Phone", "Company", "Job title", "Tags"];
  const lines = [header.map(csvCell).join(",")];
  for (const contact of contacts) {
    const tags = Array.isArray(contact.tags) ? contact.tags.join(", ") : "";
    lines.push(
      [contact.first_name, contact.last_name, contact.email, contact.phone, contact.company, contact.job_title, tags]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function parseCsv(text) {
  if (typeof text !== "string") throw new DomainError("CSV text is required.");
  if (text.length > 150_000) throw new DomainError("CSV file is too large.");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const pushCell = () => { row.push(cell); cell = ""; };
  const pushRow = () => {
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") pushCell();
    else if (char === "\n") { pushCell(); pushRow(); }
    else if (char !== "\r") cell += char;
  }
  pushCell();
  pushRow();
  if (rows.length > IMPORT_ROW_LIMIT + 1)
    throw new DomainError(`Import at most ${IMPORT_ROW_LIMIT} contacts at a time.`);
  return rows;
}

const headerKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");
const headerFields = {
  firstname: "first_name",
  lastname: "last_name",
  email: "email",
  emailaddress: "email",
  phone: "phone",
  phonenumber: "phone",
  company: "company",
  jobtitle: "job_title",
  title: "job_title",
  tags: "tags",
};

export function previewImport(csv, existingEmails, mapping = null) {
  const table = parseCsv(csv);
  if (!table.length) return { columns: [], rows: [], summary: { create: 0, duplicate: 0, invalid: 0 } };
  const headers = table[0];
  const columns = headers.map((header, index) => {
    const requested = mapping && typeof mapping === "object" ? mapping[header] || mapping[index] : null;
    const field = requested === "ignore" ? null : requested || headerFields[headerKey(header)] || null;
    return { header, index, field };
  });
  const seen = new Set();
  const rows = table.slice(1, IMPORT_ROW_LIMIT + 1).map((values, index) => {
    const record = {};
    for (const column of columns) if (column.field) record[column.field] = values[column.index] || "";
    const issues = [];
    let status = "create";
    try {
      record.first_name = requiredText(record.first_name, "First name", 80);
      record.last_name = optionalText(record.last_name, "Last name", 80) || "";
      record.email = optionalEmail(record.email);
      record.phone = optionalPhone(record.phone);
      record.company = optionalText(record.company, "Company", 120);
      record.job_title = optionalText(record.job_title, "Job title", 120);
      record.tags = cleanTags(record.tags || "");
    } catch (error) {
      status = "invalid";
      issues.push(error.message || "This row is invalid.");
    }
    const email = typeof record.email === "string" ? record.email : null;
    if (status === "create" && email && (existingEmails.has(email) || seen.has(email))) {
      status = "duplicate";
      issues.push("A contact with this email already exists and will be skipped.");
    }
    if (email) seen.add(email);
    return { index: index + 2, status, issues, record };
  });
  return {
    columns,
    rows,
    summary: {
      create: rows.filter((row) => row.status === "create").length,
      duplicate: rows.filter((row) => row.status === "duplicate").length,
      invalid: rows.filter((row) => row.status === "invalid").length,
    },
  };
}

export function nextDueDate(due, recurrence) {
  if (!RECURRENCES.includes(recurrence) || !/^\d{4}-\d{2}-\d{2}$/.test(due || "")) return null;
  const [year, month, day] = due.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (recurrence === "daily") date.setUTCDate(date.getUTCDate() + 1);
  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  if (recurrence === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function normalizeWorkspace(value) {
  const workspace = emptyWorkspace();
  if (!value || typeof value !== "object") return workspace;
  workspace.tasks = value.tasks && typeof value.tasks === "object" ? value.tasks : {};
  workspace.spawned = value.spawned && typeof value.spawned === "object" ? value.spawned : {};
  workspace.rules = Array.isArray(value.rules) ? value.rules.slice(0, 12) : [];
  workspace.views = Array.isArray(value.views) ? value.views.slice(0, 20) : [];
  return workspace;
}

export async function loadWorkspace(db) {
  const row = await one(db, "SELECT value FROM app_metadata WHERE key=?", WORKSPACE_KEY);
  if (!row?.value) return emptyWorkspace();
  try { return normalizeWorkspace(JSON.parse(row.value)); } catch { return emptyWorkspace(); }
}

export async function saveWorkspace(db, workspace) {
  const payload = JSON.stringify(normalizeWorkspace(workspace));
  if (payload.length > 100_000) throw new DomainError("Saved follow-up settings are too large.");
  await db.prepare(
    "INSERT INTO app_metadata(key,value,created_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).bind(WORKSPACE_KEY, payload, now()).run();
}

async function capped(db, sql) {
  const rows = await all(db, `${sql} LIMIT ${EXPORT_ROW_LIMIT + 1}`);
  const truncated = rows.length > EXPORT_ROW_LIMIT;
  return { rows: rows.slice(0, EXPORT_ROW_LIMIT), truncated };
}

export async function buildExport(db) {
  const [contacts, notes, opportunities, tasks, appointments, activities] = await Promise.all([
    capped(db, "SELECT id,first_name,last_name,email,phone,company,job_title,tags,created_at,updated_at FROM contacts ORDER BY created_at"),
    capped(db, "SELECT id,contact_id,body,author,created_at FROM contact_notes ORDER BY created_at"),
    capped(db, "SELECT id,title,contact_id,stage,value_cents,position,expected_close_date,notes,created_at,updated_at FROM opportunities ORDER BY created_at"),
    capped(db, "SELECT id,title,contact_id,due_date,priority,status,notes,completed_at,created_at,updated_at FROM tasks ORDER BY created_at"),
    capped(db, "SELECT id,title,contact_id,starts_at,duration_minutes,location,notes,created_at,updated_at FROM appointments ORDER BY created_at"),
    capped(db, "SELECT id,kind,summary,contact_id,created_at FROM activities ORDER BY created_at"),
  ]);
  const workspace = await loadWorkspace(db);
  return {
    format: "pulse-crm-backup",
    version: EXPORT_VERSION,
    exportedAt: now(),
    backup: "manual-download",
    automaticOffsiteBackup: false,
    truncated: [contacts, notes, opportunities, tasks, appointments, activities].some((part) => part.truncated),
    records: {
      contacts: contacts.rows.map((row) => ({ ...row, tags: JSON.parse(row.tags || "[]") })),
      contactNotes: notes.rows,
      opportunities: opportunities.rows,
      tasks: tasks.rows,
      appointments: appointments.rows,
      activities: activities.rows,
    },
    followUps: { views: workspace.views, rules: workspace.rules, recurrence: workspace.tasks },
  };
}

export function assertBackupPreview(body) {
  if (!body || body.format !== "pulse-crm-backup" || body.version !== EXPORT_VERSION || !body.records)
    throw new DomainError("This file is not a Pulse CRM backup.");
  const records = body.records;
  for (const key of ["contacts", "contactNotes", "opportunities", "tasks", "appointments", "activities"])
    if (!Array.isArray(records[key])) throw new DomainError("This backup is missing business records.");
  const forbidden = JSON.stringify(body);
  if (/password_hash|token_hash|AUTH_PEPPER|SETUP_TOKEN|login_attempts/.test(forbidden))
    throw new DomainError("This backup contains authentication material and was refused.");
  return {
    preview: true,
    writes: false,
    version: body.version,
    counts: Object.fromEntries(Object.entries(records).map(([key, rows]) => [key, rows.length])),
    message: "Preview only. Nothing was changed. Automatic offsite restore is not available.",
  };
}

export async function rememberRecurrence(db, taskId, recurrence, due) {
  if (!recurrence) return;
  const choiceValue = choice(recurrence, RECURRENCES, "Repeat");
  const workspace = await loadWorkspace(db);
  const current = workspace.tasks[taskId] || {};
  workspace.tasks[taskId] = { recurrence: choiceValue, seriesId: current.seriesId || taskId, due: due || current.due || null };
  await saveWorkspace(db, workspace);
}

export async function spawnNextRecurrence(db, previous, input) {
  if (input.status !== "Completed" || previous.status === "Completed") return null;
  const workspace = await loadWorkspace(db);
  const plan = workspace.tasks[previous.id];
  if (!plan) return null;
  const due = nextDueDate(input.due_date || plan.due, plan.recurrence);
  if (!due) return null;
  const key = `${plan.seriesId}|${due}`;
  if (workspace.spawned[key]) return null;
  const stamp = now();
  const taskId = id();
  const fields = {
    id: taskId,
    title: input.title,
    contact_id: input.contact_id,
    due_date: due,
    priority: input.priority,
    status: "Open",
    notes: input.notes,
    completed_at: null,
    created_at: stamp,
    updated_at: stamp,
  };
  const event = activity("task", `Scheduled next ${plan.recurrence} follow-up ${fields.title}`, fields.contact_id);
  await db.batch([
    statement(db, insertSQL("tasks", fields), ...Object.values(fields)),
    statement(db, insertSQL("activities", event), ...Object.values(event)),
  ]);
  workspace.spawned[key] = taskId;
  workspace.tasks[taskId] = { recurrence: plan.recurrence, seriesId: plan.seriesId, due };
  await saveWorkspace(db, workspace);
  return taskId;
}

export async function applyStageRules(db, opportunity) {
  const workspace = await loadWorkspace(db);
  const rules = workspace.rules.filter((rule) => rule.stage === opportunity.stage);
  let created = 0;
  for (const rule of rules) {
    const key = `${rule.id}:${opportunity.id}`;
    if (workspace.spawned[key]) continue;
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + Number(rule.dueInDays || 0));
    const stamp = now();
    const taskId = id();
    const fields = {
      id: taskId,
      title: rule.title,
      contact_id: opportunity.contact_id,
      due_date: due.toISOString().slice(0, 10),
      priority: rule.priority,
      status: "Open",
      notes: `Local follow-up for ${opportunity.title}. Nothing is sent.`,
      completed_at: null,
      created_at: stamp,
      updated_at: stamp,
    };
    const event = activity("task", `Added follow-up “${rule.title}” because ${opportunity.title} entered ${opportunity.stage}`, opportunity.contact_id);
    await db.batch([
      statement(db, insertSQL("tasks", fields), ...Object.values(fields)),
      statement(db, insertSQL("activities", event), ...Object.values(event)),
    ]);
    workspace.spawned[key] = taskId;
    created += 1;
  }
  if (created) await saveWorkspace(db, workspace);
  return created;
}

function cleanRule(body) {
  return {
    id: id(),
    stage: choice(body?.stage, PIPELINE_STAGES, "Stage"),
    title: requiredText(body?.title, "Task title", 180),
    dueInDays: Math.min(90, Math.max(0, Number(body?.dueInDays ?? 1) || 0)),
    priority: choice(body?.priority || "Medium", TASK_PRIORITIES, "Priority"),
  };
}

export async function addRule(db, body) {
  const workspace = await loadWorkspace(db);
  if (workspace.rules.length >= 12) throw new DomainError("You can save up to 12 follow-up rules.");
  const rule = cleanRule(body);
  if (workspace.rules.some((item) => item.stage === rule.stage && item.title === rule.title))
    throw new DomainError("That follow-up rule already exists.");
  workspace.rules.push(rule);
  await saveWorkspace(db, workspace);
  return rule;
}

export async function removeRule(db, ruleId) {
  const workspace = await loadWorkspace(db);
  workspace.rules = workspace.rules.filter((rule) => rule.id !== ruleId);
  await saveWorkspace(db, workspace);
}

export async function addView(db, body) {
  const workspace = await loadWorkspace(db);
  if (workspace.views.length >= 20) throw new DomainError("You can save up to 20 contact views.");
  const view = {
    id: id(),
    name: requiredText(body?.name, "View name", 60),
    query: optionalText(body?.query, "Search", 160) || "",
    tag: optionalText(body?.tag, "Tag", 32) || "",
  };
  workspace.views.push(view);
  await saveWorkspace(db, workspace);
  return view;
}

export async function removeView(db, viewId) {
  const workspace = await loadWorkspace(db);
  workspace.views = workspace.views.filter((view) => view.id !== viewId);
  await saveWorkspace(db, workspace);
}

export async function buildReport(db) {
  const today = now().slice(0, 10);
  const [stages, overdue, dueToday, companies] = await Promise.all([
    all(db, "SELECT stage, COUNT(*) AS deals, COALESCE(SUM(value_cents),0) AS value_cents FROM opportunities GROUP BY stage"),
    one(db, "SELECT COUNT(*) AS count FROM tasks WHERE status='Open' AND due_date IS NOT NULL AND due_date < ?", today),
    one(db, "SELECT COUNT(*) AS count FROM tasks WHERE status='Open' AND due_date = ?", today),
    all(db, "SELECT COALESCE(NULLIF(TRIM(company),''),'(No company)') AS company, COUNT(*) AS contacts FROM contacts GROUP BY 1 ORDER BY contacts DESC, company LIMIT 100"),
  ]);
  const byStage = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, { deals: 0, value: 0 }]));
  for (const row of stages) if (byStage[row.stage]) byStage[row.stage] = { deals: row.deals, value: row.value_cents / 100 };
  const won = byStage.Won;
  const lost = byStage.Lost;
  const closed = won.deals + lost.deals;
  return {
    generatedAt: now(),
    stages: byStage,
    won,
    lost,
    winRate: closed ? Math.round((won.deals / closed) * 100) : null,
    overdueFollowUps: overdue.count,
    dueToday: dueToday.count,
    companies: companies.map((row) => ({ company: row.company, contacts: row.contacts })),
    note: "Totals come from records stored in this workspace. Nothing is sent or synced.",
  };
}

export async function existingEmails(db) {
  const rows = await all(db, "SELECT email FROM contacts WHERE email IS NOT NULL");
  return new Set(rows.map((row) => String(row.email).toLowerCase()));
}

export async function commitImport(db, csv, mapping) {
  const preview = previewImport(csv, await existingEmails(db), mapping);
  const created = [];
  for (const row of preview.rows.filter((item) => item.status === "create")) {
    const stamp = now();
    const fields = {
      id: id(),
      first_name: row.record.first_name,
      last_name: row.record.last_name || "",
      email: row.record.email,
      phone: row.record.phone,
      company: row.record.company,
      job_title: row.record.job_title,
      tags: JSON.stringify(row.record.tags || []),
      created_at: stamp,
      updated_at: stamp,
    };
    const event = activity("contact", `Imported ${fields.first_name}`, fields.id);
    await db.batch([
      statement(db, insertSQL("contacts", fields), ...Object.values(fields)),
      statement(db, insertSQL("activities", event), ...Object.values(event)),
    ]);
    created.push({ id: fields.id, email: fields.email, first_name: fields.first_name });
  }
  return { created: created.length, skipped: preview.summary.duplicate + preview.summary.invalid, contacts: created };
}

export function recurrenceChoice(value) {
  if (!value) return null;
  return choice(value, RECURRENCES, "Repeat");
}

export { dueDate };
