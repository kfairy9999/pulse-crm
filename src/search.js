import { DomainError, PIPELINE_STAGES, optionalText } from "./shared.js";
import { all, one } from "./d1.js";
import { sourceIp } from "./auth/http.js";

export const COLLECTION = "pulse_crm";
export const DENSE_NAME = "dense";
export const SPARSE_NAME = "sparse";
export const DENSE_SIZE = 768;
export const EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBED_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent";
export const RECORD_TYPES = ["contact", "note", "deal", "task", "appointment"];
export const PAYLOAD_SCHEMA = 1;
export const SNIPPET_LIMIT = 280;
export const EXTERNAL_LIMIT = 10;
export const SESSION_LIMIT = 20;
export const REINDEX_LIMIT = 4;
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const REINDEX_WINDOW_MS = 60 * 60 * 1000;
export const REINDEX_BATCH = 20;
const EMBED_CAP = 24;
const RATE_KEY = "search_rate_v1";
const POINT_NAMESPACE = "c2b0e7a4-5d31-4f8a-9c6e-1a2b3c4d5e6f";
const STOP = new Set(
  "a an and are as at be but by for from if in into is it of on or that the to with this was were".split(
    " ",
  ),
);

export const LABELS = {
  keyword:
    "Keyword search. Qdrant is not configured, so these matches are text in this workspace, not semantic or vector results.",
  degraded:
    "Keyword search. Hybrid search is configured, but Gemini or Qdrant did not answer, so these are text matches only. They are not model results.",
  hybrid:
    "Hybrid search. Dense vectors are Gemini gemini-embedding-2 at 768 dimensions. Keyword vectors are hashed term weights from this Worker. Qdrant combines them with reciprocal rank fusion.",
  hybridDenseOnly:
    "Hybrid search is configured. This query had no keyword terms, so only the Gemini gemini-embedding-2 dense vector was used.",
};

const readyCollections = new Map();
export function resetSearchState() {
  readyCollections.clear();
}

const uuidBytes = (value) => {
  const hex = value.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};
const bytesToUuid = (bytes) => {
  const hex = [...bytes].map((part) => part.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export async function pointId(type, recordId) {
  const name = new TextEncoder().encode(`${type}:${recordId}`);
  const prefix = uuidBytes(POINT_NAMESPACE);
  const data = new Uint8Array(prefix.length + name.length);
  data.set(prefix, 0);
  data.set(name, prefix.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return bytesToUuid(digest);
}

export function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP.has(token));
}

function fnv(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sparseVector(text, limit = 48) {
  const counts = new Map();
  for (const token of tokens(text)) counts.set(token, (counts.get(token) || 0) + 1);
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit);
  const byIndex = new Map();
  for (const [token, count] of ranked) {
    const index = fnv(token);
    byIndex.set(index, (byIndex.get(index) || 0) + (1 + Math.log(count)));
  }
  const indices = [...byIndex.keys()].sort((a, b) => a - b);
  return { indices, values: indices.map((index) => byIndex.get(index)) };
}

function storedSparse(text) {
  const sparse = sparseVector(text);
  if (sparse.indices.length) return sparse;
  return { indices: [0], values: [0.0001] };
}

function secret(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length ? text : null;
}

export function qdrantOrigin(value) {
  const text = secret(value);
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" && local) return url.origin;
  if (url.protocol !== "https:") return null;
  return url.origin;
}

export function searchConfig(env = {}) {
  const qdrantUrl = qdrantOrigin(env.QDRANT_URL);
  const qdrantKey = secret(env.QDRANT_API_KEY);
  const geminiKey = secret(env.GEMINI_API_KEY);
  const apiToken = secret(env.SEARCH_API_TOKEN);
  const tokenReady = Boolean(apiToken && apiToken.length >= 32);
  return {
    qdrantUrl,
    qdrantKey,
    geminiKey,
    apiToken: tokenReady ? apiToken : null,
    hybrid: Boolean(qdrantUrl && qdrantKey && geminiKey),
  };
}

export function searchStatus(env) {
  const config = searchConfig(env);
  return {
    mode: config.hybrid ? "hybrid" : "keyword",
    label: config.hybrid ? LABELS.hybrid : LABELS.keyword,
    embeddingModel: config.hybrid ? EMBEDDING_MODEL : null,
    collection: config.hybrid ? COLLECTION : null,
    payloadSchema: PAYLOAD_SCHEMA,
    externalApiConfigured: Boolean(config.apiToken),
  };
}

const snippet = (text) => {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= SNIPPET_LIMIT) return clean;
  return `${clean.slice(0, SNIPPET_LIMIT - 1)}…`;
};

