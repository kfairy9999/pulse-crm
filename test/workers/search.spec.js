import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { deriveCredential } from "../../src/auth/password.js";
import worker from "../../src/worker.js";
import { COLLECTION, DENSE_SIZE, EMBED_URL, EMBEDDING_MODEL, EXTERNAL_LIMIT, resetSearchState } from "../../src/search.js";

const KEYS = {
  QDRANT_URL: "https://qdrant.test",
  QDRANT_API_KEY: "qd-worker-test-key",
  GEMINI_API_KEY: "gm-worker-test-key",
  SEARCH_API_TOKEN: "worker-search-token-32-characters",
};

beforeEach(() => resetSearchState());

async function request(path, options = {}, runtime = env) {
  const headers = new Headers({
    Origin: "https://pulse.test",
    "CF-Connecting-IP": "203.0.113.40",
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...options.headers,
  });
  const response = await worker.fetch(new Request(`https://pulse.test${path}`, { ...options, headers }), runtime);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { response, body, status: response.status };
}

function sessionHeaders(response) {
  const raw = response.headers.getSetCookie();
  const cookie = raw.map((item) => item.split(";")[0]).join("; ");
  const csrf = decodeURIComponent(raw.find((item) => item.startsWith("__Host-pulse_csrf=")).split(";")[0].slice("__Host-pulse_csrf=".length));
  return { Cookie: cookie, "X-CSRF-Token": csrf };
}

async function owner() {
  const credential = await deriveCredential("Correct Horse Battery Staple!");
  const setup = await request("/api/auth/setup", {
    method: "POST",
    body: JSON.stringify({ email: "owner@example.test", ...credential, setupToken: env.SETUP_TOKEN }),
  });
  expect(setup.status).toBe(201);
  return sessionHeaders(setup.response);
}

function remote(points = []) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ href, method: init.method || "GET", body, headers: Object.fromEntries(new Headers(init.headers).entries()) });
    if (href === EMBED_URL) return Response.json({ embedding: { values: Array.from({ length: DENSE_SIZE }, () => 0.02) } });
    if (href.endsWith(`/collections/${COLLECTION}`) && (init.method || "GET") === "GET") return new Response("{}", { status: 404 });
    if (href.endsWith("/points/query")) return Response.json({ result: { points } });
    return Response.json({ result: { status: "ok" } });
  };
  return { calls, fetchImpl };
}

