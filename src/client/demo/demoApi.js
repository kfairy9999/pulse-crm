// The public demo: the real CRM request handlers (src/crm.js) running against an in-memory
// SQLite database in this browser tab. Nothing is sent to the server and nothing is saved.
import initSqlJs from "sql.js/dist/sql-asm.js";
import schema from "../../../migrations/0001_initial.sql?raw";
import { handleCrm } from "../../crm.js";
import { DomainError } from "../../shared.js";
import { D1Shim } from "./d1Shim.js";
import { seedStatements } from "./seed.js";

export const DEMO_USER = { id: "demo", email: "demo@pulse.example", name: "Demo visitor" };

let ready;

export async function createDemoDatabase(SQL) {
  const db = new D1Shim(new SQL.Database());
  await db.exec(schema);
  await db.batch(seedStatements(db));
  return db;
}

function database() {
  if (!ready) ready = initSqlJs().then(createDemoDatabase);
  return ready;
}

function failure(error) {
  if (error instanceof DomainError) return { status: error.status || 400, body: { error: error.message, ...(error.fields ? { fields: error.fields } : {}) } };
  if (/UNIQUE constraint failed|FOREIGN KEY constraint failed/i.test(String(error?.message)))
    return { status: 409, body: { error: "This change conflicts with another record. Please refresh and retry." } };
  console.error(error);
  return { status: 500, body: { error: "The demo could not complete this request." } };
}

export async function demoRequest(db, path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const url = new URL(`https://demo.pulse.local/api${path}`);
  if (url.pathname === "/api/auth/session") return { status: 200, body: { user: DEMO_USER, authenticated: true, setupRequired: false } };
  if (url.pathname === "/api/auth/logout") return { status: 200, body: { ok: true } };
  if (url.pathname.startsWith("/api/auth/")) return { status: 403, body: { error: "Sign-in is turned off in the demo." } };
  const body = options.body ? JSON.parse(options.body) : null;
  try {
    const request = new Request(url, { method, headers: { "Content-Type": "application/json" } });
    const response = await handleCrm(request, { DB: db }, { method, path: url.pathname, body, url });
    return { status: response.status, body: await response.json() };
  } catch (error) {
    return failure(error);
  }
}

export async function demoApi(path, options) {
  return demoRequest(await database(), path, options);
}