const noon = (day) => (day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T12:00:00.000Z` : day || null);

function basePayload(doc) {
  return {
    schemaVersion: PAYLOAD_SCHEMA,
    recordType: doc.recordType,
    recordId: doc.recordId,
    contactId: doc.contactId,
    dealId: doc.dealId,
    stage: doc.stage,
    title: doc.title,
    snippet: doc.snippet,
    date: doc.date,
    updatedAt: doc.updatedAt,
  };
}

export function contactDocument(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || "Contact";
  let tags = [];
  try {
    tags = JSON.parse(row.tags || "[]");
  } catch {
    tags = [];
  }
  const text = [
    "Contact",
    `Name: ${name}`,
    row.company && `Company: ${row.company}`,
    row.job_title && `Job title: ${row.job_title}`,
    row.email && `Email: ${row.email}`,
    row.phone && `Phone: ${row.phone}`,
    tags.length ? `Tags: ${tags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    recordType: "contact",
    recordId: row.id,
    contactId: row.id,
    dealId: null,
    stage: null,
    title: name,
    snippet: snippet([name, row.company, row.job_title].filter(Boolean).join(" · ")),
    date: row.updated_at,
    updatedAt: row.updated_at,
    text,
  };
}

export function noteDocument(row) {
  const name = row.contact_name || "Contact";
  return {
    recordType: "note",
    recordId: row.id,
    contactId: row.contact_id,
    dealId: null,
    stage: null,
    title: `Note · ${name}`,
    snippet: snippet(row.body),
    date: row.created_at,
    updatedAt: row.created_at,
    text: [`Note about ${name}`, row.company ? `Company: ${row.company}` : "", row.body].filter(Boolean).join("\n"),
  };
}