describe("search API", () => {
  it("keeps the demo and anonymous keyword route from calling Qdrant", async () => {
    const calls = [];
    const runtime = { ...env, SEARCH_FETCH: async () => { calls.push(1); return new Response("no", { status: 500 }); } };
    expect((await worker.fetch(new Request("https://pulse.test/demo"), runtime)).status).toBe(200);
    expect((await request("/api/search?q=proposal", {}, runtime)).status).toBe(401);
    expect((await request("/api/search?q=proposal", {}, runtime)).body.error).toMatch(/sign in/i);
    const external = await request("/api/v1/search", { method: "POST", body: JSON.stringify({ q: "proposal" }) }, runtime);
    expect(external.status).toBe(401);
    expect(external.body.error).toMatch(/token is missing or incorrect/);
    expect((await request("/api/v1/search", { method: "GET" }, runtime)).status).toBe(405);
    expect(calls).toEqual([]);
    const auth = await owner();
    const status = await request("/api/search/status", { method: "GET", headers: auth }, runtime);
    expect(status.body.mode).toBe("keyword");
    expect(status.body.embeddingModel).toBeNull();
    expect(status.body.label).toMatch(/not semantic or vector results/);
    const created = await request("/api/contacts", { method: "POST", headers: auth, body: JSON.stringify({ first_name: "Obsidian", last_name: "Lane" }) }, runtime);
    expect(created.status).toBe(201);
    const found = await request(`/api/search?q=${encodeURIComponent("Obsidian")}`, { method: "GET", headers: auth }, runtime);
    expect(found.body.mode).toBe("keyword");
    expect(found.body.results.some((result) => result.recordId === created.body.contact.id)).toBe(true);
    expect((await request("/api/search?q=proposal&type=robot", { method: "GET", headers: auth }, runtime)).status).toBe(400);
    expect(JSON.stringify(found.body)).not.toMatch(/qd-worker-test-key|gm-worker-test-key/);
    expect(calls).toEqual([]);
  });

  it("upserts records and applies contact filters before returning hybrid results", async () => {
    const auth = await owner();
    const { calls, fetchImpl } = remote();
    const runtime = { ...env, ...KEYS, SEARCH_FETCH: fetchImpl };
    const ava = await request("/api/contacts", { method: "POST", headers: auth, body: JSON.stringify({ first_name: "Ava", last_name: "Kiln", company: "Northstar" }) }, runtime);
    const liam = await request("/api/contacts", { method: "POST", headers: auth, body: JSON.stringify({ first_name: "Liam", last_name: "Chen" }) }, runtime);
    expect(ava.status).toBe(201);
    const upserts = calls.filter((call) => call.href.includes("/points?wait=true"));
    expect(upserts.length).toBeGreaterThanOrEqual(2);
    expect(upserts[0].body.points[0].payload).toMatchObject({ recordType: "contact", contactId: ava.body.contact.id, schemaVersion: 1 });
    expect(upserts[0].body.points[0].vector.dense).toHaveLength(DENSE_SIZE);
    expect(upserts[0].headers["api-key"]).toBe(KEYS.QDRANT_API_KEY);
    expect(calls.some((call) => call.href === EMBED_URL && call.body.task_type === "RETRIEVAL_DOCUMENT" && call.headers["x-goog-api-key"] === KEYS.GEMINI_API_KEY)).toBe(true);
    expect(calls.some((call) => call.href.includes("key="))).toBe(false);
    const patched = await request(`/api/contacts/${ava.body.contact.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ company: "Kiln Atelier" }) }, runtime);
    expect(patched.status).toBe(200);
    expect(calls.filter((call) => call.href === EMBED_URL).at(-1).body.content.parts[0].text).toMatch(/Kiln Atelier/);
    const leaked = [
      { id: "1", score: 0.8, payload: { schemaVersion: 1, recordType: "note", recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", contactId: liam.body.contact.id, dealId: null, stage: null, title: "Note · Liam", snippet: "other kiln", date: "2026-11-12T00:00:00.000Z" } },
      { id: "2", score: 0.4, payload: { schemaVersion: 1, recordType: "note", recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", contactId: ava.body.contact.id, dealId: null, stage: null, title: "Note · Ava", snippet: "ava kiln", date: "2026-11-12T00:00:00.000Z" } },
    ];
    const probe = remote(leaked);
    runtime.SEARCH_FETCH = probe.fetchImpl;
    const again = await request(`/api/search?q=kiln&contactId=${ava.body.contact.id}&type=note`, { method: "GET", headers: auth }, runtime);
    expect(again.status).toBe(200);
    expect(again.body.mode).toBe("hybrid");
    expect(again.body.embeddingModel).toBe(EMBEDDING_MODEL);
    expect(again.body.collection).toBe(COLLECTION);
    const queryCall = probe.calls.find((call) => call.href.endsWith("/points/query"));
    expect(queryCall.body.filter.must.map((clause) => clause.key).sort()).toEqual(["contactId", "recordType"]);
    expect(queryCall.body.prefetch.every((item) => item.filter.must.some((clause) => clause.match?.value === ava.body.contact.id))).toBe(true);
    expect(again.body.results.map((item) => item.contactId)).toEqual([ava.body.contact.id]);
    expect(JSON.stringify(again.body)).not.toContain(KEYS.QDRANT_API_KEY);
    const removed = await request(`/api/contacts/${liam.body.contact.id}`, { method: "DELETE", headers: auth }, runtime);
    expect(removed.status).toBe(200);
  });

  it("rate limits the bearer API and rejects a wrong token before embedding", async () => {
    const calls = [];
    const runtime = {
      ...env,
      ...KEYS,
      SEARCH_FETCH: async () => { calls.push(1); return new Response("no", { status: 503 }); },
    };
    const wrong = await request("/api/v1/search", {
      method: "POST",
      headers: { Authorization: "Bearer not-the-token", Origin: "https://other.example" },
      body: JSON.stringify({ q: "kiln" }),
    }, runtime);
    expect(wrong.status).toBe(401);
    expect(calls).toEqual([]);
    for (let index = 0; index < EXTERNAL_LIMIT; index += 1) {
      const response = await request("/api/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEYS.SEARCH_API_TOKEN}` },
        body: JSON.stringify({ q: "kiln", type: "contact" }),
      }, runtime);
      expect(response.status).toBe(200);
      expect(response.body.mode).toBe("keyword");
      expect(response.body.degraded).toBe(true);
    }
    const limited = await request("/api/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEYS.SEARCH_API_TOKEN}` },
      body: JSON.stringify({ q: "kiln" }),
    }, runtime);
    expect(limited.status).toBe(429);
    expect(limited.response.headers.get("Retry-After")).toBeTruthy();
    expect(limited.body.error).toMatch(/temporarily limited/);
    expect(calls).toHaveLength(EXTERNAL_LIMIT);
  });

  it("reindexes only while hybrid search is configured, in bounded batches", async () => {
    const auth = await owner();
    const plain = await request("/api/search/reindex", { method: "POST", headers: auth, body: JSON.stringify({ offset: 0 }) });
    expect(plain.status).toBe(200);
    expect(plain.body.mode).toBe("keyword");
    expect(plain.body.indexed).toBe(false);
    const { calls, fetchImpl } = remote();
    const runtime = { ...env, ...KEYS, SEARCH_FETCH: fetchImpl };
    const created = await request("/api/contacts", { method: "POST", headers: auth, body: JSON.stringify({ first_name: "Nia", last_name: "Cole" }) }, runtime);
    expect(created.status).toBe(201);
    calls.length = 0;
    const indexed = await request("/api/search/reindex", { method: "POST", headers: auth, body: JSON.stringify({ offset: 0 }) }, runtime);
    expect(indexed.status).toBe(200);
    expect(indexed.body.mode).toBe("hybrid");
    expect(indexed.body.count).toBeGreaterThan(0);
    expect(calls.some((call) => call.href === EMBED_URL)).toBe(true);
  });
});
