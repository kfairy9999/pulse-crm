import { it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { deriveCredential } from "../../src/auth/password.js";
import worker from "../../src/worker.js";

async function call(path, options = {}) {
  const headers = new Headers({
    Origin: "https://pulse.test",
    "CF-Connecting-IP": "203.0.113.40",
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...options.headers,
  });
  const response = await worker.fetch(
    new Request(`https://pulse.test/api${path}`, { ...options, headers }),
    env,
  );
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { response, body, status: response.status };
}
function session(response) {
  const raw = response.headers.getSetCookie();
  const csrf = decodeURIComponent(raw.find((cookie) => cookie.startsWith("__Host-pulse_csrf=")).split(";")[0].slice("__Host-pulse_csrf=".length));
  return { Cookie: raw.map((cookie) => cookie.split(";")[0]).join("; "), "X-CSRF-Token": csrf };
}
async function owner() {
  const credential = await deriveCredential("Correct Horse Battery Staple!");
  const created = await call("/auth/setup", {
    method: "POST",
    body: JSON.stringify({ email: "owner@example.test", ...credential, setupToken: env.SETUP_TOKEN }),
  });
  expect(created.status).toBe(201);
  return session(created.response);
}

it("exports business records without secrets and previews a backup without writing", async () => {
  const auth = await owner();
  const exported = await call("/export", { headers: auth });
  expect(exported.status).toBe(200);
  expect(exported.body.format).toBe("pulse-crm-backup");
  expect(exported.body.automaticOffsiteBackup).toBe(false);
  expect(exported.body.records.contacts).toEqual([]);
  const serialized = JSON.stringify(exported.body);
  expect(serialized).not.toMatch(/password_hash|token_hash|AUTH_PEPPER|SETUP_TOKEN/);
  const anonymous = await call("/export");
  expect(anonymous.status).toBe(401);
  const preview = await call("/export/preview", { method: "POST", headers: auth, body: JSON.stringify({ backup: exported.body }) });
  expect(preview.status).toBe(200);
  expect(preview.body.writes).toBe(false);
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM contacts").first()).n).toBe(0);
  const poisoned = await call("/export/preview", { method: "POST", headers: auth, body: JSON.stringify({ ...exported.body, password_hash: "nope" }) });
  expect(poisoned.status).toBe(400);
});

it("previews, rejects, and commits a bounded CSV import without duplicates or formula execution", async () => {
  const auth = await owner();
  await call("/contacts", { method: "POST", headers: auth, body: JSON.stringify({ first_name: "Ada", email: "ada@example.test" }) });
  const csv = ["First name,Email,Company", "=1+1,new@example.test,Engines", ",missing@example.test,Nope", "Grace,ada@example.test,Duplicate", "Alan,alan@example.test,Bombe"].join("\n");
  const denied = await call("/import/preview", { method: "POST", headers: { Cookie: auth.Cookie }, body: JSON.stringify({ csv }) });
  expect(denied.status).toBe(403);
  const preview = await call("/import/preview", { method: "POST", headers: auth, body: JSON.stringify({ csv }) });
  expect(preview.body.summary).toEqual({ create: 2, duplicate: 1, invalid: 1 });
  const overflow = ["First name,Email", ...Array.from({ length: 101 }, (_, index) => `Person ${index},p${index}@example.test`)].join("\n");
  expect((await call("/import/preview", { method: "POST", headers: auth, body: JSON.stringify({ csv: overflow }) })).status).toBe(400);
  const committed = await call("/import/contacts", { method: "POST", headers: auth, body: JSON.stringify({ csv }) });
  expect(committed.status).toBe(201);
  expect(committed.body.created).toBe(2);
  const again = await call("/import/contacts", { method: "POST", headers: auth, body: JSON.stringify({ csv }) });
  expect(again.body.created).toBe(0);
  const file = await call("/contacts.csv", { headers: auth });
  expect(file.body.csv).toContain(`"'=1+1"`);
  expect(file.body.csv).not.toContain("\n=1+1");
});

it("reports stage totals and creates one follow-up task for a stage rule and a recurrence", async () => {
  const auth = await owner();
  const contact = await call("/contacts", { method: "POST", headers: auth, body: JSON.stringify({ first_name: "CRM verification — temporary", company: "Verification Co", tags: "" }) });
  const deal = await call("/opportunities", { method: "POST", headers: auth, body: JSON.stringify({ title: "CRM verification — temporary deal", contact_id: contact.body.contact.id, value: 1, stage: "New Lead" }) });
  const report = await call("/reports", { headers: auth });
  expect(report.body.stages["New Lead"]).toEqual({ deals: 1, value: 1 });
  expect(report.body.winRate).toBeNull();
  expect(report.body.companies[0].company).toBe("Verification Co");
  const rule = await call("/stage-rules", { method: "POST", headers: auth, body: JSON.stringify({ stage: "Contacted", title: "Call after contact", dueInDays: 1, priority: "High" }) });
  expect(rule.status).toBe(201);
  await call(`/opportunities/${deal.body.opportunity.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ stage: "Contacted" }) });
  await call(`/opportunities/${deal.body.opportunity.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ stage: "Contacted" }) });
  const tasks = await call("/tasks", { headers: auth });
  expect(tasks.body.tasks.filter((task) => task.title === "Call after contact")).toHaveLength(1);
  const follow = await call("/tasks", { method: "POST", headers: auth, body: JSON.stringify({ title: "Weekly check-in", due_date: "2026-11-07", recurrence: "weekly", contact_id: contact.body.contact.id }) });
  expect(follow.status).toBe(201);
  const done = await call(`/tasks/${follow.body.task.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ completed: true }) });
  expect(done.body.followUp).toBeTruthy();
  const second = await call(`/tasks/${follow.body.task.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ completed: true }) });
  expect(second.body.followUp).toBeNull();
  expect((await call("/tasks", { headers: auth })).body.tasks.filter((task) => task.title === "Weekly check-in")).toHaveLength(2);
});
