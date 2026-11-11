// A small D1-compatible wrapper over sql.js, so the demo runs the Worker's own CRM handlers
// in the browser. Only the calls Pulse uses are implemented: prepare/bind/first/all/run/raw,
// batch (one transaction), and withSession.
const clean = (value) => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value);

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }
  rows() {
    const statement = this.db.prepare(this.sql);
    try {
      statement.bind(this.params.map(clean));
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  result() {
    const results = this.rows();
    return { success: true, results, meta: { changes: this.db.getRowsModified() } };
  }
  async first(column) {
    const row = this.rows()[0] ?? null;
    return column ? (row ? row[column] : null) : row;
  }
  async all() {
    return this.result();
  }
  async run() {
    return this.result();
  }
  async raw() {
    return this.rows().map((row) => Object.values(row));
  }
}

export class D1Shim {
  constructor(db) {
    this.db = db;
    db.run("PRAGMA foreign_keys = ON");
  }
  prepare(sql) {
    return new Statement(this.db, sql);
  }
  withSession() {
    return this;
  }
  async batch(statements) {
    this.db.run("BEGIN");
    try {
      const results = statements.map((statement) => statement.result());
      this.db.run("COMMIT");
      return results;
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }
  async exec(sql) {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }
}
