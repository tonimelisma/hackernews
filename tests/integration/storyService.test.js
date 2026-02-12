const db = require("../setup");
const { storiesCollection, usersCollection, padId } = require("../../services/firestore");

beforeAll(async () => await db.connect());

const storyService = require("../../services/storyService");

afterEach(async () => {
  storyService.clearCache();
  await db.clearDatabase();
});
afterAll(async () => await db.closeDatabase());

const createStory = (overrides = {}) => ({
  id: 1,
  by: "author",
  descendants: 10,
  score: 100,
  time: new Date(),
  title: "Test Story",
  url: "https://example.com",
  updated: new Date(),
  ...overrides,
});

const seedStory = async (overrides = {}) => {
  const story = createStory(overrides);
  await storiesCollection().doc(padId(story.id)).set(story);
  return story;
};

describe("services/storyService", () => {
  describe("getStories", () => {
    beforeEach(async () => {
      const now = Date.now();
      await Promise.all([
        seedStory({ id: 1, score: 500, time: new Date(now - 1000 * 60 * 60) }), // 1h ago
        seedStory({ id: 2, score: 300, time: new Date(now - 1000 * 60 * 60 * 24 * 2) }), // 2d ago
        seedStory({ id: 3, score: 200, time: new Date(now - 1000 * 60 * 60 * 24 * 10) }), // 10d ago
        seedStory({ id: 4, score: 100, time: new Date(now - 1000 * 60 * 60 * 24 * 60) }), // 60d ago
        seedStory({ id: 5, score: 50, time: new Date(now - 1000 * 60 * 60 * 24 * 400) }), // 400d ago
      ]);
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

    it("returns cached data on second call", async () => {
      const first = await storyService.getStories("All", 500);
      // Add another story after caching (outside Day range so merge doesn't pick it up)
      await seedStory({ id: 99, score: 999, time: new Date(Date.now() - 48 * 60 * 60 * 1000) });
      const second = await storyService.getStories("All", 500);
      // Should return same count (cache hit for both All and Day)
      expect(second).toHaveLength(first.length);
    });

    it("Day cache expires after 30min TTL", async () => {
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);

      const first = await storyService.getStories("Day", 500);
      expect(first).toHaveLength(1);

      // Add a new Day story
      await seedStory({ id: 99, score: 999, time: new Date(now - 1000) });

      // Still cached
      const stillCached = await storyService.getStories("Day", 500);
      expect(stillCached).toHaveLength(1);

      // Advance past Day TTL (30 min + 1ms)
      jest.setSystemTime(now + 30 * 60 * 1000 + 1);

      const second = await storyService.getStories("Day", 500);
      expect(second).toHaveLength(2);

      jest.useRealTimers();
    });

    it("new Day stories appear in cached Week results via merge", async () => {
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);

      // Populate both Week and Day caches
      const first = await storyService.getStories("Week", 500);
      expect(first).toHaveLength(2); // id=1 (1h ago) + id=2 (2d ago)

      // Add a new high-scoring story within Day range
      await seedStory({ id: 99, score: 999, time: new Date(now - 1000) });

      // Advance past Day TTL (30 min) but NOT past Week TTL (1 day)
      jest.setSystemTime(now + 31 * 60 * 1000);

      // Week cache still valid, but Day cache expired → fresh Day re-query picks up id=99
      // Merge brings id=99 into Week result
      const result = await storyService.getStories("Week", 500);
      expect(result).toHaveLength(3);
      expect(result[0].score).toBe(999); // new story is highest score

      jest.useRealTimers();
    });

    it("caps time-filtered queries at MAX_QUERY_DOCS", async () => {
      // Clear and seed more stories than we'd normally want
      storyService.clearCache();
      await db.clearDatabase();

      const now = Date.now();
      const promises = [];
      for (let i = 1; i <= 10; i++) {
        promises.push(
          seedStory({
            id: i,
            score: i * 10,
            time: new Date(now - 1000 * 60 * 60), // 1h ago (within Day)
          })
        );
      }
      await Promise.all(promises);

      // With limit=500 (MAX_QUERY_DOCS), all 10 should be returned
      const result = await storyService.getStories("Day", 500);
      expect(result).toHaveLength(10);
      // Sorted by score desc
      expect(result[0].score).toBe(100);
      expect(result[9].score).toBe(10);
    });

    it("exports per-timespan CACHE_TTLS", () => {
      expect(storyService.CACHE_TTLS.Day).toBe(30 * 60 * 1000);
      expect(storyService.CACHE_TTLS.Week).toBe(2 * 24 * 60 * 60 * 1000);
      expect(storyService.CACHE_TTLS.Month).toBe(7 * 24 * 60 * 60 * 1000);
      expect(storyService.CACHE_TTLS.Year).toBe(30 * 24 * 60 * 60 * 1000);
      expect(storyService.CACHE_TTLS.All).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });

  describe("getHidden", () => {
    it("returns hidden array for existing user", async () => {
      await usersCollection().doc("testuser").set({});
      await usersCollection().doc("testuser").collection("hidden").doc("123").set({ addedAt: Date.now() });
      await usersCollection().doc("testuser").collection("hidden").doc("456").set({ addedAt: Date.now() });

      const result = await storyService.getHidden("testuser");
      expect(result.sort()).toEqual([123, 456]);
    });

    it("returns empty array when user does not exist", async () => {
      const result = await storyService.getHidden("nonexistent");
      expect(result).toEqual([]);
    });

    it("returns hidden IDs without checking user doc", async () => {
      // Only create subcollection, no user doc — should still work
      await usersCollection().doc("nodoc").collection("hidden").doc("789").set({ addedAt: Date.now() });

      const result = await storyService.getHidden("nodoc");
      expect(result).toEqual([789]);
    });
  });

  describe("upsertHidden", () => {
    it("creates user and adds hidden ID when user does not exist", async () => {
      await storyService.upsertHidden("newuser", 789);

      const userDoc = await usersCollection().doc("newuser").get();
      expect(userDoc.exists).toBe(true);
      const hiddenSnap = await usersCollection().doc("newuser").collection("hidden").get();
      expect(hiddenSnap.docs.map((d) => Number(d.id))).toContain(789);
    });

    it("adds hidden ID to existing user", async () => {
      await usersCollection().doc("existinguser").set({});
      await usersCollection().doc("existinguser").collection("hidden").doc("100").set({ addedAt: Date.now() });

      await storyService.upsertHidden("existinguser", 200);

      const hiddenSnap = await usersCollection().doc("existinguser").collection("hidden").get();
      const ids = hiddenSnap.docs.map((d) => Number(d.id));
      expect(ids).toContain(100);
      expect(ids).toContain(200);
    });

    it("is idempotent (no duplicates)", async () => {
      await usersCollection().doc("testuser").set({});
      await usersCollection().doc("testuser").collection("hidden").doc("100").set({ addedAt: Date.now() });

      await storyService.upsertHidden("testuser", 100);

      const hiddenSnap = await usersCollection().doc("testuser").collection("hidden").get();
      const count = hiddenSnap.docs.filter((d) => d.id === "100").length;
      expect(count).toBe(1);
    });
  });

  describe("upsertUser", () => {
    it("creates new user when user does not exist", async () => {
      await storyService.upsertUser("brandnew");

      const userDoc = await usersCollection().doc("brandnew").get();
      expect(userDoc.exists).toBe(true);
    });

    it("is a no-op when user already exists", async () => {
      await usersCollection().doc("existing").set({});
      await usersCollection().doc("existing").collection("hidden").doc("1").set({ addedAt: Date.now() });
      await usersCollection().doc("existing").collection("hidden").doc("2").set({ addedAt: Date.now() });
      await usersCollection().doc("existing").collection("hidden").doc("3").set({ addedAt: Date.now() });

      await storyService.upsertUser("existing");

      const userDoc = await usersCollection().doc("existing").get();
      expect(userDoc.exists).toBe(true);
      // hidden subcollection should be preserved
      const hiddenSnap = await usersCollection().doc("existing").collection("hidden").get();
      expect(hiddenSnap.docs.map((d) => Number(d.id)).sort()).toEqual([1, 2, 3]);
    });
  });
});
