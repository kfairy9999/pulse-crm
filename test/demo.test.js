import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { D1Shim } from "../src/client/demo/d1Shim.js";
import { seedStatements, shiftFor } from "../src/client/demo/seed.js";
import { handleCrm } from "../src/crm.js";

async function demoDb() {
  const SQL = await initSqlJs();
  const db = new D1Shim(new SQL.Database());
  await db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  await db.batch(seedStatements(db));
  return db;
}

async function call(db, method, path, body = null) {
  const url = new URL(`https://demo.test${path}`);
  const response = await handleCrm(new Request(url, { method }), { DB: db }, { method, path: url.pathname, body, url });
  return { status: response.status, body: await response.json() };
}

test("demo database runs the real CRM handlers on fictional data", async () => {
  const db = await demoDb();
  const contacts = await call(db, "GET", "/api/contacts");
  assert.equal(contacts.status, 200);
  const list = contacts.body.contacts ?? contacts.body;
  assert.equal(list.length, 6);
  assert.ok(list.every((contact) => !contact.email || contact.email.endsWith(".example")));
  const metadata = await call(db, "GET", "/api/metadata");
  assert.equal(metadata.status, 200);
});

test("demo writes go through the same validation", async () => {
  const db = await demoDb();
  const created = await call(db, "POST", "/api/contacts", { first_name: "Rae", last_name: "Lopez", email: "rae@demo.example" });
  assert.equal(created.status, 201);
  const dup = call(db, "POST", "/api/contacts", { first_name: "Rae", email: "rae@demo.example" });
  await assert.rejects(dup, (error) => error.status === 409);
});

test("sample dates move with today", () => {
  assert.equal(shiftFor(new Date("2026-11-06T09:00:00Z")), 0);
  assert.equal(shiftFor(new Date("2026-11-10T23:00:00Z")), 4);
});
