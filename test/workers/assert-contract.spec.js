import { it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { guardedWrite } from "../../src/pipeline.js";
it("SQL CHECK claim asserts stale caller rolls back before mutation", async () => {
  const db = env.DB;
  const write = (expected, key) =>
    guardedWrite(
      db,
      () => [
        db
          .prepare(
            "INSERT INTO contacts(id,first_name,created_at,updated_at) VALUES(?,'Test','now','now')",
          )
          .bind(key),
      ],
      null,
      expected,
    );
  await write(0, "one");
  await expect(write(0, "stale")).rejects.toMatchObject({ status: 409 });
  expect(
    await db.prepare("SELECT id FROM contacts WHERE id='stale'").first(),
  ).toBeNull();
  expect(
    (await db.prepare("SELECT revision FROM board_state").first()).revision,
  ).toBe(1);
  await write(1, "two");
  expect((await db.prepare("SELECT count(*) n FROM contacts").first()).n).toBe(
    2,
  );
});
it("one concurrent claimant wins and failed activity rolls back its revision and record", async () => {
  const db = env.DB;
  const make = (key, event) =>
    guardedWrite(
      db,
      () => [
        db
          .prepare(
            "INSERT INTO contacts(id,first_name,created_at,updated_at) VALUES(?,'Test','now','now')",
          )
          .bind(key),
      ],
      event,
      0,
    );
  const result = await Promise.allSettled([make("a"), make("b"), make("c")]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    result
      .filter((r) => r.status === "rejected")
      .every((r) => r.reason.status === 409),
  ).toBe(true);
  expect((await db.prepare("SELECT count(*) n FROM contacts").first()).n).toBe(
    1,
  );
  const rev = (await db.prepare("SELECT revision FROM board_state").first())
    .revision;
  await expect(
    guardedWrite(
      db,
      () => [
        db.prepare(
          "INSERT INTO contacts(id,first_name,created_at,updated_at) VALUES('rollback','Test','now','now')",
        ),
      ],
      {
        id: "bad-activity",
        kind: null,
        summary: "invalid",
        contact_id: null,
        created_at: "now",
      },
      rev,
    ),
  ).rejects.toThrow();
  expect(
    await db.prepare("SELECT id FROM contacts WHERE id='rollback'").first(),
  ).toBeNull();
  expect(
    (await db.prepare("SELECT revision FROM board_state").first()).revision,
  ).toBe(rev);
});
