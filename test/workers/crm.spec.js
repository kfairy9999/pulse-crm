import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { deriveCredential } from "../../src/auth/password.js";
import worker from "../../src/worker.js";
async function request(path, options = {}) {
  const requestUrl = `https://pulse.test/api${path}`,
    headers = new Headers({
      Origin: "https://pulse.test",
      "CF-Connecting-IP": "127.0.0.1",
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    });
  const response = await worker.fetch(
    new Request(requestUrl, { ...options, headers }),
    env,
  );
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = text;
  }

  return { response, body: payload, payload, status: response.status };
}
async function credential(password = "Correct Horse Battery Staple!", salt) {
  if (salt) return deriveCredential(password, salt);
  return deriveCredential(password);
}
async function setup() {
  const fields = {
    email: "owner@example.test",
    ...(await credential()),
    setupToken: env.SETUP_TOKEN,
  };
  return request("/auth/setup", {
    method: "POST",
    body: JSON.stringify(fields),
  });
}
function authenticate(response) {
  const raw = response.headers.getSetCookie();
  if (raw?.length >= 2) {
    const cookie = raw.map((c) => c.split(";")[0]).join("; "),
      csrf =
        raw
          .find((c) => c.startsWith("__Host-pulse_csrf="))
          ?.split(";")[0]
          .slice("__Host-pulse_csrf=".length) || "";
    return { Cookie: cookie, "X-CSRF-Token": decodeURIComponent(csrf) };
  }
  const combined = response.headers.get("Set-Cookie") || "",
    parts = combined.split(/,(?=__Host-)/),
    cookie = parts.map((c) => c.split(";")[0]).join("; "),
    csrf =
      parts
        .find((c) => c.startsWith("__Host-pulse_csrf="))
        ?.split(";")[0]
        .slice("__Host-pulse_csrf=".length) || "";
  return { Cookie: cookie, "X-CSRF-Token": decodeURIComponent(csrf) };
}
async function form() {
  const result = await setup();
  expect(result.status).toBe(201);
  const auth = authenticate(result.response);
  return (path, options = {}) => {
    const { method = "POST", body, ...requestOptions } = options;
    const own = { ...requestOptions.headers };
    if (method === "GET") delete own["Content-Type"];
    if (method === "GET") delete requestOptions.headers?.["Content-Type"];
    return request(path, {
      ...requestOptions,
      method,
      headers: { ...auth, ...own },
      body:
        method === "GET"
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
    });
  };
}
describe("Workers/D1 authentication", () => {
  it("runs from an empty schema and requires authentication", async () => {
    expect(
      (await env.DB.prepare("SELECT COUNT(*) count FROM contacts").first())
        .count,
    ).toBe(0);
    expect((await request("/metadata")).status).toBe(401);
    expect((await request("/auth/session")).body.setupRequired).toBe(true);
  });
  it("sets up one owner atomically, closes setup, and stores only hashed tokens", async () => {
    const result = await setup();
    expect(result.status).toBe(201);
    const cookies = result.response.headers.getSetCookie();
    expect(cookies.length).toBe(2);
    expect(
      cookies.every(
        (c) =>
          c.includes("Secure") &&
          c.includes("SameSite=Strict") &&
          c.includes("Path=/"),
      ),
    ).toBe(true);
    expect(
      (
        await request("/auth/session", {
          headers: authenticate(result.response),
        })
      ).body.setupRequired,
    ).toBe(false);
    const user = await env.DB.prepare("SELECT * FROM users").first();
    expect(user.password_hash).not.toContain("Correct Horse");
    expect(user.password_hash).toMatch(/^pbkdf2-sha256\$600000\$/);
    expect(
      (await env.DB.prepare("SELECT token_hash FROM sessions").first())
        .token_hash,
    ).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await setup()).status).toBe(403);
  });
  it("accepts browser-derived login, rotates sessions, and rejects plaintext fields", async () => {
    const signup = await setup(),
      oldCookies = authenticate(signup.response);
    const salt = (
      await env.DB.prepare("SELECT password_salt FROM users").first()
    ).password_salt;
    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "owner@example.test",
        ...(await credential("Correct Horse Battery Staple!", salt)),
      }),
    });
    expect(login.status).toBe(200);
    expect(
      (
        await request("/auth/session", {
          headers: authenticate(login.response),
        })
      ).body.authenticated,
    ).toBe(true);
    expect(
      (await request("/auth/session", { headers: oldCookies })).body
        .authenticated,
    ).toBe(false);
    expect(
      (
        await request("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: "owner@example.test",
            password: "Correct Horse Battery Staple!",
          }),
        })
      ).status,
    ).toBe(401);
  });
  it("enforces cross-origin, missing session, and CSRF rejection", async () => {
    const result = await setup(),
      auth = authenticate(result.response);
    expect(
      (
        await request("/contacts", {
          method: "POST",
          headers: { Origin: "https://attacker.test" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/contacts", {
          method: "POST",
          headers: { Cookie: auth.Cookie },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (await request("/contacts", { method: "POST", headers: auth, body: "{" }))
        .status,
    ).toBe(400);
  });
  it("revokes session on logout and protects an expired session", async () => {
    const api = await form();
    const before = await api("/contacts", { method: "GET", body: null });
    expect(before.status).toBe(200);
    await env.DB.prepare("UPDATE sessions SET expires_at=?")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    expect((await api("/contacts", { method: "GET", body: null })).status).toBe(
      401,
    );
  });
});
async function addContact(api, first = "Ada", last = "Lovelace") {
  const result = await api("/contacts", {
    body: {
      first_name: first,
      last_name: last,
      email: `${first.toLowerCase()}@example.test`,
      company: "Analytical Engines",
      tags: ["Priority"],
      job_title: "Engineer",
    },
  });
  expect(result.status).toBe(201);
  return result.body.contact;
}

async function addDeal(
  api,
  contact,
  title = "Foundational project",
  stage = "New Lead",
) {
  const result = await api("/opportunities", {
    body: {
      title,
      contact_id: contact.id,
      stage,
      value: 1000,
      expected_close_date: "2027-01-15",
      notes: "Confirmed requirement",
    },
  });
  expect(result.status).toBe(201);
  return result.body.opportunity;
}
describe("D1 CRM CRUD and pipeline ordering", () => {
  it("preserves full contact, note, duplicate-email, and deletion-validation behavior", async () => {
    const api = await form(),
      contact = await addContact(api);
    expect(
      (
        await api("/contacts", {
          body: { first_name: "Other", email: "ada@example.test" },
        })
      ).status,
    ).toBe(409);
    const note = await api(`/contacts/${contact.id}/notes`, {
      body: { body: "Follow up after the technical review." },
    });
    expect(note.status).toBe(201);
    const blank = await api("/contacts", {
      body: { first_name: "Untagged", tags: "" },
    });
    expect(blank.status).toBe(201);
    expect(blank.body.contact.tags).toEqual([]);
    expect(
      (
        await api(`/contacts/${blank.body.contact.id}`, {
          method: "PATCH",
          body: { tags: "acceptance-test, " },
        })
      ).body.contact.tags,
    ).toEqual(["acceptance-test"]);
    for (const method of ["PATCH", "DELETE"])
      expect(
        (
          await api(`/contacts/${contact.id}/notes/${note.body.note.id}`, {
            method,
            body: method === "DELETE" ? undefined : { body: "Edited note" },
          })
        ).status,
      ).toBe(404);
    expect(
      (
        await api(`/contacts/${contact.id}`, { method: "GET", body: null })
      ).body.notes.map((item) => item.body),
    ).toEqual(["Follow up after the technical review."]);
    expect(
      (
        await api(`/contacts/${contact.id}`, {
          method: "PATCH",
          body: {
            ...contact,
            company: "Updated Company",
            tags: ["Warm", "Priority"],
          },
        })
      ).body.contact.company,
    ).toBe("Updated Company");
    expect(
      (
        await api("/contacts?q=Updated&tag=priority", {
          method: "GET",
          body: null,
        })
      ).body.total,
    ).toBe(1);
    expect(
      (await api(`/contacts/${contact.id}`, { method: "GET", body: null })).body
        .notes.length,
    ).toBe(1);
    await addDeal(api, contact);
    expect(
      (await api(`/contacts/${contact.id}`, { method: "DELETE" })).status,
    ).toBe(409);
  });
  it("returns a complete stage map for the first deal on a contact without email, phone, or tags", async () => {
    const api = await form();
    const contact = await api("/contacts", {
      body: {
        first_name: "CRM verification — temporary",
        email: "",
        phone: "",
        company: "Verification Co",
        tags: "",
      },
    });
    expect(contact.status).toBe(201);
    expect(contact.body.contact.email).toBeNull();
    expect(contact.body.contact.tags).toEqual([]);
    const created = await api("/opportunities", {
      body: {
        title: "CRM verification — temporary deal",
        contact_id: contact.body.contact.id,
        value: 1,
        stage: "New Lead",
        notes: "Temporary acceptance-test deal, not a real lead",
        expected_close_date: "",
      },
    });
    expect(created.status).toBe(201);
    const board = await api("/opportunities", { method: "GET" });
    expect(board.status).toBe(200);
    for (const stage of ["New Lead", "Contacted", "Booked", "Proposal", "Won", "Lost"])
      expect(Array.isArray(board.body.stages[stage])).toBe(true);
    expect(board.body.stages["New Lead"][0]).toMatchObject({
      title: "CRM verification — temporary deal",
      contact_name: "CRM verification — temporary",
      company: "Verification Co",
      stage: "New Lead",
      value: 1,
      expected_close_date: null,
      notes: "Temporary acceptance-test deal, not a real lead",
    });
    const moved = await api(`/opportunities/${created.body.opportunity.id}`, {
      method: "PATCH",
      body: { stage: "Contacted" },
    });
    expect(moved.status).toBe(200);
    const again = await api("/opportunities", { method: "GET" });
    expect(again.body.stages.Contacted.map((deal) => deal.id)).toEqual([
      created.body.opportunity.id,
    ]);
    expect(again.body.stages["New Lead"]).toEqual([]);
  });
  it("creates appends, reorders, moves cross-column, edits values, and deletes deals", async () => {
    const api = await form(),
      a = await addContact(api, "Alpha", "Contact"),
      b = await addContact(api, "Beta", "Contact"),
      first = await addDeal(api, a, "First"),
      second = await addDeal(api, b, "Second"),
      third = await addDeal(api, a, "Third");
    const list = async () =>
      (await api("/opportunities", { method: "GET", body: null })).body.stages;
    expect((await list())["New Lead"].map((r) => r.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    const moved = await api(`/opportunities/${third.id}`, {
      method: "PATCH",
      body: { ...third, position: 0 },
    });
    expect(moved.status).toBe(200);
    expect((await list())["New Lead"].map((r) => r.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
    const cross = await api(`/opportunities/${third.id}`, {
      method: "PATCH",
      body: {
        ...moved.body.opportunity,
        contact_id: b.id,
        stage: "Proposal",
        position: 1,
        value: "234.56",
        title: "Edited Title",
      },
    });
    expect(cross.status).toBe(200);
    expect(cross.body.opportunity.title).toBe("Edited Title");
    expect(cross.body.opportunity.value).toBe(234.56);
    expect((await list()).Proposal.map((r) => r.id)).toEqual([third.id]);
    expect((await list())["New Lead"].map((r) => r.id)).toEqual([
      first.id,
      second.id,
    ]);
    const last = await addDeal(api, a, "Last", "Proposal"),
      before = await list();
    expect(before.Proposal.map((r) => r.id)).toEqual([third.id, last.id]);
    const crossToBeginning = await api(`/opportunities/${third.id}`, {
      method: "PATCH",
      body: { ...cross.body.opportunity, stage: "Booked", position: 0 },
    });
    expect(crossToBeginning.status).toBe(200);
    const after = await list();
    expect(after.Booked.map((r) => r.id)).toEqual([third.id]);
    expect(after.Proposal.map((r) => r.id)).toEqual([last.id]);
    const reference = await env.DB.prepare(
      "SELECT id,created_at FROM opportunities WHERE id=?",
    )
      .bind(third.id)
      .first();
    expect(reference.id).toBe(third.id);
    expect(
      (await api(`/opportunities/${third.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    for (const stage of ["New Lead", "Proposal", "Booked"])
      expect((await list())[stage].map((x) => x.position)).toEqual(
        (await list())[stage].map((_, i) => i),
      );
  });
  it("persists tasks, completion, appointments and dashboard/inbox responses", async () => {
    const api = await form(),
      contact = await addContact(api);
    const task = await api("/tasks", {
      body: {
        title: "Call the team",
        contact_id: contact.id,
        due_date: "2026-11-06",
        priority: "High",
        notes: "Timing verified",
      },
    });
    expect(task.status).toBe(201);
    const done = await api(`/tasks/${task.body.task.id}`, {
      method: "PATCH",
      body: { ...task.body.task, completed: true },
    });
    expect(done.body.task.status).toBe("Completed");
    const reopened = await api(`/tasks/${task.body.task.id}`, {
      method: "PATCH",
      body: { ...done.body.task, completed: false },
    });
    expect(reopened.body.task.completed_at).toBe(null);
    const appointment = await api("/appointments", {
      body: {
        title: "Review contract",
        contact_id: contact.id,
        starts_at: "2027-01-01T12:00:00.000Z",
        duration_minutes: 45,
        location: "Remote",
      },
    });
    expect(appointment.status).toBe(201);
    const patch = await api(
      `/appointments/${appointment.body.appointment.id}`,
      {
        method: "PATCH",
        body: { ...appointment.body.appointment, duration_minutes: 60 },
      },
    );
    expect(patch.body.appointment.duration_minutes).toBe(60);
    for (const path of ["/dashboard", "/tasks", "/appointments", "/inbox"])
      expect((await api(path, { method: "GET", body: null })).status).toBe(200);
    expect(
      (await api(`/tasks/${task.body.task.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect(
      (
        await api(`/appointments/${appointment.body.appointment.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
  });
});
describe("Workers deployment and security contracts", () => {
  it("serves the public demo shell without a session and without customer data", async () => {
    const demo = await worker.fetch(new Request("https://pulse.test/demo"), env);
    expect(demo.status).toBe(200);
    expect(demo.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    const shell = await demo.text();
    expect(shell).toContain('id="root"');
    expect(shell).not.toContain("owner@example.test");
    expect((await worker.fetch(new Request("https://pulse.test/api/contacts"), env)).status).toBe(401);
  });
  it("serves only the public sign-in shell and assets before login; unknown routes stay 404", async () => {
    const raw = (path) =>
      worker.fetch(new Request(`https://pulse.test${path}`), env);
    const root = await raw("/");
    expect(root.status).toBe(302);
    expect(root.headers.get("Location")).toBe("https://pulse.test/signin");
    const signin = await raw("/signin");
    expect(signin.status).toBe(200);
    expect(signin.headers.get("Cache-Control")).toBe("private, no-store");
    expect(signin.headers.get("Content-Security-Policy")).toContain(
      "script-src 'self'",
    );
    const shell = await signin.text();
    expect(shell).toContain('id="root"');
    expect(shell).not.toContain("owner@example.test");
    const asset = shell.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
    expect((await raw(asset)).status).toBe(200);
    for (const p of [
      "/unknown",
      "/.dev.vars",
      "/src/worker.js",
      "/data/pulse.db",
      "/assets/../index.html",
    ])
      expect((await raw(p)).status).not.toBe(200);
    expect((await request("/contacts")).status).toBe(401);
  });
  it("fails closed without an origin, database, pepper, or migration", async () => {
    const req = () => new Request("https://pulse.test/api/health");
    for (const extra of [
      { APP_ORIGIN: "" },
      { DB: null },
      { AUTH_PEPPER: "" },
      {
        DB: {
          withSession: () => ({
            prepare: () => ({
              bind: () => ({ first: async () => ({ version: 0 }) }),
            }),
          }),
        },
      },
    ])
      expect((await worker.fetch(req(), { ...env, ...extra })).status).toBe(
        503,
      );
  });
  it("allows exactly one owner through a setup race", async () => {
    const c = await credential();
    const attempt = (email) =>
      request("/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email, ...c, setupToken: env.SETUP_TOKEN }),
      });
    const results = await Promise.all([
      attempt("first@example.test"),
      attempt("second@example.test"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 403]);
    expect(
      (await env.DB.prepare("SELECT count(*) n FROM users").first()).n,
    ).toBe(1);
  });
  it("returns indistinguishable challenge shapes and throttles repeated invalid login", async () => {
    await setup();
    const known = await request("/auth/challenge?email=owner%40example.test"),
      unknown = await request("/auth/challenge?email=unknown%40example.test"),
      again = await request("/auth/challenge?email=unknown%40example.test");
    expect(Object.keys(known.body)).toEqual(["salt"]);
    expect(Object.keys(unknown.body)).toEqual(["salt"]);
    expect(unknown.body.salt).toBe(again.body.salt);
    expect(known.body.salt).toHaveLength(22);
    expect(unknown.body.salt).toHaveLength(22);
    const bad = await credential(
      "An incorrect test passphrase",
      known.body.salt,
    );
    for (let i = 0; i < 7; i++)
      expect(
        (
          await request("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email: "owner@example.test", ...bad }),
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await request("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: "owner@example.test", ...bad }),
        })
      ).status,
    ).toBe(429);
    expect(
      (await request("/auth/challenge?email=owner%40example.test")).status,
    ).toBe(429);
    const stored = await env.DB.prepare(
      "SELECT subject_hash FROM login_attempts",
    ).all();
    expect(
      stored.results.every((x) => /^[A-Za-z0-9_-]{43}$/.test(x.subject_hash)),
    ).toBe(true);
  });
  it("handles parallel bad login atomically and persists the IP bucket across email changes", async () => {
    await setup();
    const salt = (await request("/auth/challenge?email=owner%40example.test"))
        .body.salt,
      bad = await credential("Another wrong test passphrase", salt);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        request("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: "owner@example.test", ...bad }),
        }),
      ),
    );
    expect(results.every((r) => [401, 429].includes(r.status))).toBe(true);
    expect(results.some((r) => r.status === 429)).toBe(true);
    expect(
      (
        await request("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: "owner@example.test", ...bad }),
        })
      ).status,
    ).toBe(429);
  });
  it("logs out a valid session and retains registration closure without SETUP_TOKEN", async () => {
    const signup = await setup(),
      auth = authenticate(signup.response);
    expect(
      (
        await request("/auth/logout", {
          method: "POST",
          headers: auth,
          body: "{}",
        })
      ).status,
    ).toBe(204);
    expect((await request("/contacts", { headers: auth })).status).toBe(401);
    const session = await worker.fetch(
      new Request("https://pulse.test/api/auth/session"),
      { ...env, SETUP_TOKEN: undefined },
    );
    expect((await session.json()).setupRequired).toBe(false);
  });
  it("rejects oversized streaming JSON without trusting Content-Length", async () => {
    const { response } = await setup();
    const auth = authenticate(response);
    const result = await request("/contacts", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ first_name: "x".repeat(210 * 1024) }),
    });
    expect(result.status).toBe(413);
  });
  it("moves a sole deal between stages without changing its id and appends after final source deletion", async () => {
    const api = await form(),
      contact = await addContact(api),
      deal = await addDeal(api, contact);
    for (const stage of ["Proposal", "Booked", "Won", "New Lead"]) {
      const moved = await api(`/opportunities/${deal.id}`, {
        method: "PATCH",
        body: { stage },
      });
      expect(moved.status).toBe(200);
      expect(moved.body.opportunity.id).toBe(deal.id);
      expect(moved.body.opportunity.stage).toBe(stage);
      expect(moved.body.opportunity.position).toBe(0);
    }
  });
  it("keeps pipeline positions contiguous after parallel API creates", async () => {
    const api = await form(),
      contact = await addContact(api);
    const writes = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        api("/opportunities", {
          body: { title: `Concurrent ${i}`, contact_id: contact.id, value: 1 },
        }),
      ),
    );
    expect(writes.every((w) => [201, 409].includes(w.status))).toBe(true);
    const records = (await api("/opportunities", { method: "GET" })).body
      .stages["New Lead"];
    expect(records.length).toBeGreaterThan(0);
    expect(records.map((r) => r.position)).toEqual(records.map((_, i) => i));
  });
});
it("retains owner sessions and CRM records after local D1 instance eviction", async () => {
  const { abortAllDurableObjects } = await import("cloudflare:test");
  const api = await form(),
    contact = await addContact(api),
    deal = await addDeal(api, contact);
  await api(`/contacts/${contact.id}/notes`, {
    body: { body: "Durable note" },
  });
  const task = await api("/tasks", { body: { title: "Durable task" } }),
    appointment = await api("/appointments", {
      body: { title: "Durable appointment", starts_at: "2027-01-01T12:00:00Z" },
    });
  await abortAllDurableObjects();
  const detail = await api(`/contacts/${contact.id}`, { method: "GET" });
  expect(detail.status).toBe(200);
  expect(detail.body.notes[0].body).toBe("Durable note");
  expect(detail.body.opportunities[0].id).toBe(deal.id);
  expect((await api("/tasks", { method: "GET" })).body.tasks[0].id).toBe(
    task.body.task.id,
  );
  expect(
    (await api("/appointments", { method: "GET" })).body.appointments[0].id,
  ).toBe(appointment.body.appointment.id);
});
it("preserves contact tags in partial patches and makes empty/deleted record errors safe", async () => {
  const api = await form(),
    contact = await addContact(api);
  const patch = await api(`/contacts/${contact.id}`, {
    method: "PATCH",
    body: { company: "Partial patch" },
  });
  expect(patch.status).toBe(200);
  expect(patch.body.contact.tags).toEqual(["priority"]);
  const special = await addContact(api, "Percent_%", "Test");
  expect(
    (await api("/contacts?q=Percent_%", { method: "GET" })).body.contacts.map(
      (c) => c.id,
    ),
  ).toEqual([special.id]);
  expect(
    (
      await api("/opportunities/missing", {
        method: "PATCH",
        body: { stage: "Won" },
      })
    ).status,
  ).toBe(404);
  expect(
    (await api(`/contacts/${contact.id}`, { method: "DELETE" })).status,
  ).toBe(200);
  expect((await api(`/contacts/${contact.id}`, { method: "GET" })).status).toBe(
    404,
  );
});
