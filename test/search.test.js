import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { D1Shim } from "../src/client/demo/d1Shim.js";
import { seedStatements } from "../src/client/demo/seed.js";
import { handleCrm } from "../src/crm.js";
import {
  COLLECTION,
  DENSE_SIZE,
  EMBED_URL,
  EMBEDDING_MODEL,
  EXTERNAL_LIMIT,
  LABELS,
  PAYLOAD_SCHEMA,
  SESSION_LIMIT,
  buildFilter,
  consumeRateLimit,
  contactDocument,
  embedRequestBody,
  executeSearch,
  handleExternalSearch,
  handleSessionSearch,
  hybridRequest,
  keywordSearch,
  parseSearchParams,
  payloadMatches,
  pointId,
  qdrantOrigin,
  resetSearchState,
  searchConfig,
  sparseVector,
  syncSearchIndex,
  taskDocument,
  tokensEqual,
} from "../src/search.js";

const KEYS = {
  QDRANT_URL: "https://qdrant.test",
  QDRANT_API_KEY: "qd-test-key",
  GEMINI_API_KEY: "gm-test-key",
  SEARCH_API_TOKEN: "search-token-for-tests-32ch-minimum",
};

async function demoDb() {
  const SQL = await initSqlJs();
  const db = new D1Shim(new SQL.Database());
  await db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  await db.batch(seedStatements(db, 0));
  return db;
}

async function call(db, method, path, body = null, env = {}) {
  const url = new URL(`https://demo.test${path}`);
  const response = await handleCrm(new Request(url, { method }), { DB: db, ...env }, { method, path: url.pathname, body, url });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function dense() {
  return Array.from({ length: DENSE_SIZE }, (_, index) => (index + 1) / 1000);
}

function mockRemote(points = []) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ href, method: init.method || "GET", body, headers: Object.fromEntries(new Headers(init.headers).entries()) });
    if (href === EMBED_URL) return Response.json({ embedding: { values: dense() } });
    if (href.endsWith(`/collections/${COLLECTION}`) && (init.method || "GET") === "GET") {
      return new Response(JSON.stringify({ status: { error: "Not found" } }), { status: 404 });
    }
    if (href.endsWith("/points/query")) return Response.json({ result: { points } });
    return Response.json({ result: { status: "ok" } });
  };
  return { calls, fetchImpl };
}

test("sparse vectors are deterministic hashed terms, not a hosted embedding", () => {
  const first = sparseVector("The kiln proposal for Ava");
  const second = sparseVector("kiln proposal ava");
  assert.deepEqual(first.indices, second.indices);
  assert.equal(first.indices.length, first.values.length);
  assert.equal(sparseVector("the and of").indices.length, 0);
  assert.ok(first.indices.every((index, place) => place === 0 || index > first.indices[place - 1]));
});

