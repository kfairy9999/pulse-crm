import {
  DomainError,
  PIPELINE_STAGES,
  STAGE_WEIGHTS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  requiredText,
  optionalText,
  optionalEmail,
  optionalPhone,
  cleanTags,
  moneyToCents,
  isoDateTime,
  dueDate,
  choice,
  booleanValue,
  positiveInteger,
} from "./shared.js";
import {
  id,
  now,
  statement,
  one,
  all,
  concurrent,
  insertSQL,
  getContact,
  getOpportunity,
  getTask,
  getAppointment,
  requireExists,
  assertUniqueEmail,
  fullContactName,
  mapContact,
  mapOpportunity,
  contactSelect,
  activity,
} from "./d1.js";
import { json } from "./auth/http.js";
import {
  addRule,
  addView,
  applyStageRules,
  assertBackupPreview,
  buildExport,
  buildReport,
  commitImport,
  contactsToCsv,
  existingEmails,
  loadWorkspace,
  previewImport,
  recurrenceChoice,
  rememberRecurrence,
  removeRule,
  removeView,
  setRuleEnabled,
  spawnNextRecurrence,
} from "./sales.js";
import {
  readBoard,
  createOpportunityStatement,
  updateOpportunityStatements,
  deleteOpportunityStatements,
  deleteContactStatements,
  guardedWrite,
} from "./pipeline.js";

const expectBody = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new DomainError("A JSON request body is required.");
  return body;
};
const has = (body, k) => Object.prototype.hasOwnProperty.call(body, k);
const optionalRelation = (value) =>
  value === "" || value === undefined
    ? null
    : optionalText(value, "Contact", 100);
const batch = (db, fields, table, event) =>
  db.batch([
    statement(db, insertSQL(table, fields), ...Object.values(fields)),
    activityInsert(db, event),
  ]);
const activityInsert = (db, event) =>
  statement(db, insertSQL("activities", event), ...Object.values(event));
const updateBatch = (db, table, id, fields, event) =>
  db.batch([
    statement(
      db,
      `UPDATE ${table} SET ${Object.keys(fields)
        .map((k) => `${k}=?`)
        .join(",")} WHERE id=?`,
      ...Object.values(fields),
      id,
    ),
    activityInsert(db, event),
  ]);
const deleteBatch = (db, table, record, event) =>
  db.batch([
    statement(db, `DELETE FROM ${table} WHERE id=?`, record.id),
    activityInsert(db, event),
  ]);

