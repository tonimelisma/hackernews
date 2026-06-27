const Database = require("better-sqlite3");
const { runMigrations, rollbackMigration, getMigrationStatus, ensureMigrationsTable } = require("../../services/migrator");

describe("services/migrator", () => {
  let db;

  beforeEach(() => {
    db = new Database(":memory:");
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    db.close();
    console.log.mockRestore();
  });

  describe("ensureMigrationsTable", () => {
    it("creates schema_migrations table", () => {
      ensureMigrationsTable(db);
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      ).all();
      expect(tables).toHaveLength(1);
    });
  });

  describe("runMigrations", () => {
    it("runs pending migrations in order", () => {
      runMigrations(db);
      const applied = db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all();
      expect(applied.length).toBeGreaterThanOrEqual(1);
      expect(applied[0].version).toBe(1);
      expect(applied[0].name).toBe("001-initial-schema");
    });

    it("skips already-applied migrations", () => {
      runMigrations(db);
      const firstApplied = db.prepare("SELECT applied_at FROM schema_migrations WHERE version = 1").get();
      runMigrations(db);
      const secondApplied = db.prepare("SELECT applied_at FROM schema_migrations WHERE version = 1").get();
      expect(secondApplied.applied_at).toBe(firstApplied.applied_at);
    });

    it("creates schema_migrations table automatically", () => {
      runMigrations(db);
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      ).all();
      expect(tables).toHaveLength(1);
    });

    it("creates application tables via migration 001", () => {
      runMigrations(db);
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all().map(r => r.name);
      expect(tables).toContain("stories");
      expect(tables).toContain("users");
      expect(tables).toContain("hidden");
    });

    it("records migration with timestamp", () => {
      runMigrations(db);
      const record = db.prepare("SELECT * FROM schema_migrations WHERE version = 1").get();
      expect(record.applied_at).toBeTruthy();
      expect(new Date(record.applied_at).getTime()).not.toBeNaN();
    });

    // Regression: without query-planner statistics, the "Day" stories query
    // scans idx_stories_score across the whole table (measured ~27s worst case
    // on production). Migration 002 runs ANALYZE so sqlite_stat1 ships with the
    // schema and the planner can pick idx_stories_time for selective windows.
    it("generates query-planner statistics via migration 002 (sqlite_stat1)", () => {
      runMigrations(db);
      const statTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'"
      ).all();
      expect(statTable).toHaveLength(1);
      const applied = db.prepare("SELECT name FROM schema_migrations WHERE version = 2").get();
      expect(applied.name).toBe("002-analyze-statistics");
    });

    // Regression: with skewed data (selective recent window across many rows),
    // ANALYZE must let the planner switch the "Day" query to idx_stories_time
    // instead of a full idx_stories_score scan.
    it("lets the planner use idx_stories_time for the Day query after ANALYZE", () => {
      runMigrations(db);
      const now = Date.now();
      const ins = db.prepare(
        `INSERT INTO stories (id, score, time, updated) VALUES (?, ?, ?, ?)`
      );
      const seed = db.transaction(() => {
        // 8000 old, high-score rows + 200 recent, lower-score rows: the planner
        // should prefer filtering by time over scanning the whole score index.
        for (let i = 1; i <= 8000; i++) {
          ins.run(i, 1000 + i, now - (60 + i) * 24 * 60 * 60 * 1000, now);
        }
        for (let i = 8001; i <= 8200; i++) {
          ins.run(i, i % 500, now - 3 * 60 * 60 * 1000, now);
        }
      });
      seed();
      db.exec("ANALYZE");

      const threshold = now - 24 * 60 * 60 * 1000;
      const plan = db.prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, by, descendants, score, time, title, url FROM stories
         WHERE time > ? ORDER BY score DESC LIMIT 500`
      ).all(threshold).map(r => r.detail).join(" | ");
      expect(plan).toMatch(/idx_stories_time/);
    });
  });

  describe("rollbackMigration", () => {
    it("rolls back last applied migration", () => {
      runMigrations(db);
      const latest = db.prepare(
        "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
      ).get().version;
      const result = rollbackMigration(db);
      expect(result).not.toBeNull();
      expect(result.version).toBe(latest);
    });

    it("returns null when no migrations to roll back", () => {
      const result = rollbackMigration(db);
      expect(result).toBeNull();
    });

    it("removes record from schema_migrations on rollback", () => {
      runMigrations(db);
      const before = db.prepare("SELECT count(*) c FROM schema_migrations").get().c;
      const result = rollbackMigration(db);
      const after = db.prepare("SELECT count(*) c FROM schema_migrations").get().c;
      expect(after).toBe(before - 1);
      const rolledBack = db.prepare(
        "SELECT version FROM schema_migrations WHERE version = ?"
      ).get(result.version);
      expect(rolledBack).toBeUndefined();
    });
  });

  describe("getMigrationStatus", () => {
    it("shows applied and pending status correctly", () => {
      const statusBefore = getMigrationStatus(db);
      expect(statusBefore.length).toBeGreaterThanOrEqual(1);
      expect(statusBefore[0].status).toBe("pending");
      expect(statusBefore[0].applied_at).toBeNull();

      runMigrations(db);

      const statusAfter = getMigrationStatus(db);
      expect(statusAfter[0].status).toBe("applied");
      expect(statusAfter[0].applied_at).toBeTruthy();
    });
  });
});
