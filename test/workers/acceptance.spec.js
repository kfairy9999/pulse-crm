import { it, expect } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../../src/worker.js";
import {
  decode64,
  deriveCredential,
  encode64,
} from "../../src/auth/password.js";

const password = "Correct Horse Battery Staple!";
const closed = "Workspace setup is closed.";
const setupGate =
  "Workspace setup is closed until a provider-generated setup key is configured.";
const wrongKey = "Email, password, or setup key is incorrect.";
const pepperGate =
  "Configure the managed AUTH_PEPPER secret and AUTH_PEPPER_ID before using this Worker.";
const hidden = "The service could not complete this request. Please try again.";

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bumped(bytes) {
  const canonical = encode64(bytes);
  const next = alphabet[alphabet.indexOf(canonical.at(-1)) + 1];
  const candidate = canonical.slice(0, -1) + next;
  expect(candidate).toHaveLength(canonical.length);
  expect(() => decode64(candidate, bytes.length)).toThrow(
    "Invalid credential encoding.",
  );
  return { canonical, candidate };
}

function alphanumericSetupKey() {
  for (let seed = 1; seed < 5000; seed++) {
    const bytes = Uint8Array.from(
      { length: 32 },
      (_, index) => (seed * 31 + index * 17) & 255,
    );
    const canonical = encode64(bytes);
    if (!/^[A-Za-z0-9]{43}$/.test(canonical)) continue;
    const candidate = bumped(bytes).candidate;
    if (/^[A-Za-z0-9]{43}$/.test(candidate))
      return { canonical, candidate };
  }
  throw new Error("No alphanumeric setup-key fixture was found.");
}

async function call(path, options = {}, runtime = env) {
  const headers = new Headers({
    Origin: "https://pulse.test",
    "CF-Connecting-IP": "203.0.113.10",
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...options.headers,
  });
  const response = await worker.fetch(
    new Request(`https://pulse.test/api${path}`, { ...options, headers }),
    runtime,
  );
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { response, body, status: response.status };
}

function sessionHeaders(response) {
  const raw = response.headers.getSetCookie();
  const cookie = raw.map((item) => item.split(";")[0]).join("; ");
  const csrf = decodeURIComponent(
    raw
      .find((item) => item.startsWith("__Host-pulse_csrf="))
      .split(";")[0]
      .slice("__Host-pulse_csrf=".length),
  );
  return { Cookie: cookie, "X-CSRF-Token": csrf, raw };
}

async function users() {
  return (await env.DB.prepare("SELECT COUNT(*) n FROM users").first()).n;
}

it("accepts an arbitrary 43-character alphanumeric setup key and rejects its canonical re-encoding", async () => {
  const tokenPair = alphanumericSetupKey();
  const token = tokenPair.candidate;
  const runtime = { ...env, SETUP_TOKEN: token };
  const credential = await deriveCredential(password);
  const attempt = (setupToken) =>
    call(
      "/auth/setup",
      {
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.test",
          ...credential,
          setupToken,
        }),
      },
      runtime,
    );
  const mismatched = await attempt(tokenPair.canonical);
  expect(mismatched.status).toBe(403);
  expect(mismatched.body.error).toBe(wrongKey);
  expect(await users()).toBe(0);
  const created = await attempt(token);
  expect(created.status).toBe(201);
  expect(created.body.user.email).toBe("owner@example.test");
  expect(await users()).toBe(1);
  const again = await attempt(token);
  expect(again.status).toBe(403);
  expect(again.body.error).toBe(closed);
});

it("keeps setup closed for a missing or short key and does not create an owner", async () => {
  const credential = await deriveCredential(password);
  for (const SETUP_TOKEN of [undefined, "", "short-setup-key", "a".repeat(31)]) {
    const result = await call(
      "/auth/setup",
      {
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.test",
          ...credential,
          setupToken: "a".repeat(43),
        }),
      },
      { ...env, SETUP_TOKEN },
    );
    expect(result.status).toBe(503);
    expect(result.body.error).toBe(setupGate);
  }
  expect(await users()).toBe(0);
});

