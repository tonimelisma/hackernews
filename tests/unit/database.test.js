const Database = require("better-sqlite3");

describe("services/database", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  describe("getDb and setDb", () => {
    it("setDb replaces the instance and getDb returns it", () => {
      const { getDb, setDb } = require("../../services/database");
      const memDb = new Database(":memory:");
      setDb(memDb);
      expect(getDb()).toBe(memDb);
      memDb.close();
    });
  });

  describe("initSchema", () => {
    it("creates stories, users, and hidden tables", () => {
      const { setDb, initSchema } = require("../../services/database");
      const memDb = new Database(":memory:");
      setDb(memDb);
      initSchema(memDb);

      const tables = memDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all().map(r => r.name);

      expect(tables).toContain("stories");
      expect(tables).toContain("users");
      expect(tables).toContain("hidden");
      memDb.close();
    });

    it("creates required indexes", () => {
      const { setDb, initSchema } = require("../../services/database");
      const memDb = new Database(":memory:");
      setDb(memDb);
      initSchema(memDb);

      const indexes = memDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
      ).all().map(r => r.name);

      expect(indexes).toContain("idx_stories_score");
      expect(indexes).toContain("idx_stories_time");
      expect(indexes).toContain("idx_stories_time_updated");
      expect(indexes).toContain("idx_hidden_username");
      memDb.close();
    });

    it("is idempotent (can run twice)", () => {
      const { setDb, initSchema } = require("../../services/database");
      const memDb = new Database(":memory:");
      setDb(memDb);
      initSchema(memDb);
      initSchema(memDb); // should not throw
      memDb.close();
    });
  });
});