async function contactInput(db, body, previous = null) {
  expectBody(body);
  const get = (k) => (has(body, k) ? body[k] : previous?.[k]);
  const result = {
    first_name: requiredText(get("first_name"), "First name", 80),
    last_name: optionalText(get("last_name"), "Last name", 80) || "",
    email: optionalEmail(get("email")),
    phone: optionalPhone(get("phone")),
    company: optionalText(get("company"), "Company", 120),
    job_title: optionalText(get("job_title"), "Job title", 120),
    tags: JSON.stringify(cleanTags(get("tags"))),
  };
  await assertUniqueEmail(db, result.email, previous?.id);
  return result;
}
async function opportunityInput(db, body, previous = null) {
  expectBody(body);
  const get = (k) => (has(body, k) ? body[k] : previous?.[k]),
    contactId = requiredText(get("contact_id"), "Contact", 100);
  await requireExists(db, contactId);
  return {
    title: requiredText(get("title"), "Title", 180),
    contact_id: contactId,
    stage: choice(get("stage") || "New Lead", PIPELINE_STAGES, "Stage"),
    value_cents: moneyToCents(
      has(body, "value")
        ? body.value
        : has(body, "value_cents")
          ? Number(body.value_cents) / 100
          : previous
            ? previous.value_cents / 100
            : 0,
    ),
    expected_close_date: dueDate(get("expected_close_date")),
    notes: optionalText(get("notes"), "Notes", 4000),
  };
}
async function taskInput(db, body, previous = null) {
  expectBody(body);
  const get = (k) => (has(body, k) ? body[k] : previous?.[k]),
    contactId = optionalRelation(get("contact_id"));
  if (contactId) await requireExists(db, contactId);
  const explicitStatus = has(body, "status")
      ? choice(body.status, TASK_STATUSES, "Status")
      : null,
    status = has(body, "completed")
      ? booleanValue(body.completed)
        ? "Completed"
        : "Open"
      : explicitStatus || previous?.status || "Open";
  const completedAt =
    status === "Completed"
      ? previous?.status === "Completed" &&
        !has(body, "status") &&
        !has(body, "completed")
        ? previous.completed_at
        : previous?.status === "Completed" && status === "Completed"
          ? previous.completed_at
          : now()
      : null;
  return {
    title: requiredText(get("title"), "Title", 180),
    contact_id: contactId,
    due_date: dueDate(get("due_date")),
    priority: choice(get("priority") || "Medium", TASK_PRIORITIES, "Priority"),
    status,
    notes: optionalText(get("notes"), "Notes", 4000),
    completed_at: completedAt,
  };
}
async function appointmentInput(db, body, previous = null) {
  expectBody(body);
  const get = (k) => (has(body, k) ? body[k] : previous?.[k]),
    contactId = optionalRelation(get("contact_id"));
  if (contactId) await requireExists(db, contactId);
  return {
    title: requiredText(get("title"), "Title", 180),
    contact_id: contactId,
    starts_at: isoDateTime(get("starts_at")),
    duration_minutes: positiveInteger(
      get("duration_minutes") ?? 30,
      "Duration",
      1440,
    ),
    location: optionalText(get("location"), "Location", 240),
    notes: optionalText(get("notes"), "Notes", 4000),
  };
}
function dashboardResult(
  opportunities,
  tasks,
  upcoming,
  activities,
  recent,
  counts,
) {
  const open = opportunities.filter((x) => !["Won", "Lost"].includes(x.stage)),
    won = opportunities.filter((x) => x.stage === "Won"),
    lost = opportunities.filter((x) => x.stage === "Lost"),
    sum = (a) => a.reduce((n, x) => n + x.value_cents, 0);
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - (5 - i));
    const key = date.toISOString().slice(0, 7);
    return {
      month: date.toLocaleString("en", { month: "short", timeZone: "UTC" }),
      key,
      value:
        opportunities
          .filter((x) => x.updated_at.startsWith(key) && x.stage !== "Lost")
          .reduce((n, x) => n + x.value_cents, 0) / 100,
    };
  });
  return {
    metrics: {
      openPipeline: sum(open) / 100,
      weightedPipeline:
        open.reduce(
          (n, x) => n + Math.round(x.value_cents * STAGE_WEIGHTS[x.stage]),
          0,
        ) / 100,
      wonValue: sum(won) / 100,
      activeContacts: counts[0].contacts,
      openTasks: counts[0].tasks,
      dueToday: counts[0].today,
      winRate:
        won.length + lost.length
          ? Math.round((won.length / (won.length + lost.length)) * 100)
          : null,
    },
    tasks,
    upcoming,
    activity: activities,
    monthly,
    recentContacts: recent.map(mapContact),
  };
}
export async function handleCrm(request, env, { method, path, body, url }) {
  const db = env.DB;
  if (method === "GET" && path === "/api/export") return json(await buildExport(db));
  if (method === "GET" && path === "/api/contacts.csv") {
    const contacts = await all(db, `${contactSelect} ORDER BY LOWER(c.first_name) LIMIT 2000`);
    return json({ filename: "pulse-contacts.csv", csv: contactsToCsv(contacts.map(mapContact)) });
  }
  if (method === "POST" && path === "/api/import/preview")
    return json(previewImport(body?.csv, await existingEmails(db), body?.mapping));
  if (method === "POST" && path === "/api/import/contacts")
    return json(await commitImport(db, body?.csv, body?.mapping), 201);
  if (method === "POST" && path === "/api/export/preview")
    return json(assertBackupPreview(body?.backup || body));
  if (method === "GET" && path === "/api/reports") return json(await buildReport(db));
  if (method === "GET" && path === "/api/views") return json({ views: (await loadWorkspace(db)).views });
  if (method === "POST" && path === "/api/views") return json({ view: await addView(db, body) }, 201);
  if (method === "DELETE" && path.startsWith("/api/views/")) {
    await removeView(db, decodeURIComponent(path.slice("/api/views/".length)));
    return json({ deleted: true });
  }
  if (method === "GET" && path === "/api/stage-rules") return json({ rules: (await loadWorkspace(db)).rules });
  if (method === "POST" && path === "/api/stage-rules") return json({ rule: await addRule(db, body) }, 201);
  if (method === "PATCH" && path.startsWith("/api/stage-rules/"))
    return json({ rule: await setRuleEnabled(db, decodeURIComponent(path.slice("/api/stage-rules/".length)), body?.enabled) });
  if (method === "DELETE" && path.startsWith("/api/stage-rules/")) {
    await removeRule(db, decodeURIComponent(path.slice("/api/stage-rules/".length)));
    return json({ deleted: true });
  }
  if (method === "GET" && path === "/api/metadata")
    return json({
      name: "Pulse CRM",
      pipelineStages: PIPELINE_STAGES,
      sampleDataSeeded: false,
      mode: "cloudflare-single-owner",
    });
  if (method === "GET" && path === "/api/dashboard") {
    const [opportunities, tasks, upcoming, activities, recent, counts] =
      await concurrent(db, [
        statement(db, "SELECT stage,value_cents,updated_at FROM opportunities"),
        statement(
          db,
          "SELECT t.*,TRIM(c.first_name||' '||c.last_name) AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,t.due_date,CASE t.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,t.created_at DESC LIMIT 8",
        ),
        statement(
          db,
          "SELECT a.*,TRIM(c.first_name||' '||c.last_name) AS contact_name FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.starts_at>=? ORDER BY a.starts_at LIMIT 5",
          now(),
        ),
        statement(
          db,
          "SELECT a.*,TRIM(c.first_name||' '||c.last_name) AS contact_name FROM activities a LEFT JOIN contacts c ON c.id=a.contact_id ORDER BY a.created_at DESC LIMIT 8",
        ),
        statement(db, contactSelect + " ORDER BY c.created_at DESC LIMIT 5"),
        statement(
          db,
          "SELECT (SELECT COUNT(*) FROM contacts) AS contacts,(SELECT COUNT(*) FROM tasks WHERE status='Open') AS tasks,(SELECT COUNT(*) FROM tasks WHERE status='Open' AND due_date=?) AS today",
          now().slice(0, 10),
        ),
      ]);
    return json(
      dashboardResult(
        opportunities,
        tasks,
        upcoming,
        activities,
        recent,
        counts,
      ),
    );
  }
  if (method === "GET" && path === "/api/contacts") {
    const q = optionalText(url.searchParams.get("q"), "Search", 160),
      tag = optionalText(url.searchParams.get("tag"), "Tag", 32)?.toLowerCase(),
      params = [],
      clauses = [];
    if (q) {
      clauses.push(
        "(c.first_name LIKE ? ESCAPE char(92) OR c.last_name LIKE ? ESCAPE char(92) OR c.company LIKE ? ESCAPE char(92) OR c.email LIKE ? ESCAPE char(92) OR (c.first_name||' '||c.last_name) LIKE ? ESCAPE char(92))",
      );
      const slash = String.fromCharCode(92),
        escaped = q
          .replaceAll(slash, slash + slash)
          .replaceAll("%", slash + "%")
          .replaceAll("_", slash + "_");
      params.push(...Array(5).fill(`%${escaped}%`));
    }
    if (tag) {
      clauses.push(
        "EXISTS(SELECT 1 FROM json_each(c.tags) WHERE json_each.value=?)",
      );
      params.push(tag);
    }
    const [rows, tags] = await concurrent(db, [
      statement(
        db,
        contactSelect +
          (clauses.length ? " WHERE " + clauses.join(" AND ") : "") +
          " ORDER BY LOWER(c.first_name),LOWER(c.last_name),c.created_at DESC",
      ).bind(...params),
      statement(db, "SELECT tags FROM contacts"),
    ]);
    return json({
      contacts: rows.map(mapContact),
      total: rows.length,
      tags: [...new Set(tags.flatMap((r) => JSON.parse(r.tags)))].sort(),
    });
  }
  let match = path.match(/^\/api\/contacts\/([^/]+)$/);
  if (match) {
    const cid = decodeURIComponent(match[1]);
    if (method === "GET") {
      const contact = await getContact(db, cid),
        [notes, opportunities, tasks, appointments, history] = await concurrent(db, [
          statement(
            db,
            "SELECT * FROM contact_notes WHERE contact_id=? ORDER BY created_at DESC",
            contact.id,
          ),
          statement(
            db,
            "SELECT * FROM opportunities WHERE contact_id=? ORDER BY updated_at DESC",
            contact.id,
          ),
          statement(
            db,
            "SELECT * FROM tasks WHERE contact_id=? ORDER BY status,due_date",
            contact.id,
          ),
          statement(
            db,
            "SELECT * FROM appointments WHERE contact_id=? ORDER BY starts_at DESC",
            contact.id,
          ),
          statement(
            db,
            "SELECT id,kind,summary,created_at FROM activities WHERE contact_id=? ORDER BY created_at DESC LIMIT 50",
            contact.id,
          ),
        ]);
      return json({
        contact,
        notes,
        opportunities: opportunities.map(mapOpportunity),
        tasks,
        appointments,
        history,
      });
    }
    if (method === "PATCH") {
      const previous = await getContact(db, cid),
        input = await contactInput(db, body, previous);
      await updateBatch(
        db,
        "contacts",
        cid,
        { ...input, updated_at: now() },
        activity("contact", `Updated ${fullContactName(input)}'s contact`, cid),
      );
      return json({ contact: await getContact(db, cid) });
    }
    if (method === "DELETE") {
      const rows = await readBoard(db),
        contact = await getContact(db, cid),
        deals = (
          await one(
            db,
            "SELECT COUNT(*) AS count FROM opportunities WHERE contact_id=?",
            cid,
          )
        ).count;
      if (deals)
        throw new DomainError(
          `This contact has ${deals} ${deals === 1 ? "opportunity" : "opportunities"}. Delete or reassign ${deals === 1 ? "it" : "them"} first.`,
          409,
        );
      await guardedWrite(
        db,
        (key) => deleteContactStatements(db, cid, key),
        activity("contact", `Removed ${contact.name} from contacts`),
        rows.revision,
      );
      return json({ deleted: cid });
    }
  }
  if (method === "POST" && path === "/api/contacts") {
    const input = await contactInput(db, body),
      stamp = now(),
      fields = { id: id(), ...input, created_at: stamp, updated_at: stamp };
    await batch(
      db,
      fields,
      "contacts",
      activity(
        "contact",
        `Added ${fullContactName(fields)} to contacts`,
        fields.id,
      ),
    );
    return json({ contact: await getContact(db, fields.id) }, 201);
  }
  match = path.match(/^\/api\/contacts\/([^/]+)\/notes$/);
  if (match && method === "POST") {
    const contact = await getContact(db, decodeURIComponent(match[1])),
      note = {
        id: id(),
        contact_id: contact.id,
        body: requiredText(expectBody(body).body, "Note", 5000),
        author: "You",
        created_at: now(),
      };
    await batch(
      db,
      note,
      "contact_notes",
      activity("note", `Added a note for ${contact.name}`, contact.id),
    );
    return json({ note }, 201);
  }
  if (method === "GET" && path === "/api/opportunities") {
    const q = optionalText(url.searchParams.get("q"), "Search", 160),
      params = q ? Array(3).fill(`%${q}%`) : [];
    const rows = await all(
      db,
      `SELECT o.*,TRIM(c.first_name||' '||c.last_name) AS contact_name,c.company FROM opportunities o JOIN contacts c ON c.id=o.contact_id ${q ? "WHERE o.title LIKE ? OR c.company LIKE ? OR (c.first_name||' '||c.last_name) LIKE ?" : ""} ORDER BY o.stage,o.position,o.created_at`,
      ...params,
    );
    return json({
      stages: Object.fromEntries(
        PIPELINE_STAGES.map((stage) => [
          stage,
          rows.filter((r) => r.stage === stage).map(mapOpportunity),
        ]),
      ),
      total: rows.length,
    });
  }
  if (method === "POST" && path === "/api/opportunities") {
    const input = await opportunityInput(db, body),
      rows = await readBoard(db),
      stamp = now(),
      fields = {
        id: id(),
        ...input,
        position: rows.filter((r) => r.stage === input.stage).length,
        created_at: stamp,
        updated_at: stamp,
      };
    await guardedWrite(
      db,
      (key) => [createOpportunityStatement(db, fields, key)],
      activity(
        "opportunity",
        `Created ${fields.title} in ${fields.stage}`,
        fields.contact_id,
      ),
      rows.revision,
    );
    return json({ opportunity: await getOpportunity(db, fields.id) }, 201);
  }
  match = path.match(/^\/api\/opportunities\/([^/]+)$/);
  if (match) {
    const oid = decodeURIComponent(match[1]);
    if (method === "GET")
      return json({ opportunity: await getOpportunity(db, oid) });
    const rows = await readBoard(db),
      record = rows.find((row) => row.id === oid);
    if (!record) throw new DomainError("Opportunity not found.", 404);
    const previous = mapOpportunity(record);
    if (method === "PATCH") {
      const request = expectBody(body),
        input = await opportunityInput(db, request, previous);
      const position = has(request, "position")
        ? Number.isInteger(request.position) &&
          request.position >= 0 &&
          request.position <= 100000
          ? request.position
          : (() => {
              throw new DomainError(
                "Position must be a whole number from 0 to 100,000.",
              );
            })()
        : null;
      await guardedWrite(
        db,
        (key) =>
          updateOpportunityStatements(
            db,
            rows,
            previous,
            input,
            position ??
              (previous.stage === input.stage ? previous.position : null),
            key,
          ),
        activity(
          "opportunity",
          previous.stage === input.stage
            ? `Updated ${input.title}`
            : `Moved ${input.title} from ${previous.stage} to ${input.stage}`,
          input.contact_id,
        ),
        rows.revision,
      );
      if (previous.stage !== input.stage)
        await applyStageRules(db, { ...input, id: oid });
      return json({ opportunity: await getOpportunity(db, oid) });
    }
    if (method === "DELETE") {
      await guardedWrite(
        db,
        (key) => deleteOpportunityStatements(db, rows, previous, key),
        activity(
          "opportunity",
          `Deleted opportunity ${previous.title}`,
          previous.contact_id,
        ),
        rows.revision,
      );
      return json({ deleted: oid });
    }
  }
  if (method === "GET" && path === "/api/tasks") {
    const status = url.searchParams.get("status")
      ? choice(
          url.searchParams.get("status"),
          ["All", ...TASK_STATUSES],
          "Status",
        )
      : "All";
    const tasks = await all(
      db,
      "SELECT t.*,TRIM(c.first_name||' '||c.last_name) AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id ORDER BY CASE t.status WHEN 'Open' THEN 0 ELSE 1 END,CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,t.due_date,CASE t.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,t.created_at DESC",
    );
    const plans = (await loadWorkspace(db)).tasks;
    for (const task of tasks) task.recurrence = plans[task.id]?.recurrence || null;
    return json({
      tasks:
        status === "All" ? tasks : tasks.filter((t) => t.status === status),
      counts: {
        all: tasks.length,
        open: tasks.filter((t) => t.status === "Open").length,
        completed: tasks.filter((t) => t.status === "Completed").length,
        highPriority: tasks.filter(
          (t) => t.status === "Open" && t.priority === "High",
        ).length,
      },
      today: now().slice(0, 10),
    });
  }
  if (method === "POST" && path === "/api/tasks") {
    const input = await taskInput(db, body),
      stamp = now();
    if (input.completed_at) input.completed_at = stamp;
    const fields = { id: id(), ...input, created_at: stamp, updated_at: stamp };
    await batch(
      db,
      fields,
      "tasks",
      activity("task", `Created task ${fields.title}`, fields.contact_id),
    );
    if (Object.prototype.hasOwnProperty.call(body || {}, "recurrence"))
      await rememberRecurrence(db, fields.id, body.recurrence ? recurrenceChoice(body.recurrence) : null, fields.due_date);
    return json({ task: await getTask(db, fields.id) }, 201);
  }
  match = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (match) {
    const tid = decodeURIComponent(match[1]);
    if (method === "GET") {
      const task = await getTask(db, tid);
      task.recurrence = (await loadWorkspace(db)).tasks[tid]?.recurrence || null;
      return json({ task });
    }
    if (method === "PATCH") {
      const previous = await getTask(db, tid),
        input = await taskInput(db, body, previous);
      await updateBatch(
        db,
        "tasks",
        tid,
        { ...input, updated_at: now() },
        activity(
          "task",
          input.status === "Completed" && previous.status !== "Completed"
            ? `Completed ${input.title}`
            : `Updated task ${input.title}`,
          input.contact_id,
        ),
      );
      if (Object.prototype.hasOwnProperty.call(body || {}, "recurrence"))
        await rememberRecurrence(db, tid, recurrenceChoice(body.recurrence), input.due_date);
      const followUp = await spawnNextRecurrence(db, previous, input);
      const task = await getTask(db, tid);
      task.recurrence = (await loadWorkspace(db)).tasks[tid]?.recurrence || null;
      return json({ task, followUp });
    }
    if (method === "DELETE") {
      const record = await getTask(db, tid);
      await deleteBatch(
        db,
        "tasks",
        record,
        activity("task", `Deleted task ${record.title}`, record.contact_id),
      );
      return json({ deleted: tid });
    }
  }
  if (method === "GET" && path === "/api/appointments") {
    const appointments = await all(
      db,
      "SELECT a.*,TRIM(c.first_name||' '||c.last_name) AS contact_name,c.company FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id ORDER BY a.starts_at",
    );
    return json({
      appointments,
      upcoming: appointments.filter((a) => a.starts_at >= now()),
      past: appointments.filter((a) => a.starts_at < now()),
    });
  }
  if (method === "POST" && path === "/api/appointments") {
    const input = await appointmentInput(db, body),
      stamp = now(),
      fields = { id: id(), ...input, created_at: stamp, updated_at: stamp };
    await batch(
      db,
      fields,
      "appointments",
      activity(
        "appointment",
        `Booked local appointment ${fields.title}`,
        fields.contact_id,
      ),
    );
    return json({ appointment: await getAppointment(db, fields.id) }, 201);
  }
  match = path.match(/^\/api\/appointments\/([^/]+)$/);
  if (match) {
    const aid = decodeURIComponent(match[1]);
    if (method === "GET")
      return json({ appointment: await getAppointment(db, aid) });
    if (method === "PATCH") {
      const previous = await getAppointment(db, aid),
        input = await appointmentInput(db, body, previous);
      await updateBatch(
        db,
        "appointments",
        aid,
        { ...input, updated_at: now() },
        activity(
          "appointment",
          `Updated local appointment ${input.title}`,
          input.contact_id,
        ),
      );
      return json({ appointment: await getAppointment(db, aid) });
    }
    if (method === "DELETE") {
      const record = await getAppointment(db, aid);
      await deleteBatch(
        db,
        "appointments",
        record,
        activity(
          "appointment",
          `Deleted local appointment ${record.title}`,
          record.contact_id,
        ),
      );
      return json({ deleted: aid });
    }
  }
  if (method === "GET" && path === "/api/inbox")
    return json({
      notes: await all(
        db,
        "SELECT n.*,c.first_name,c.last_name,c.company,c.email,TRIM(c.first_name||' '||c.last_name) AS contact_name FROM contact_notes n JOIN contacts c ON c.id=n.contact_id ORDER BY n.created_at DESC",
      ),
      mode: "local-notes",
      externalConnections: [],
    });
  return json({ error: "API route not found." }, 404);
}