export function dealDocument(row) {
  const name = row.contact_name || "Contact";
  const dollars = Number(row.value_cents || 0) / 100;
  return {
    recordType: "deal",
    recordId: row.id,
    contactId: row.contact_id,
    dealId: row.id,
    stage: row.stage,
    title: row.title,
    snippet: snippet([row.title, row.stage, name, row.notes].filter(Boolean).join(" · ")),
    date: row.updated_at,
    updatedAt: row.updated_at,
    text: [
      "Deal",
      `Title: ${row.title}`,
      `Stage: ${row.stage}`,
      `Contact: ${name}`,
      row.company && `Company: ${row.company}`,
      `Value USD: ${dollars}`,
      row.expected_close_date && `Expected close: ${row.expected_close_date}`,
      row.notes && `Notes: ${row.notes}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function taskDocument(row) {
  const due = noon(row.due_date);
  return {
    recordType: "task",
    recordId: row.id,
    contactId: row.contact_id || null,
    dealId: null,
    stage: null,
    title: row.title,
    snippet: snippet([row.title, row.status, row.notes].filter(Boolean).join(" · ")),
    date: due || row.updated_at,
    updatedAt: row.updated_at,
    text: [
      "Task",
      `Title: ${row.title}`,
      `Status: ${row.status}`,
      `Priority: ${row.priority}`,
      row.contact_name && `Contact: ${row.contact_name}`,
      row.due_date && `Due: ${row.due_date}`,
      row.notes && `Notes: ${row.notes}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function appointmentDocument(row) {
  return {
    recordType: "appointment",
    recordId: row.id,
    contactId: row.contact_id || null,
    dealId: null,
    stage: null,
    title: row.title,
    snippet: snippet([row.title, row.location, row.notes].filter(Boolean).join(" · ")),
    date: row.starts_at,
    updatedAt: row.updated_at,
    text: [
      "Appointment",
      `Title: ${row.title}`,
      row.contact_name && `Contact: ${row.contact_name}`,
      `Starts: ${row.starts_at}`,
      row.location && `Location: ${row.location}`,
      row.notes && `Notes: ${row.notes}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function boundDate(value, end) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new DomainError("Dates must be YYYY-MM-DD or an ISO timestamp.");
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return end ? `${text}T23:59:59.999Z` : `${text}T00:00:00.000Z`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new DomainError("Dates must be YYYY-MM-DD or an ISO timestamp.");
  return parsed.toISOString();
}

function optionalId(value, field) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value.trim())) throw new DomainError(`${field} must be a record id.`);
  return value.trim().toLowerCase();
}

export function parseSearchParams(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const q = optionalText(source.q, "Search", 300);
  if (!q) throw new DomainError("Enter a search.");
  const type = source.type == null || source.type === "" ? null : String(source.type);
  if (type && !RECORD_TYPES.includes(type)) throw new DomainError("Type must be contact, note, deal, task, or appointment.");
  const stage = source.stage == null || source.stage === "" ? null : String(source.stage);
  if (stage && !PIPELINE_STAGES.includes(stage)) throw new DomainError("Stage is not one of the pipeline stages.");
  const from = boundDate(source.from, false);
  const to = boundDate(source.to, true);
  if (from && to && from > to) throw new DomainError("The start of the date range is after the end.");
  let limit = source.limit == null || source.limit === "" ? 12 : Number(source.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new DomainError("Limit must be a whole number from 1 to 20.");
  return {
    q,
    type,
    contactId: optionalId(source.contactId, "Contact"),
    dealId: optionalId(source.dealId, "Deal"),
    stage,
    from,
    to,
    limit,
  };
}

export function buildFilter(filters) {
  const must = [];
  if (filters.type) must.push({ key: "recordType", match: { value: filters.type } });
  if (filters.contactId) must.push({ key: "contactId", match: { value: filters.contactId } });
  if (filters.dealId) must.push({ key: "dealId", match: { value: filters.dealId } });
  if (filters.stage) must.push({ key: "stage", match: { value: filters.stage } });
  if (filters.from || filters.to) {
    const range = {};
    if (filters.from) range.gte = filters.from;
    if (filters.to) range.lte = filters.to;
    must.push({ key: "date", range });
  }
  return must.length ? { must } : undefined;
}

export function payloadMatches(payload, filters) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.schemaVersion !== PAYLOAD_SCHEMA) return false;
  if (!RECORD_TYPES.includes(payload.recordType)) return false;
  if (filters.type && payload.recordType !== filters.type) return false;
  if (filters.contactId && payload.contactId !== filters.contactId) return false;
  if (filters.dealId && payload.dealId !== filters.dealId) return false;
  if (filters.stage && payload.stage !== filters.stage) return false;
  if ((filters.from || filters.to) && (typeof payload.date !== "string" || !payload.date)) return false;
  if (filters.from && payload.date < filters.from) return false;
  if (filters.to && payload.date > filters.to) return false;
  return true;
}

export function hybridRequest(filters, dense, sparse) {
  const filter = buildFilter(filters);
  const fields = ["schemaVersion", "recordType", "recordId", "contactId", "dealId", "stage", "title", "snippet", "date", "updatedAt"];
  if (!sparse.indices.length) {
    return { query: dense, using: DENSE_NAME, filter, limit: filters.limit, with_payload: fields };
  }
  const prefetchLimit = Math.min(40, Math.max(filters.limit * 3, 15));
  const prefetch = (query, using) => ({ query, using, limit: prefetchLimit, ...(filter ? { filter } : {}) });
  return {
    prefetch: [
      prefetch(sparse, SPARSE_NAME),
      prefetch(dense, DENSE_NAME),
    ],
    query: { fusion: "rrf" },
    ...(filter ? { filter } : {}),
    limit: filters.limit,
    with_payload: fields,
  };
}

export function embedRequestBody(text, task) {
  return {
    content: { parts: [{ text: String(text || "").slice(0, 6000) }] },
    task_type: task,
    output_dimensionality: DENSE_SIZE,
  };
}

function keywordScore(doc, terms) {
  const hay = `${doc.title}\n${doc.text}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!hay.includes(term)) return 0;
    score += hay.split(term).length - 1;
    if (doc.title.toLowerCase().includes(term)) score += 2;
  }
  return score;
}

async function rowsFor(db, type, filters) {
  const contact = filters.contactId;
  if (type === "contact") {
    return all(
      db,
      `SELECT * FROM contacts WHERE (? IS NULL OR id=?) ORDER BY updated_at DESC LIMIT 500`,
      contact,
      contact,
    );
  }
  if (type === "note") {
    return all(
      db,
      `SELECT n.*, TRIM(c.first_name||' '||c.last_name) AS contact_name, c.company
       FROM contact_notes n JOIN contacts c ON c.id=n.contact_id
       WHERE (? IS NULL OR n.contact_id=?) ORDER BY n.created_at DESC LIMIT 500`,
      contact,
      contact,
    );
  }
  if (type === "deal") {
    return all(
      db,
      `SELECT o.*, TRIM(c.first_name||' '||c.last_name) AS contact_name, c.company
       FROM opportunities o JOIN contacts c ON c.id=o.contact_id
       WHERE (? IS NULL OR o.contact_id=?) AND (? IS NULL OR o.id=?) AND (? IS NULL OR o.stage=?)
       ORDER BY o.updated_at DESC LIMIT 500`,
      contact,
      contact,
      filters.dealId,
      filters.dealId,
      filters.stage,
      filters.stage,
    );
  }
  if (type === "task") {
    return all(
      db,
      `SELECT t.*, TRIM(c.first_name||' '||c.last_name) AS contact_name
       FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id
       WHERE (? IS NULL OR t.contact_id=?) ORDER BY t.updated_at DESC LIMIT 500`,
      contact,
      contact,
    );
  }
  return all(
    db,
    `SELECT a.*, TRIM(c.first_name||' '||c.last_name) AS contact_name
     FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id
     WHERE (? IS NULL OR a.contact_id=?) ORDER BY a.starts_at DESC LIMIT 500`,
    contact,
    contact,
  );
}

const builders = {
  contact: contactDocument,
  note: noteDocument,
  deal: dealDocument,
  task: taskDocument,
  appointment: appointmentDocument,
};

export async function keywordSearch(db, filters) {
  const terms = [...new Set(tokens(filters.q))].slice(0, 8);
  const types = filters.type ? [filters.type] : RECORD_TYPES;
  const ranked = [];
  for (const type of types) {
    if (filters.dealId && type !== "deal") continue;
    if (filters.stage && type !== "deal") continue;
    const rows = await rowsFor(db, type, filters);
    for (const row of rows) {
      const doc = builders[type](row);
      if (!payloadMatches(basePayload(doc), filters)) continue;
      const score = keywordScore(doc, terms);
      if (score > 0) ranked.push({ doc, score });
    }
  }
  ranked.sort((a, b) => b.score - a.score || String(b.doc.date).localeCompare(String(a.doc.date)));
  return ranked.slice(0, filters.limit).map(({ doc, score }) => publicResult(doc, score));
}

function publicResult(doc, score) {
  return {
    recordType: doc.recordType,
    recordId: doc.recordId,
    contactId: doc.contactId,
    dealId: doc.dealId,
    stage: doc.stage,
    title: doc.title,
    snippet: doc.snippet,
    date: doc.date,
    score,
  };
}

export async function loadDocument(db, type, recordId) {
  if (!builders[type]) return null;
  if (type === "contact") {
    const direct = await one(db, "SELECT * FROM contacts WHERE id=?", recordId);
    return direct ? contactDocument(direct) : null;
  }
  if (type === "note") {
    const direct = await one(
      db,
      `SELECT n.*, TRIM(c.first_name||' '||c.last_name) AS contact_name, c.company
       FROM contact_notes n JOIN contacts c ON c.id=n.contact_id WHERE n.id=?`,
      recordId,
    );
    return direct ? noteDocument(direct) : null;
  }
  if (type === "deal") {
    const direct = await one(
      db,
      `SELECT o.*, TRIM(c.first_name||' '||c.last_name) AS contact_name, c.company
       FROM opportunities o JOIN contacts c ON c.id=o.contact_id WHERE o.id=?`,
      recordId,
    );
    return direct ? dealDocument(direct) : null;
  }
  if (type === "task") {
    const direct = await one(
      db,
      `SELECT t.*, TRIM(c.first_name||' '||c.last_name) AS contact_name
       FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.id=?`,
      recordId,
    );
    return direct ? taskDocument(direct) : null;
  }
  const direct = await one(
    db,
    `SELECT a.*, TRIM(c.first_name||' '||c.last_name) AS contact_name
     FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.id=?`,
    recordId,
  );
  return direct ? appointmentDocument(direct) : null;
}

function outbound(env) {
  return typeof env.SEARCH_FETCH === "function" ? env.SEARCH_FETCH : fetch;
}

async function callJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(8000), ...options });
  if (response.status >= 300 && response.status < 400) {
    const error = new Error("redirect");
    error.code = "search_redirect";
    throw error;
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { ok: response.ok, status: response.status, body };
}

async function embedText(config, fetchImpl, text, task) {
  const result = await callJson(fetchImpl, EMBED_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": config.geminiKey },
    body: JSON.stringify(embedRequestBody(text, task)),
  });
  const values = result.body?.embedding?.values;
  if (!result.ok || !Array.isArray(values) || values.length !== DENSE_SIZE || values.some((value) => typeof value !== "number")) {
    const error = new Error("embed");
    error.code = "embed_failed";
    throw error;
  }
  return values;
}