it("accepts a 32-character setup key when it matches exactly", async () => {
  const token = `pulse-setup-${"a".repeat(20)}`;
  expect(token).toHaveLength(32);
  const credential = await deriveCredential(password);
  const result = await call(
    "/auth/setup",
    {
      method: "POST",
      body: JSON.stringify({
        email: "owner@example.test",
        ...credential,
        setupToken: token,
      }),
    },
    { ...env, SETUP_TOKEN: token },
  );
  expect(result.status).toBe(201);
  expect(await users()).toBe(1);
});

it("rejects non-canonical, padded, and wrong-length credentials without enrolling", async () => {
  const token = "LOCAL_TEST_SETUP_ONLY_32_BYTES_LONG_GENERATED";
  const runtime = { ...env, SETUP_TOKEN: token };
  const salt = encode64(Uint8Array.from({ length: 16 }, (_, index) => index + 4));
  const credential = encode64(
    Uint8Array.from({ length: 32 }, (_, index) => index + 8),
  );
  const badCredential = bumped(
    Uint8Array.from({ length: 32 }, (_, index) => index + 8),
  ).candidate;
  const badSalt = bumped(
    Uint8Array.from({ length: 16 }, (_, index) => index + 4),
  ).candidate;
  const attempt = (body) =>
    call(
      "/auth/setup",
      { method: "POST", body: JSON.stringify({ email: "owner@example.test", setupToken: token, ...body }) },
      runtime,
    );
  const shortCredential = await attempt({
    salt,
    credential: credential.slice(0, 42),
  });
  expect(shortCredential.status).toBe(400);
  expect(shortCredential.body.error).toBe(
    "A securely derived password is required.",
  );
  for (const body of [
    { salt, credential: badCredential },
    { salt, credential: `${credential.slice(0, 42)}+` },
    { salt: badSalt, credential },
    { salt: `${salt.slice(0, 21)}=`, credential },
  ]) {
    const result = await attempt(body);
    expect(result.status).toBe(500);
    expect(result.body.error).toBe(hidden);
    expect(JSON.stringify(result.body)).not.toMatch(/AUTH_PEPPER|SETUP_TOKEN/);
  }
  expect(await users()).toBe(0);
  const health = await worker.fetch(new Request("https://pulse.test/api/health"), {
    ...env,
    AUTH_PEPPER: badCredential,
  });
  expect(health.status).toBe(503);
  expect(await health.json()).toMatchObject({ error: pepperGate });
});

