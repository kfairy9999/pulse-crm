import { DomainError } from "./shared.js";

export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const statement = (db, sql, ...params) =>
  db.prepare(sql).bind(...params);
export const one = (db, sql, ...params) =>
  statement(db, sql, ...params).first();
export const all = async (db, sql, ...params) =>
  (await statement(db, sql, ...params).all()).results;
export const concurrent = async (db, statements) =>
  (await db.batch(statements)).map((r) => r.results);
export const sessionDB = (env) => env.DB.withSession("first-primary");
export const fullContactName = (r) =>
  [r.first_name, r.last_name].filter(Boolean).join(" ");
export const mapContact = (r) => ({
  ...r,
  name: fullContactName(r),
  tags: JSON.parse(r.tags || "[]"),
});
export const mapOpportunity = (r) => ({ ...r, value: r.value_cents / 100 });
export const insertSQL = (table, fields) => {
  if (
    ![
      "contacts",
      "contact_notes",
      "opportunities",
      "tasks",
      "appointments",
      "activities",
    ].includes(table)
  )
    throw new Error("Unknown record table.");
  return `INSERT INTO ${table}(${Object.keys(fields).join(",")}) VALUES(${Object.keys(
    fields,
  )
    .map(() => "?")
    .join(",")})`;
};
export const contactSelect = `SELECT c.*,
 (SELECT COUNT(*) FROM opportunities o WHERE o.contact_id=c.id) AS opportunity_count,
 (SELECT COUNT(*) FROM contact_notes n WHERE n.contact_id=c.id) AS note_count FROM contacts c`;
async function requiredRow(db, sql, key, message) {
  const result = await one(db, sql, key);
  if (!result) throw new DomainError(message, 404);
  return result;
}
export const getContact = async (db, key) =>
  mapContact(
    await requiredRow(
      db,
      `${contactSelect} WHERE c.id=?`,
      key,
      "Contact not found.",
    ),
  );
export const getOpportunity = async (db, key) =>
  mapOpportunity(
    await requiredRow(
      db,
      `SELECT o.*,c.first_name,c.last_name,c.company,
 c.first_name || CASE WHEN c.last_name<>'' THEN ' ' || c.last_name ELSE '' END AS contact_name
 FROM opportunities o JOIN contacts c ON c.id=o.contact_id WHERE o.id=?`,
      key,
      "Opportunity not found.",
    ),
  );
export const getTask = (db, key) =>
  requiredRow(
    db,
    `SELECT t.*,TRIM(c.first_name||' '||c.last_name) AS contact_name
 FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.id=?`,
    key,
    "Task not found.",
  );
export const getAppointment = (db, key) =>
  requiredRow(
    db,
    `SELECT a.*,TRIM(c.first_name||' '||c.last_name) AS contact_name
 FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.id=?`,
    key,
    "Appointment not found.",
  );
export async function requireExists(db, key) {
  if (!(await one(db, "SELECT id FROM contacts WHERE id=?", key)))
    throw new DomainError("Contact not found.");
}
export async function assertUniqueEmail(db, email, cid = null) {
  if (
    email &&
    (await one(
      db,
      "SELECT id FROM contacts WHERE email=? AND id!=COALESCE(?,?)",
      email,
      cid,
      "",
    ))
  ) {
    throw new DomainError("A contact with this email already exists.", 409, {
      email: "This email is already in use.",
    });
  }
}
export const activity = (kind, summary, cid = null) => ({
  id: id(),
  kind,
  summary,
  contact_id: cid,
  created_at: now(),
});
export const activityStatement = (db, record) =>
  statement(db, insertSQL("activities", record), ...Object.values(record));
export async function checkMigrated(db) {
  try {
    const row = await one(
      db,
      "SELECT MAX(version) AS version FROM schema_migrations",
    );
    if (row?.version !== 3) throw new Error();
  } catch {
    throw new DomainError(
      "The database is not ready. Apply the included Wrangler D1 migration before using this Worker.",
      503,
    );
  }
}