async function ensureCollection(config, fetchImpl) {
  if (readyCollections.has(config.qdrantUrl)) return readyCollections.get(config.qdrantUrl);
  const pending = createCollection(config, fetchImpl).catch((error) => {
    readyCollections.delete(config.qdrantUrl);
    throw error;
  });
  readyCollections.set(config.qdrantUrl, pending);
  return pending;
}

async function createCollection(config, fetchImpl) {
  const root = `${config.qdrantUrl}/collections/${COLLECTION}`;
  const headers = { "content-type": "application/json", "api-key": config.qdrantKey };
  const existing = await callJson(fetchImpl, root, { method: "GET", headers });
  if (existing.status === 404) {
    const created = await callJson(fetchImpl, root, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        vectors: { [DENSE_NAME]: { size: DENSE_SIZE, distance: "Cosine" } },
        sparse_vectors: { [SPARSE_NAME]: { modifier: "idf" } },
      }),
    });
    if (!created.ok) {
      const error = new Error("collection");
      error.code = "collection_failed";
      throw error;
    }
  } else if (!existing.ok) {
    const error = new Error("collection");
    error.code = "collection_failed";
    throw error;
  } else {
    const size = existing.body?.result?.config?.params?.vectors?.[DENSE_NAME]?.size;
    if (size && size !== DENSE_SIZE) {
      const error = new Error("collection");
      error.code = "collection_mismatch";
      throw error;
    }
  }
  for (const [field, schema] of [
    ["recordType", "keyword"],
    ["contactId", "keyword"],
    ["dealId", "keyword"],
    ["stage", "keyword"],
    ["date", "datetime"],
  ]) {
    const indexed = await callJson(fetchImpl, `${root}/index`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ field_name: field, field_schema: schema }),
    });
    if (!indexed.ok && indexed.status !== 400 && indexed.status !== 409) {
      const error = new Error("index");
      error.code = "payload_index_failed";
      throw error;
    }
  }
}

