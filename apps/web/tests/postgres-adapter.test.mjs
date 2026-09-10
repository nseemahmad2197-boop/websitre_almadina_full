import assert from "node:assert/strict";
import test from "node:test";

const { PostgresD1Database, getRenderDatabase, toPostgresSql } = await import(
  new URL("../app/lib/postgres-d1-adapter.ts", import.meta.url)
);

class FakePostgresClient {
  constructor(log, failOn = "") {
    this.log = log;
    this.failOn = failOn;
  }

  async query(sql, values = []) {
    this.log.push({ sql, values });
    if (this.failOn && sql.includes(this.failOn)) throw new Error("Synthetic PostgreSQL failure");
    if (sql.startsWith("SELECT")) return { rows: [{ id: "main", revision: 2 }], rowCount: 1 };
    return { rows: [], rowCount: sql.startsWith("UPDATE") ? 1 : 0 };
  }

  release() {
    this.log.push({ sql: "RELEASE", values: [] });
  }
}

class FakePostgresPool extends FakePostgresClient {
  constructor({ failOn = "" } = {}) {
    const log = [];
    super(log, failOn);
  }

  async connect() {
    return new FakePostgresClient(this.log, this.failOn);
  }

  async end() {}
}

test("converts D1 placeholders without changing quoted question marks", () => {
  assert.equal(
    toPostgresSql("SELECT '?' AS literal, id = ? AND name = ?"),
    "SELECT '?' AS literal, id = $1 AND name = $2",
  );
});

test("maps PostgreSQL rows and row counts to the D1 statement contract", async () => {
  const pool = new FakePostgresPool();
  const database = new PostgresD1Database(pool);

  const first = await database.prepare("SELECT id, revision FROM state WHERE id = ?").bind("main").first();
  const result = await database.prepare("UPDATE state SET revision = ? WHERE id = ?").bind(3, "main").run();

  assert.deepEqual(first, { id: "main", revision: 2 });
  assert.equal(result.success, true);
  assert.equal(result.meta.changes, 1);
  assert.deepEqual(pool.log[0], {
    sql: "SELECT id, revision FROM state WHERE id = $1",
    values: ["main"],
  });
  assert.deepEqual(pool.log[1], {
    sql: "UPDATE state SET revision = $1 WHERE id = $2",
    values: [3, "main"],
  });
});

test("commits successful D1 batches and rolls back failed batches", async () => {
  const successfulPool = new FakePostgresPool();
  const successfulDatabase = new PostgresD1Database(successfulPool);
  await successfulDatabase.batch([
    successfulDatabase.prepare("CREATE TABLE first_table (id TEXT)"),
    successfulDatabase.prepare("CREATE INDEX first_index ON first_table (id)"),
  ]);

  assert.deepEqual(successfulPool.log.map((entry) => entry.sql), [
    "BEGIN",
    "CREATE TABLE first_table (id TEXT)",
    "CREATE INDEX first_index ON first_table (id)",
    "COMMIT",
    "RELEASE",
  ]);

  const failingPool = new FakePostgresPool({ failOn: "broken_table" });
  const failingDatabase = new PostgresD1Database(failingPool);
  await assert.rejects(
    failingDatabase.batch([failingDatabase.prepare("CREATE TABLE broken_table (id TEXT)")]),
    /Synthetic PostgreSQL failure/,
  );
  assert.deepEqual(failingPool.log.map((entry) => entry.sql), [
    "BEGIN",
    "CREATE TABLE broken_table (id TEXT)",
    "ROLLBACK",
    "RELEASE",
  ]);
});

test("fails clearly when Render has no database URL without exposing credentials", () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    assert.throws(() => getRenderDatabase(), /^Error: DATABASE_URL is required/);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
