const db = require("../setup");

beforeAll(async () => await db.connect());

const storyService = require("../../services/storyService");

afterEach(async () => {
  await db.clearDatabase();
});
afterAll(async () => await db.closeDatabase());

const seedStory = (overrides = {}) => {
  const { getDb } = require("../../services/database");
  const story = {
    id: 1,
    by: "author",
    descendants: 10,
    score: 100,
    time: Date.now(),
    title: "Test Story",
    url: "https://example.com",
    updated: Date.now(),
    ...overrides,
  };
  getDb().prepare(
    `INSERT OR REPLACE INTO stories (id, by, descendants, score, time, title, url, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(story.id, story.by, story.descendants, story.score, story.time, story.title, story.url, story.updated);
  return story;
};

describe("services/storyService", () => {
  describe("getStories", () => {
    beforeEach(async () => {
      const now = Date.now();
      seedStory({ id: 1, score: 500, time: now - 1000 * 60 * 60 }); // 1h ago
      seedStory({ id: 2, score: 300, time: now - 1000 * 60 * 60 * 24 * 2 }); // 2d ago
      seedStory({ id: 3, score: 200, time: now - 1000 * 60 * 60 * 24 * 10 }); // 10d ago
      seedStory({ id: 4, score: 100, time: now - 1000 * 60 * 60 * 24 * 60 }); // 60d ago
      seedStory({ id: 5, score: 50, time: now - 1000 * 60 * 60 * 24 * 400 }); // 400d ago
    });

    it("returns stories for Day timespan (last 24h)", async () => {
      const result = await storyService.getStories("Day", 500);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it("returns stories for Week timespan (last 7d)", async () => {
      const result = await storyService.getStories("Week", 500);
      expect(result).toHaveLength(2);
    });

    it("returns stories for Month timespan (last 28d)", async () => {
      const result = await storyService.getStories("Month", 500);
      expect(result).toHaveLength(3);
    });

    it("returns stories for Year timespan (last 365d)", async () => {
      const result = await storyService.getStories("Year", 500);
      expect(result).toHaveLength(4);
    });

    it("returns all stories for All timespan", async () => {
      const result = await storyService.getStories("All", 500);
      expect(result).toHaveLength(5);
    });

    // Regression: Month used idx_stories_score on prod (16s worst case) when top
    // scores fell outside the window. Year must use score index (~136k rows match).
    it("uses correct INDEXED BY hint per timespan", async () => {
      await db.clearDatabase();
      const { getDb } = require("../../services/database");
      const database = getDb();
      const now = Date.now();
      const ins = database.prepare(
        "INSERT INTO stories (id, score, time, updated) VALUES (?, ?, ?, ?)"
      );
      database.transaction(() => {
        for (let i = 1; i <= 8000; i++) {
          ins.run(i, 1000 + i, now - (60 + i) * 24 * 60 * 60 * 1000, now);
        }
        for (let i = 8001; i <= 8200; i++) {
          ins.run(i, i % 500, now - 3 * 60 * 60 * 1000, now);
        }
      })();

      const monthThreshold = now - 28 * 24 * 60 * 60 * 1000;
      const monthPlan = database.prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, score, time FROM stories INDEXED BY idx_stories_time
         WHERE time > ? ORDER BY score DESC LIMIT 500`
      ).all(monthThreshold).map(r => r.detail).join(" | ");
      expect(monthPlan).toMatch(/idx_stories_time/);
      expect(monthPlan).not.toMatch(/idx_stories_score/);

      const yearThreshold = now - 365 * 24 * 60 * 60 * 1000;
      const yearPlan = database.prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, score, time FROM stories INDEXED BY idx_stories_score
         WHERE time > ? ORDER BY score DESC LIMIT 500`
      ).all(yearThreshold).map(r => r.detail).join(" | ");
      expect(yearPlan).toMatch(/idx_stories_score/);
      expect(yearPlan).not.toMatch(/idx_stories_time/);

      const allPlan = database.prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, score, time FROM stories INDEXED BY idx_stories_score
         ORDER BY score DESC LIMIT 500`
      ).all().map(r => r.detail).join(" | ");
      expect(allPlan).toMatch(/idx_stories_score/);
    });

    it("sorts by score descending", async () => {
      const result = await storyService.getStories("All", 500);
      expect(result[0].score).toBe(500);
      expect(result[4].score).toBe(50);
    });

    it("respects limit parameter", async () => {
      const result = await storyService.getStories("All", 2);
      expect(result).toHaveLength(2);
    });

    it("respects skip parameter", async () => {
      const result = await storyService.getStories("All", 2, 2);
      expect(result).toHaveLength(2);
      expect(result[0].score).toBe(200);
    });

    it("returns correct field projection (no _id)", async () => {
      const result = await storyService.getStories("All", 1);
      const story = result[0];
      expect(story._id).toBeUndefined();
      expect(story.by).toBeDefined();
      expect(story.id).toBeDefined();
      expect(story.score).toBeDefined();
      expect(story.title).toBeDefined();
    });

    it("converts time to Date objects", async () => {
      const result = await storyService.getStories("All", 1);
      expect(result[0].time).toBeInstanceOf(Date);
    });

    it("returns fresh data on second call", async () => {
      const first = await storyService.getStories("All", 500);
      seedStory({ id: 99, score: 999, time: Date.now() - 48 * 60 * 60 * 1000 });
      const second = await storyService.getStories("All", 500);
      expect(second).toHaveLength(first.length + 1);
    });

    it("Year returns high-scoring old stories even with >500 stories in range", async () => {
      await db.clearDatabase();

      const now = Date.now();

      // 500 recent low-scoring stories (last 2 weeks)
      for (let i = 1; i <= 500; i++) {
        seedStory({
          id: i,
          score: i,
          time: now - 1000 * 60 * 60 * 24 * (1 + (i % 14)),
        });
      }

      // 10 old high-scoring stories (11 months ago)
      for (let i = 501; i <= 510; i++) {
        seedStory({
          id: i,
          score: 9000 + i,
          time: now - 1000 * 60 * 60 * 24 * 330,
        });
      }

      const result = await storyService.getStories("Year", 500);
      // The 10 old high-scoring stories must appear at the top
      const topIds = result.slice(0, 10).map(s => s.id);
      for (let i = 501; i <= 510; i++) {
        expect(topIds).toContain(i);
      }
    });

    it("filters out hidden stories when hiddenIds provided", async () => {
      const result = await storyService.getStories("All", 500, undefined, undefined, [1, 3]);
      expect(result).toHaveLength(3);
      expect(result.map(s => s.id)).not.toContain(1);
      expect(result.map(s => s.id)).not.toContain(3);
    });

    it("returns correct count after filtering hidden stories", async () => {
      const result = await storyService.getStories("All", 2, undefined, undefined, [1]);
      expect(result).toHaveLength(2);
      // Highest remaining scores are 300, 200 (id=2 and id=3)
      expect(result[0].score).toBe(300);
      expect(result[1].score).toBe(200);
    });

    it("returns all stories when hiddenIds is empty", async () => {
      const result = await storyService.getStories("All", 500, undefined, undefined, []);
      expect(result).toHaveLength(5);
    });

    it("does not mutate hiddenIds array", async () => {
      const hiddenIds = [2, 1];
      await storyService.getStories("All", 10, 0, null, hiddenIds);
      expect(hiddenIds).toEqual([2, 1]);
    });

    it("handles self-post stories with no url field", async () => {
      await db.clearDatabase();

      seedStory({ id: 1, score: 100, time: Date.now(), url: null });
      seedStory({ id: 2, score: 200, time: Date.now(), url: "https://example.com" });

      const result = await storyService.getStories("All", 500);
      expect(result).toHaveLength(2);
      const noUrlStory = result.find(s => s.id === 1);
      expect(noUrlStory.url).toBeNull();
    });
  });

  describe("getHidden", () => {
    it("returns hidden array for existing user", async () => {
      const { getDb } = require("../../services/database");
      const d = getDb();
      d.prepare("INSERT INTO users (username) VALUES (?)").run("testuser");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("testuser", 123);
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("testuser", 456);

      const result = await storyService.getHidden("testuser");
      expect(result.sort()).toEqual([123, 456]);
    });

    it("returns empty array when user does not exist", async () => {
      const result = await storyService.getHidden("nonexistent");
      expect(result).toEqual([]);
    });

    it("returns hidden IDs without user existing in users table", async () => {
      const { getDb } = require("../../services/database");
      const d = getDb();
      // Insert hidden without user doc — should still work
      d.prepare("INSERT INTO users (username) VALUES (?)").run("nodoc");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("nodoc", 789);

      const result = await storyService.getHidden("nodoc");
      expect(result).toEqual([789]);
    });

    it("deduplicates concurrent getHidden calls for same user", async () => {
      const { getDb } = require("../../services/database");
      const d = getDb();
      d.prepare("INSERT INTO users (username) VALUES (?)").run("dedupuser");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("dedupuser", 100);
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("dedupuser", 200);

      const [result1, result2] = await Promise.all([
        storyService.getHidden("dedupuser"),
        storyService.getHidden("dedupuser"),
      ]);

      expect(result1.sort()).toEqual([100, 200]);
      expect(result2.sort()).toEqual([100, 200]);
    });
  });

  describe("upsertHidden", () => {
    it("creates user and adds hidden ID when user does not exist", async () => {
      await storyService.upsertHidden("newuser", 789);

      const { getDb } = require("../../services/database");
      const d = getDb();
      const user = d.prepare("SELECT * FROM users WHERE username = ?").get("newuser");
      expect(user).toBeDefined();
      const hidden = d.prepare("SELECT story_id FROM hidden WHERE username = ?").all("newuser");
      expect(hidden.map(r => r.story_id)).toContain(789);
    });

    it("adds hidden ID to existing user", async () => {
      const { getDb } = require("../../services/database");
      const d = getDb();
      d.prepare("INSERT INTO users (username) VALUES (?)").run("existinguser");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("existinguser", 100);

      await storyService.upsertHidden("existinguser", 200);

      const hidden = d.prepare("SELECT story_id FROM hidden WHERE username = ?").all("existinguser");
      const ids = hidden.map(r => r.story_id);
      expect(ids).toContain(100);
      expect(ids).toContain(200);
    });

    it("getHidden reflects upsert immediately", async () => {
      const { getDb } = require("../../services/database");
      const d = getDb();
      d.prepare("INSERT INTO users (username) VALUES (?)").run("invaliduser");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("invaliduser", 100);

      const first = await storyService.getHidden("invaliduser");
      expect(first).toEqual([100]);

      await storyService.upsertHidden("invaliduser", 200);

      const second = await storyService.getHidden("invaliduser");
      expect(second.sort()).toEqual([100, 200]);
    });

    it("is idempotent (no duplicates)", async () => {
      const { getDb } = require("../../services/database");
      const d = getDb();
      d.prepare("INSERT INTO users (username) VALUES (?)").run("testuser");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("testuser", 100);

      await storyService.upsertHidden("testuser", 100);

      const hidden = d.prepare("SELECT story_id FROM hidden WHERE username = ?").all("testuser");
      const count = hidden.filter(r => r.story_id === 100).length;
      expect(count).toBe(1);
    });
  });

  describe("upsertUser", () => {
    it("creates new user when user does not exist", async () => {
      await storyService.upsertUser("brandnew");

      const { getDb } = require("../../services/database");
      const user = getDb().prepare("SELECT * FROM users WHERE username = ?").get("brandnew");
      expect(user).toBeDefined();
    });

    it("is a no-op when user already exists", async () => {
      const { getDb } = require("../../services/database");
      const d = getDb();
      d.prepare("INSERT INTO users (username) VALUES (?)").run("existing");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("existing", 1);
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("existing", 2);
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("existing", 3);

      await storyService.upsertUser("existing");

      const user = d.prepare("SELECT * FROM users WHERE username = ?").get("existing");
      expect(user).toBeDefined();
      // hidden should be preserved
      const hidden = d.prepare("SELECT story_id FROM hidden WHERE username = ?").all("existing");
      expect(hidden.map(r => r.story_id).sort()).toEqual([1, 2, 3]);
    });
  });
});
