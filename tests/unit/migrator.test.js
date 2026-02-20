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
  });

  describe("rollbackMigration", () => {
    it("rolls back last applied migration", () => {
      runMigrations(db);
      const result = rollbackMigration(db);
      expect(result).not.toBeNull();
      expect(result.version).toBe(1);
    });

    it("returns null when no migrations to roll back", () => {
      const result = rollbackMigration(db);
      expect(result).toBeNull();
    });

    it("removes record from schema_migrations on rollback", () => {
      runMigrations(db);
      rollbackMigration(db);
      const remaining = db.prepare("SELECT * FROM schema_migrations").all();
      expect(remaining).toHaveLength(0);
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