async function upsertPoints(config, fetchImpl, points) {
  const result = await callJson(fetchImpl, `${config.qdrantUrl}/collections/${COLLECTION}/points?wait=true`, {
    method: "PUT",
    headers: { "content-type": "application/json", "api-key": config.qdrantKey },
    body: JSON.stringify({ points }),
  });
  if (!result.ok) {
    const error = new Error("upsert");
    error.code = "upsert_failed";
    throw error;
  }
}

async function deletePoints(config, fetchImpl, ids, filter) {
  const result = await callJson(fetchImpl, `${config.qdrantUrl}/collections/${COLLECTION}/points/delete?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json", "api-key": config.qdrantKey },
    body: JSON.stringify(ids?.length ? { points: ids } : { filter }),
  });
  if (!result.ok) {
    const error = new Error("delete");
    error.code = "delete_failed";
    throw error;
  }
}

async function documentsFor(db, refs) {
  const docs = [];
  for (const ref of refs) {
    const doc = await loadDocument(db, ref.type, ref.id);
    if (doc) docs.push(doc);
  }
  return docs;
}

async function pointsFor(config, fetchImpl, docs, task) {
  const points = [];
  for (const doc of docs.slice(0, EMBED_CAP)) {
    const dense = await embedText(config, fetchImpl, doc.text, task);
    points.push({
      id: await pointId(doc.recordType, doc.recordId),
      vector: { [DENSE_NAME]: dense, [SPARSE_NAME]: storedSparse(doc.text) },
      payload: basePayload(doc),
    });
  }
  return points;
}

export async function syncSearchIndex(env, db, change = {}) {
  const config = searchConfig(env);
  if (!config.hybrid) return { indexed: false, reason: "not_configured" };
  const fetchImpl = outbound(env);
  try {
    await ensureCollection(config, fetchImpl);
    if (change.removeContactId) {
      await deletePoints(config, fetchImpl, null, {
        must: [{ key: "contactId", match: { value: change.removeContactId } }],
      });
    }
    if (change.remove?.length) {
      const ids = await Promise.all(change.remove.map((item) => pointId(item.type, item.id)));
      await deletePoints(config, fetchImpl, ids);
    }
    const refs = [...(change.upsert || [])];
    if (change.upsertContactNotes) {
      const notes = await all(db, "SELECT id FROM contact_notes WHERE contact_id=? ORDER BY created_at DESC LIMIT 20", change.upsertContactNotes);
      for (const note of notes) refs.push({ type: "note", id: note.id });
    }
    const points = await pointsFor(config, fetchImpl, await documentsFor(db, refs), "RETRIEVAL_DOCUMENT");
    if (points.length) await upsertPoints(config, fetchImpl, points);
    return { indexed: true, count: points.length };
  } catch {
    console.error(JSON.stringify({ event: "pulse-search-index", ok: false }));
    return { indexed: false, reason: "index_failed" };
  }
}

async function listRefs(db) {
  const refs = [];
  for (const [type, sql] of [
    ["contact", "SELECT id FROM contacts ORDER BY created_at, id LIMIT 400"],
    ["note", "SELECT id FROM contact_notes ORDER BY created_at, id LIMIT 400"],
    ["deal", "SELECT id FROM opportunities ORDER BY created_at, id LIMIT 400"],
    ["task", "SELECT id FROM tasks ORDER BY created_at, id LIMIT 400"],
    ["appointment", "SELECT id FROM appointments ORDER BY created_at, id LIMIT 400"],
  ]) {
    for (const row of await all(db, sql)) refs.push({ type, id: row.id });
  }
  return refs;
}

export async function reindexSearch(env, db, offset = 0) {
  const config = searchConfig(env);
  if (!config.hybrid) {
    return { indexed: false, mode: "keyword", label: LABELS.keyword, count: 0, total: 0, nextOffset: null };
  }
  const refs = await listRefs(db);
  const slice = refs.slice(offset, offset + REINDEX_BATCH);
  const result = await syncSearchIndex(env, db, { upsert: slice });
  const next = offset + slice.length;
  return {
    indexed: result.indexed,
    mode: result.indexed ? "hybrid" : "keyword",
    label: result.indexed ? LABELS.hybrid : LABELS.degraded,
    count: result.count || 0,
    total: refs.length,
    nextOffset: result.indexed && next < refs.length ? next : null,
    embeddingModel: EMBEDDING_MODEL,
    collection: COLLECTION,
  };
}

async function hybridSearch(env, db, filters) {
  const config = searchConfig(env);
  const fetchImpl = outbound(env);
  await ensureCollection(config, fetchImpl);
  const sparse = sparseVector(filters.q);
  const dense = await embedText(config, fetchImpl, filters.q, "RETRIEVAL_QUERY");
  const body = hybridRequest(filters, dense, sparse);
  const result = await callJson(fetchImpl, `${config.qdrantUrl}/collections/${COLLECTION}/points/query`, {
    method: "POST",
    headers: { "content-type": "application/json", "api-key": config.qdrantKey },
    body: JSON.stringify(body),
  });
  const points = Array.isArray(result.body?.result) ? result.body.result : result.body?.result?.points;
  if (!result.ok || !Array.isArray(points)) {
    const error = new Error("query");
    error.code = "query_failed";
    throw error;
  }
  const results = [];
  for (const point of points) {
    if (!payloadMatches(point.payload, filters)) continue;
    results.push(publicResult(point.payload, typeof point.score === "number" ? point.score : null));
    if (results.length >= filters.limit) break;
  }
  return {
    mode: "hybrid",
    label: sparse.indices.length ? LABELS.hybrid : LABELS.hybridDenseOnly,
    embeddingModel: EMBEDDING_MODEL,
    collection: COLLECTION,
    fusion: sparse.indices.length ? "rrf" : null,
    results,
  };
}

function described(filters, extra) {
  return {
    ...extra,
    filters: {
      q: filters.q,
      type: filters.type,
      contactId: filters.contactId,
      dealId: filters.dealId,
      stage: filters.stage,
      from: filters.from,
      to: filters.to,
    },
  };
}

async function sha256(text) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export async function tokensEqual(provided, expected) {
  if (!provided || !expected) return false;
  const [left, right] = await Promise.all([sha256(String(provided)), sha256(String(expected))]);
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length || !crypto.subtle.timingSafeEqual) {
    let diff = a.length ^ b.length;
    const size = Math.max(a.length, b.length);
    for (let i = 0; i < size; i++) diff |= (a[i] || 0) ^ (b[i] || 0);
    return diff === 0;
  }
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function consumeRateLimit(db, bucketIds, limit, windowMs, nowMs = Date.now()) {
  const row = await one(db, "SELECT value FROM app_metadata WHERE key=?", RATE_KEY);
  let state = { buckets: {} };
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (parsed && typeof parsed.buckets === "object" && parsed.buckets) state = parsed;
    } catch {
      state = { buckets: {} };
    }
  }
  const fresh = {};
  for (const [key, value] of Object.entries(state.buckets || {})) {
    if (value && Number.isFinite(value.until) && value.until > nowMs) fresh[key] = value;
  }
  for (const id of bucketIds) {
    const current = fresh[id];
    if (current && current.count >= limit) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((current.until - nowMs) / 1000)) };
    }
  }
  for (const id of bucketIds) {
    const current = fresh[id];
    if (!current) fresh[id] = { start: nowMs, until: nowMs + windowMs, count: 1 };
    else current.count += 1;
  }
  const entries = Object.entries(fresh).slice(-40);
  await db
    .prepare(
      "INSERT INTO app_metadata(key,value,created_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .bind(RATE_KEY, JSON.stringify({ buckets: Object.fromEntries(entries) }), new Date(nowMs).toISOString())
    .run();
  return { ok: true };
}

function limitedResponse(retryAfter) {
  return jsonResponse(
    { error: "Search is temporarily limited. Try again shortly." },
    429,
    { "Retry-After": String(retryAfter) },
  );
}

function jsonResponse(value, status = 200, headers) {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "private, no-store");
  return new Response(JSON.stringify(value), { status, headers: h });
}

async function gate(env, db, kind, actor) {
  const config = searchConfig(env);
  const expensive = kind === "external" || (config.hybrid && (kind === "reindex" || kind === "session"));
  if (!expensive) return null;
  const limit = kind === "external" ? EXTERNAL_LIMIT : kind === "reindex" ? REINDEX_LIMIT : SESSION_LIMIT;
  const windowMs = kind === "reindex" ? REINDEX_WINDOW_MS : RATE_WINDOW_MS;
  const buckets =
    kind === "external"
      ? [await sha256(`ext-ip:${actor.ip}`), await sha256(`ext-token:${actor.tokenHash}`)]
      : [await sha256(`${kind}:${actor.id || "owner"}`)];
  const decision = await consumeRateLimit(db, buckets, limit, windowMs);
  if (!decision.ok) return limitedResponse(decision.retryAfter);
  return null;
}

export async function executeSearch(env, db, filters) {
  const config = searchConfig(env);
  if (!config.hybrid) {
    return described(filters, {
      mode: "keyword",
      label: LABELS.keyword,
      embeddingModel: null,
      collection: null,
      fusion: null,
      results: await keywordSearch(db, filters),
    });
  }
  try {
    const hybrid = await hybridSearch(env, db, filters);
    return described(filters, hybrid);
  } catch {
    console.error(JSON.stringify({ event: "pulse-search-query", ok: false }));
    return described(filters, {
      mode: "keyword",
      label: LABELS.degraded,
      embeddingModel: null,
      collection: null,
      fusion: null,
      degraded: true,
      results: await keywordSearch(db, filters),
    });
  }
}

export async function handleSessionSearch(env, db, url, actor) {
  const filters = parseSearchParams(Object.fromEntries(url.searchParams.entries()));
  const blocked = await gate(env, db, "session", { id: actor || "owner" });
  if (blocked) return blocked;
  return jsonResponse(await executeSearch(env, db, filters));
}

export async function handleReindex(env, db, body, actor) {
  const offset = body?.offset == null || body.offset === "" ? 0 : Number(body.offset);
  if (!Number.isInteger(offset) || offset < 0 || offset > 2000) throw new DomainError("Offset must be a whole number from 0 to 2000.");
  const blocked = await gate(env, db, "reindex", { id: actor || "owner" });
  if (blocked) return blocked;
  return jsonResponse(await reindexSearch(env, db, offset));
}

export async function handleExternalSearch(request, env, body) {
  const config = searchConfig(env);
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  const provided = match?.[1] || "";
  if (!(await tokensEqual(provided, config.apiToken))) {
    return jsonResponse({ error: "The search API token is missing or incorrect." }, 401);
  }
  const filters = parseSearchParams(body || {});
  const ip = sourceIp(request, env);
  const blocked = await gate(env, dbFrom(env), "external", { ip, tokenHash: await sha256(config.apiToken) });
  if (blocked) return blocked;
  return jsonResponse(await executeSearch(env, dbFrom(env), filters));
}

function dbFrom(env) {
  if (!env.DB) throw new DomainError("D1 is not bound to this Worker.", 503);
  return env.DB;
}