test("point ids stay stable for a record and differ by type", async () => {
  const contact = await pointId("contact", "11111111-1111-4111-8111-111111111111");
  assert.equal(contact, await pointId("contact", "11111111-1111-4111-8111-111111111111"));
  assert.notEqual(contact, await pointId("note", "11111111-1111-4111-8111-111111111111"));
  assert.match(contact, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("hybrid requests put the same metadata filter on both prefetches", () => {
  const filters = parseSearchParams({
    q: "kiln proposal",
    type: "note",
    contactId: "11111111-1111-4111-8111-111111111111",
    dealId: "22222222-2222-4222-8222-222222222222",
    stage: "Proposal",
    from: "2026-11-01",
    to: "2026-11-30",
    limit: 5,
  });
  const sparse = sparseVector(filters.q);
  const body = hybridRequest(filters, dense(), sparse);
  assert.equal(body.query.fusion, "rrf");
  assert.equal(body.prefetch[0].using, "sparse");
  assert.equal(body.prefetch[1].using, "dense");
  assert.deepEqual(body.prefetch[0].filter, body.filter);
  assert.deepEqual(body.prefetch[1].filter, body.filter);
  assert.deepEqual(buildFilter(filters), body.filter);
  assert.ok(body.filter.must.some((clause) => clause.key === "contactId" && clause.match.value === filters.contactId));
  assert.equal(body.filter.must.find((clause) => clause.key === "date").range.gte, "2026-11-01T00:00:00.000Z");
  assert.equal(body.filter.must.find((clause) => clause.key === "date").range.lte, "2026-11-30T23:59:59.999Z");
});

test("search configuration requires https Qdrant, both keys, and a long API token", () => {
  assert.equal(searchConfig({}).hybrid, false);
  assert.equal(searchConfig({ QDRANT_URL: KEYS.QDRANT_URL, QDRANT_API_KEY: KEYS.QDRANT_API_KEY }).hybrid, false);
  assert.equal(searchConfig(KEYS).hybrid, true);
  assert.equal(searchConfig({ ...KEYS, SEARCH_API_TOKEN: "too-short" }).apiToken, null);
  assert.equal(qdrantOrigin("http://example.com"), null);
  assert.equal(qdrantOrigin("https://user:pass@qdrant.test"), null);
  assert.equal(qdrantOrigin("http://127.0.0.1:6333"), "http://127.0.0.1:6333");
  const embed = embedRequestBody("kiln", "RETRIEVAL_QUERY");
  assert.equal(embed.output_dimensionality, 768);
  assert.equal(embed.task_type, "RETRIEVAL_QUERY");
  assert.equal(EMBEDDING_MODEL, "gemini-embedding-2");
  assert.match(EMBED_URL, /gemini-embedding-2:embedContent$/);
});

test("payload filter drops a point that belongs to another contact, deal, stage, or date", () => {
  const filters = parseSearchParams({
    q: "kiln",
    contactId: "11111111-1111-4111-8111-111111111111",
    dealId: "22222222-2222-4222-8222-222222222222",
    stage: "Proposal",
    from: "2026-11-01",
    to: "2026-11-02",
  });
  const good = {
    schemaVersion: PAYLOAD_SCHEMA,
    recordType: "deal",
    recordId: filters.dealId,
    contactId: filters.contactId,
    dealId: filters.dealId,
    stage: "Proposal",
    title: "Kiln",
    snippet: "Kiln",
    date: "2026-11-01T12:00:00.000Z",
  };
  assert.equal(payloadMatches(good, filters), true);
  assert.equal(payloadMatches({ ...good, contactId: "33333333-3333-4333-8333-333333333333" }, filters), false);
  assert.equal(payloadMatches({ ...good, dealId: "44444444-4444-4444-8444-444444444444" }, filters), false);
  assert.equal(payloadMatches({ ...good, stage: "Won" }, filters), false);
  assert.equal(payloadMatches({ ...good, date: "2026-12-01T12:00:00.000Z" }, filters), false);
  assert.equal(payloadMatches({ ...good, schemaVersion: 2 }, filters), false);
});

test("keyword search on the demo database is labeled and does not cross contacts or deals", async () => {
  const db = await demoDb();
  const contacts = await call(db, "GET", "/api/contacts");
  const ava = contacts.body.contacts.find((contact) => contact.first_name === "Ava");
  const liam = contacts.body.contacts.find((contact) => contact.first_name === "Liam");
  const status = await call(db, "GET", "/api/search/status");
  assert.equal(status.body.mode, "keyword");
  assert.match(status.body.label, /not semantic or vector results/);
  assert.equal(status.body.embeddingModel, null);
  const found = await call(db, "GET", `/api/search?q=${encodeURIComponent("shared place")}`);
  assert.equal(found.body.mode, "keyword");
  assert.equal(found.body.embeddingModel, null);
  assert.ok(found.body.results.some((result) => result.recordType === "note" && result.contactId === ava.id));
  const limited = await call(db, "GET", `/api/search?q=${encodeURIComponent("shared place")}&contactId=${liam.id}`);
  assert.equal(limited.body.filters.contactId, liam.id);
  assert.equal(limited.body.results.some((result) => result.contactId === ava.id), false);
  const deals = await call(db, "GET", "/api/opportunities");
  const brand = Object.values(deals.body.stages).flat().find((deal) => deal.title.startsWith("Brand refresh"));
  const other = Object.values(deals.body.stages).flat().find((deal) => deal.title.startsWith("Content engine"));
  const byDeal = await call(db, "GET", `/api/search?q=${encodeURIComponent("approval")}&dealId=${brand.id}`);
  assert.ok(byDeal.body.results.every((result) => result.dealId === brand.id && result.recordType === "deal"));
  const wrongDeal = await call(db, "GET", `/api/search?q=${encodeURIComponent("approval")}&dealId=${other.id}`);
  assert.equal(wrongDeal.body.results.some((result) => result.recordId === brand.id), false);
  const won = await call(db, "GET", `/api/search?q=${encodeURIComponent("automation")}&stage=${encodeURIComponent("Won")}`);
  assert.ok(won.body.results.every((result) => result.stage === "Won"));
  assert.equal((await call(db, "GET", `/api/search?q=${encodeURIComponent("automation")}&stage=${encodeURIComponent("Lost")}`)).body.results.length, 0);
  assert.equal((await call(db, "GET", "/api/search?q=proposal&from=1999-01-01&to=1999-01-02")).body.results.length, 0);
  await assert.rejects(() => call(db, "GET", "/api/search?q=proposal&type=robot"), (error) => error.status === 400 && /Type must be/.test(error.message));
});

test("task dates used for filters are the due day at noon UTC", () => {
  const doc = taskDocument({
    id: "11111111-1111-4111-8111-111111111111",
    title: "Send the kiln notes",
    contact_id: "22222222-2222-4222-8222-222222222222",
    contact_name: "Ava Martinez",
    due_date: "2026-11-12",
    priority: "High",
    status: "Open",
    notes: "Bring the proposal",
    updated_at: "2026-11-01T00:00:00.000Z",
  });
  assert.equal(doc.date, "2026-11-12T12:00:00.000Z");
  assert.equal(doc.dealId, null);
  assert.match(contactDocument({ id: "a", first_name: "Ava", last_name: "Martinez", tags: "[]", updated_at: "2026-11-01T00:00:00.000Z" }).text, /Contact/);
});

test("hybrid search keeps Qdrant filters and discards a leaked point", async () => {
  resetSearchState();
  const db = await demoDb();
  const contacts = await call(db, "GET", "/api/contacts");
  const ava = contacts.body.contacts.find((contact) => contact.first_name === "Ava");
  const liam = contacts.body.contacts.find((contact) => contact.first_name === "Liam");
  const remote = mockRemote([
    { id: "1", score: 0.9, payload: { schemaVersion: 1, recordType: "note", recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", contactId: liam.id, dealId: null, stage: null, title: "Note · Liam", snippet: "other person", date: "2026-11-05T00:00:00.000Z" } },
    { id: "2", score: 0.2, payload: { schemaVersion: 1, recordType: "note", recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", contactId: ava.id, dealId: null, stage: null, title: "Note · Ava", snippet: "shared place", date: "2026-11-05T00:00:00.000Z" } },
  ]);
  const result = await executeSearch({ ...KEYS, SEARCH_FETCH: remote.fetchImpl, DB: db }, db, parseSearchParams({ q: "shared place", contactId: ava.id }));
  assert.equal(result.mode, "hybrid");
  assert.equal(result.embeddingModel, EMBEDDING_MODEL);
  assert.match(result.label, /gemini-embedding-2/);
  assert.deepEqual(result.results.map((item) => item.contactId), [ava.id]);
  const query = remote.calls.find((call) => call.href.endsWith("/points/query"));
  assert.equal(query.body.prefetch[0].filter.must[0].match.value, ava.id);
  assert.equal(query.body.prefetch[1].filter.must[0].match.value, ava.id);
  assert.equal(query.headers["api-key"], KEYS.QDRANT_API_KEY);
  const embed = remote.calls.find((call) => call.href === EMBED_URL);
  assert.equal(embed.headers["x-goog-api-key"], KEYS.GEMINI_API_KEY);
  assert.equal(embed.body.task_type, "RETRIEVAL_QUERY");
  assert.equal(embed.href.includes(KEYS.GEMINI_API_KEY), false);
});

test("a failed embedding call falls back to labeled keyword search", async () => {
  resetSearchState();
  const db = await demoDb();
  const fetchImpl = async () => new Response("no", { status: 503 });
  const result = await executeSearch({ ...KEYS, SEARCH_FETCH: fetchImpl }, db, parseSearchParams({ q: "shared place" }));
  assert.equal(result.mode, "keyword");
  assert.equal(result.degraded, true);
  assert.equal(result.label, LABELS.degraded);
  assert.equal(result.embeddingModel, null);
  assert.ok(result.results.some((item) => item.recordType === "note"));
});

test("writes upsert and delete Qdrant points when keys exist, and skip the network when they do not", async () => {
  resetSearchState();
  const db = await demoDb();
  const untouched = mockRemote();
  const created = await call(db, "POST", "/api/contacts", { first_name: "Rae", last_name: "Lopez", email: "rae@demo.example", company: "Kiln" }, { SEARCH_FETCH: untouched.fetchImpl });
  assert.equal(created.status, 201);
  assert.equal(untouched.calls.length, 0);
  const remote = mockRemote();
  const env = { ...KEYS, SEARCH_FETCH: remote.fetchImpl };
  const synced = await syncSearchIndex(env, db, { upsert: [{ type: "contact", id: created.body.contact.id }] });
  assert.equal(synced.indexed, true);
  const upsert = remote.calls.find((call) => call.href.includes("/points?wait=true"));
  const point = upsert.body.points[0];
  assert.equal(point.payload.recordType, "contact");
  assert.equal(point.payload.contactId, created.body.contact.id);
  assert.equal(point.payload.schemaVersion, PAYLOAD_SCHEMA);
  assert.equal(point.vector.dense.length, DENSE_SIZE);
  assert.ok(point.vector.sparse.indices.length);
  assert.equal(JSON.stringify(upsert.body).includes(KEYS.GEMINI_API_KEY), false);
  const embed = remote.calls.find((call) => call.href === EMBED_URL);
  assert.match(embed.body.content.parts[0].text, /Rae Lopez/);
  assert.equal(embed.body.task_type, "RETRIEVAL_DOCUMENT");
  const renamed = await call(db, "PATCH", `/api/contacts/${created.body.contact.id}`, { first_name: "Rae", last_name: "Atelier" }, env);
  assert.equal(renamed.status, 200);
  const again = remote.calls.filter((call) => call.href === EMBED_URL).at(-1);
  assert.match(again.body.content.parts[0].text, /Rae Atelier/);
  const removed = await call(db, "DELETE", `/api/contacts/${created.body.contact.id}`, null, env);
  assert.equal(removed.status, 200);
  const deleted = remote.calls.find((call) => call.href.includes("/points/delete"));
  assert.equal(deleted.body.filter.must[0].match.value, created.body.contact.id);
});

test("rate limit and bearer auth protect the external search API", async () => {
  const db = await demoDb();
  const first = await consumeRateLimit(db, ["a"], 2, 1000, 1_000);
  const second = await consumeRateLimit(db, ["a"], 2, 1000, 1_100);
  const blocked = await consumeRateLimit(db, ["a"], 2, 1000, 1_200);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1);
  assert.equal((await consumeRateLimit(db, ["b"], 2, 1000, 1_200)).ok, true);
  assert.equal(await tokensEqual("search-token-for-tests-32ch-minimum", KEYS.SEARCH_API_TOKEN), true);
  assert.equal(await tokensEqual("search-token-for-tests-32ch-minimum", "search-token-for-tests-32ch-other!!!!"), false);
  const env = { ...KEYS, DB: db, PULSE_RUNTIME: "production" };
  const missing = await handleExternalSearch(new Request("https://pulse.test/api/v1/search", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.8" }, body: JSON.stringify({ q: "proposal" }) }), env, { q: "proposal" });
  assert.equal(missing.status, 401);
  assert.match((await missing.json()).error, /token is missing or incorrect/);
  const calls = [];
  env.SEARCH_FETCH = async () => { calls.push(1); return new Response("no", { status: 503 }); };
  for (let index = 0; index < EXTERNAL_LIMIT; index += 1) {
    const response = await handleExternalSearch(new Request("https://pulse.test/api/v1/search", { method: "POST", headers: { Authorization: `Bearer ${KEYS.SEARCH_API_TOKEN}`, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" }, body: JSON.stringify({ q: "proposal" }) }), env, { q: "proposal" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "keyword");
    assert.equal(JSON.stringify(body).includes(KEYS.SEARCH_API_TOKEN), false);
  }
  const limited = await handleExternalSearch(new Request("https://pulse.test/api/v1/search", { method: "POST", headers: { Authorization: `Bearer ${KEYS.SEARCH_API_TOKEN}`, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" }, body: JSON.stringify({ q: "proposal" }) }), env, { q: "proposal" });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("Retry-After"));
  assert.equal(calls.length, EXTERNAL_LIMIT);
  let sessionCalls = 0;
  const sessionEnv = { ...KEYS, SEARCH_FETCH: async () => { sessionCalls += 1; return new Response("no", { status: 503 }); } };
  const url = new URL("https://demo.test/api/search?q=proposal");
  for (let index = 0; index < SESSION_LIMIT; index += 1) {
    assert.equal((await handleSessionSearch(sessionEnv, db, url, "owner")).status, 200);
  }
  const sessionLimited = await handleSessionSearch(sessionEnv, db, url, "owner");
  assert.equal(sessionLimited.status, 429);
  assert.equal(sessionCalls, SESSION_LIMIT);
});

test("keyword search can rank a note above an unrelated contact", async () => {
  const db = await demoDb();
  const results = await keywordSearch(db, parseSearchParams({ q: "spreadsheets" }));
  assert.ok(results[0].snippet.toLowerCase().includes("spreadsheet"));
  assert.equal(results.some((result) => result.recordType === "contact" && result.title === "Ava Martinez"), false);
});