it("retains authenticated CRM records across logout, CSRF rejection, and a removed setup key", async () => {
  const token = alphanumericSetupKey().candidate;
  const runtime = { ...env, SETUP_TOKEN: token };
  const credential = await deriveCredential(password);
  const created = await call(
    "/auth/setup",
    {
      method: "POST",
      body: JSON.stringify({
        email: "owner@example.test",
        ...credential,
        setupToken: token,
      }),
    },
    runtime,
  );
  expect(created.status).toBe(201);
  const auth = sessionHeaders(created.response);
  expect(auth.raw.some((cookie) => cookie.startsWith("__Host-pulse_session=") && cookie.includes("HttpOnly") && cookie.includes("Secure"))).toBe(true);
  expect(auth.raw.some((cookie) => cookie.startsWith("__Host-pulse_csrf=") && cookie.includes("Secure") && !cookie.includes("HttpOnly"))).toBe(true);
  const closedSetup = await call(
    "/auth/setup",
    {
      method: "POST",
      body: JSON.stringify({
        email: "other@example.test",
        ...credential,
        setupToken: token,
      }),
    },
    { ...env, SETUP_TOKEN: undefined },
  );
  expect(closedSetup.status).toBe(403);
  expect(closedSetup.body.error).toBe(closed);
  const contact = await call(
    "/contacts",
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.test",
        company: "Analytical Engines",
        tags: ["Priority"],
      }),
    },
    runtime,
  );
  expect(contact.status).toBe(201);
  const contactId = contact.body.contact.id;
  expect(
    (
      await call(
        `/contacts/${contactId}/notes`,
        { method: "POST", headers: auth, body: JSON.stringify({ body: "Persisted note" }) },
        runtime,
      )
    ).status,
  ).toBe(201);
  const deal = await call(
    "/opportunities",
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        title: "Analytical engine",
        contact_id: contactId,
        stage: "New Lead",
        value: 1250,
      }),
    },
    runtime,
  );
  expect(deal.status).toBe(201);
  const task = await call(
    "/tasks",
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        title: "Write the specification",
        contact_id: contactId,
        due_date: "2026-12-01",
        priority: "High",
      }),
    },
    runtime,
  );
  expect(task.status).toBe(201);
  const appointment = await call(
    "/appointments",
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        title: "Design review",
        contact_id: contactId,
        starts_at: "2027-02-02T15:00:00.000Z",
        duration_minutes: 30,
      }),
    },
    runtime,
  );
  expect(appointment.status).toBe(201);
  const patched = await call(
    `/contacts/${contactId}`,
    {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ company: "Persisted Company" }),
    },
    runtime,
  );
  expect(patched.status).toBe(200);
  expect(patched.body.contact.tags).toEqual(["priority"]);
  const completed = await call(
    `/tasks/${task.body.task.id}`,
    {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ completed: true }),
    },
    runtime,
  );
  expect(completed.body.task.status).toBe("Completed");
  const anonymous = await call("/contacts", { method: "GET" }, runtime);
  expect(anonymous.status).toBe(401);
  expect(anonymous.response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(anonymous.body.error).toBe("Please sign in to continue.");
  const missingCsrf = await call(
    "/auth/logout",
    { method: "POST", headers: { Cookie: auth.Cookie }, body: "{}" },
    runtime,
  );
  expect(missingCsrf.status).toBe(403);
  expect(missingCsrf.body.error).toBe(
    "Your security token is invalid. Please refresh and try again.",
  );
  const wrongCsrf = await call(
    "/auth/logout",
    {
      method: "POST",
      headers: { Cookie: auth.Cookie, "X-CSRF-Token": `${auth["X-CSRF-Token"]}x` },
      body: "{}",
    },
    runtime,
  );
  expect(wrongCsrf.status).toBe(403);
  expect((await call(`/contacts/${contactId}`, { method: "GET", headers: auth }, runtime)).status).toBe(200);
  const logout = await call(
    "/auth/logout",
    { method: "POST", headers: auth, body: "{}" },
    runtime,
  );
  expect(logout.status).toBe(204);
  expect(logout.response.headers.get("Cache-Control")).toBe("private, no-store");
  const afterLogout = await call(
    `/contacts/${contactId}`,
    { method: "GET", headers: auth },
    { ...env, SETUP_TOKEN: undefined },
  );
  expect(afterLogout.status).toBe(401);
  expect(afterLogout.response.headers.get("Cache-Control")).toBe("private, no-store");
  const salt = (await env.DB.prepare("SELECT password_salt FROM users").first()).password_salt;
  const login = await call(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({
        email: "owner@example.test",
        ...(await deriveCredential(password, salt)),
      }),
    },
    { ...env, SETUP_TOKEN: undefined },
  );
  expect(login.status).toBe(200);
  const next = sessionHeaders(login.response);
  const restored = await call(
    `/contacts/${contactId}`,
    { method: "GET", headers: next },
    { ...env, SETUP_TOKEN: undefined },
  );
  expect(restored.status).toBe(200);
  expect(restored.body.contact.company).toBe("Persisted Company");
  expect(restored.body.notes.map((note) => note.body)).toEqual(["Persisted note"]);
  expect(restored.body.opportunities.map((item) => item.id)).toEqual([deal.body.opportunity.id]);
  expect(
    (await call("/tasks", { method: "GET", headers: next }, { ...env, SETUP_TOKEN: undefined })).body.tasks[0].status,
  ).toBe("Completed");
  expect(
    (await call("/appointments", { method: "GET", headers: next }, { ...env, SETUP_TOKEN: undefined })).body.appointments[0].id,
  ).toBe(appointment.body.appointment.id);
  expect(
    (await call(`/opportunities/${deal.body.opportunity.id}`, { method: "DELETE", headers: next }, { ...env, SETUP_TOKEN: undefined })).status,
  ).toBe(200);
  expect(
    (await call(`/contacts/${contactId}`, { method: "DELETE", headers: next }, { ...env, SETUP_TOKEN: undefined })).status,
  ).toBe(200);
  expect(
    (await call(`/contacts/${contactId}`, { method: "GET", headers: next }, { ...env, SETUP_TOKEN: undefined })).status,
  ).toBe(404);
  expect(
    (await call("/auth/session", { method: "GET", headers: next }, { ...env, SETUP_TOKEN: undefined })).body,
  ).toMatchObject({ authenticated: true, setupRequired: false });
});
