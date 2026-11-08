import { DomainError } from "./shared.js";
import { statement } from "./d1.js";

export const pipelineConflict = () =>
  new DomainError(
    "A concurrent pipeline change was detected. Please retry the change.",
    409,
  );
export async function readBoard(db) {
  const [state, board] = await db.batch([
    statement(db, "SELECT revision FROM board_state WHERE id=1"),
    statement(db, "SELECT * FROM opportunities"),
  ]);
  const rows = board.results;
  rows.revision = state.results[0]?.revision;
  return rows;
}

function positions(rows, stage) {
  return rows
    .filter((row) => row.stage === stage)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
}
export const createOpportunityStatement = (db, fields) =>
  statement(
    db,
    `INSERT INTO opportunities(${Object.keys(fields).join(",")}) VALUES(${Object.keys(
      fields,
    )
      .map(() => "?")
      .join(",")})`,
    ...Object.values(fields),
  );

function reorderStatement(db, ordered, timestamp) {
  // One statement regardless of board size avoids D1's per-request query ceiling.
  return statement(
    db,
    `WITH ordering AS (
    SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.stage') AS stage,
      json_extract(value,'$.position') AS position FROM json_each(?)
  ) UPDATE opportunities SET stage=(SELECT stage FROM ordering WHERE ordering.id=opportunities.id),
    position=(SELECT position FROM ordering WHERE ordering.id=opportunities.id),updated_at=?
    WHERE id IN(SELECT id FROM ordering)`,
    JSON.stringify(ordered),
    timestamp,
  );
}
export function updateOpportunityStatements(
  db,
  rows,
  previous,
  input,
  requestedPosition,
) {
  const timestamp = new Date().toISOString();
  const source = positions(rows, previous.stage).filter(
    (row) => row.id !== previous.id,
  );
  const target =
    input.stage === previous.stage ? [...source] : positions(rows, input.stage);
  target.splice(
    Math.max(0, Math.min(requestedPosition ?? target.length, target.length)),
    0,
    { ...previous, stage: input.stage },
  );
  const ordered = [
    ...(input.stage === previous.stage
      ? []
      : source.map((r, position) => ({
          id: r.id,
          stage: previous.stage,
          position,
        }))),
    ...target.map((r, position) => ({
      id: r.id,
      stage: input.stage,
      position,
    })),
  ];
  return [
    statement(
      db,
      "UPDATE opportunities SET title=?,contact_id=?,value_cents=?,expected_close_date=?,notes=?,updated_at=? WHERE id=?",
      input.title,
      input.contact_id,
      input.value_cents,
      input.expected_close_date,
      input.notes,
      timestamp,
      previous.id,
    ),
    reorderStatement(db, ordered, timestamp),
  ];
}
export function deleteOpportunityStatements(db, rows, previous) {
  const ordered = positions(rows, previous.stage)
    .filter((r) => r.id !== previous.id)
    .map((r, position) => ({ id: r.id, stage: previous.stage, position }));
  return [
    statement(db, "DELETE FROM opportunities WHERE id=?", previous.id),
    reorderStatement(db, ordered, new Date().toISOString()),
  ];
}
export const deleteContactStatements = (db, contactId) => [
  statement(
    db,
    "DELETE FROM contacts WHERE id=? AND NOT EXISTS(SELECT 1 FROM opportunities WHERE contact_id=?)",
    contactId,
    contactId,
  ),
];
const activityQuery = (db, event) =>
  statement(
    db,
    "INSERT INTO activities(id,kind,summary,contact_id,created_at) VALUES(?,?,?,?,?)",
    event.id,
    event.kind,
    event.summary,
    event.contact_id,
    event.created_at,
  );

export async function guardedWrite(
  db,
  makeStatements,
  event,
  expectedRevision,
) {
  const expected = expectedRevision;
  if (!Number.isSafeInteger(expected) || expected < 0)
    throw new DomainError("Pipeline migration is not ready.", 503);
  const claim = crypto.randomUUID();
  const queries = [
    statement(
      db,
      "UPDATE board_state SET revision=revision+1,claim=?,updated_at=? WHERE id=1 AND revision=?",
      claim,
      new Date().toISOString(),
      expected,
    ),
    // Check inside SQL, before mutations: stale claims violate CHECK and roll back D1 batch.
    statement(
      db,
      "INSERT INTO pipeline_assertion(id,ok) VALUES(1,(SELECT CASE WHEN claim=? THEN 1 ELSE 0 END FROM board_state WHERE id=1))",
      claim,
    ),
    statement(db, "DELETE FROM pipeline_assertion WHERE id=1"),
    ...makeStatements(),
    ...(event ? [activityQuery(db, event)] : []),
  ];
  try {
    return await db.batch(queries);
  } catch (error) {
    if (
      /CHECK constraint failed.*ok|NOT NULL constraint failed: pipeline_assertion.ok/i.test(
        String(error.message),
      )
    )
      throw pipelineConflict();
    throw error;
  }
}
