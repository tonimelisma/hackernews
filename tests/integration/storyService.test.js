const db = require("../setup");
const { storiesCollection, usersCollection, padId } = require("../../services/firestore");

beforeAll(async () => await db.connect());

const storyService = require("../../services/storyService");

afterEach(async () => {
  await storyService.clearCache();
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

    it("converts Firestore Timestamps to Date objects", async () => {
      const result = await storyService.getStories("All", 1);
      expect(result[0].time).toBeInstanceOf(Date);
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

    it("Year returns high-scoring old stories even with >500 stories in range", async () => {
      await storyService.clearCache();
      await db.clearDatabase();

      const now = Date.now();
      const promises = [];

      // 500 recent low-scoring stories (last 2 weeks)
      for (let i = 1; i <= 500; i++) {
        promises.push(
          seedStory({
            id: i,
            score: i,
            time: new Date(now - 1000 * 60 * 60 * 24 * (1 + (i % 14))),
          })
        );
      }

      // 10 old high-scoring stories (11 months ago)
      for (let i = 501; i <= 510; i++) {
        promises.push(
          seedStory({
            id: i,
            score: 9000 + i,
            time: new Date(now - 1000 * 60 * 60 * 24 * 330),
          })
        );
      }

      await Promise.all(promises);

      const result = await storyService.getStories("Year", 500);
      // The 10 old high-scoring stories must appear at the top
      const topIds = result.slice(0, 10).map(s => s.id);
      for (let i = 501; i <= 510; i++) {
        expect(topIds).toContain(i);
      }
    });

    it("exports per-timespan CACHE_TTLS", () => {
      expect(storyService.CACHE_TTLS.Day).toBe(30 * 60 * 1000);
      expect(storyService.CACHE_TTLS.Week).toBe(2 * 24 * 60 * 60 * 1000);
      expect(storyService.CACHE_TTLS.Month).toBe(7 * 24 * 60 * 60 * 1000);
      expect(storyService.CACHE_TTLS.Year).toBe(30 * 24 * 60 * 60 * 1000);
      expect(storyService.CACHE_TTLS.All).toBe(30 * 24 * 60 * 60 * 1000);
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

    it("L2 cache handles self-post stories with no url field", async () => {
      await storyService.clearCache();
      await db.clearDatabase();

      // Self-post (Ask HN) has no url — url is undefined
      await seedStory({ id: 1, score: 100, time: new Date(), url: undefined });
      await seedStory({ id: 2, score: 200, time: new Date(), url: "https://example.com" });

      // Should not throw — stripUndefined removes url:undefined before Firestore write
      const result = await storyService.getStories("All", 500);
      expect(result).toHaveLength(2);

      // Verify L2 cache doc was written successfully
      const { cacheCollection } = require("../../services/firestore");
      const doc = await cacheCollection().doc("All").get();
      expect(doc.exists).toBe(true);
      const cached = doc.data();
      const noUrlStory = cached.stories.find(s => s.id === 1);
      expect(noUrlStory.url).toBeUndefined();
      expect(cached.stories.find(s => s.id === 2).url).toBe("https://example.com");
    });

    it("L2 cache doc is populated after L3 query", async () => {
      const { cacheCollection } = require("../../services/firestore");

      // Verify no L2 cache doc exists yet
      const before = await cacheCollection().doc("All").get();
      expect(before.exists).toBe(false);

      // First call populates both L1 and L2
      await storyService.getStories("All", 500);

      // Verify L2 cache doc was created with correct data
      const after = await cacheCollection().doc("All").get();
      expect(after.exists).toBe(true);
      const data = after.data();
      expect(data.stories).toHaveLength(5);
      expect(data.cachedAt).toBeDefined();
      // Time stored as epoch millis (number), not Date
      expect(typeof data.stories[0].time).toBe("number");
    });

    it("clearCache clears L2 Firestore cache", async () => {
      const { cacheCollection } = require("../../services/firestore");

      // Populate cache
      await storyService.getStories("All", 500);

      // Verify L2 doc exists
      const beforeDoc = await cacheCollection().doc("All").get();
      expect(beforeDoc.exists).toBe(true);

      // Clear all caches
      await storyService.clearCache();

      // Verify L2 doc is gone
      const afterDoc = await cacheCollection().doc("All").get();
      expect(afterDoc.exists).toBe(false);
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

    it("deduplicates concurrent getHidden calls for same user", async () => {
      await usersCollection().doc("dedupuser").collection("hidden").doc("100").set({ addedAt: Date.now() });
      await usersCollection().doc("dedupuser").collection("hidden").doc("200").set({ addedAt: Date.now() });

      // Fire two concurrent requests for the same user
      const [result1, result2] = await Promise.all([
        storyService.getHidden("dedupuser"),
        storyService.getHidden("dedupuser"),
      ]);

      // Both should return the same result
      expect(result1.sort()).toEqual([100, 200]);
      expect(result2.sort()).toEqual([100, 200]);
    });

    it("returns cached hidden IDs on second call", async () => {
      await usersCollection().doc("cacheuser").collection("hidden").doc("100").set({ addedAt: Date.now() });

      const first = await storyService.getHidden("cacheuser");
      expect(first).toEqual([100]);

      // Add another hidden ID directly (bypassing upsertHidden to avoid cache invalidation)
      await usersCollection().doc("cacheuser").collection("hidden").doc("200").set({ addedAt: Date.now() });

      // Second call should return cached result (only 100)
      const second = await storyService.getHidden("cacheuser");
      expect(second).toEqual([100]);
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

    it("invalidates hidden cache after upsert", async () => {
      await usersCollection().doc("invaliduser").collection("hidden").doc("100").set({ addedAt: Date.now() });

      // Populate hidden cache
      const first = await storyService.getHidden("invaliduser");
      expect(first).toEqual([100]);

      // upsertHidden should invalidate cache
      await storyService.upsertHidden("invaliduser", 200);

      // Next getHidden should re-read from Firestore
      const second = await storyService.getHidden("invaliduser");
      expect(second.sort()).toEqual([100, 200]);
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

  describe("patchStoryCache", () => {
    const { cacheCollection } = require("../../services/firestore");

    it("patches L2 cache doc scores in-place", async () => {
      const now = Date.now();
      await Promise.all([
        seedStory({ id: 1, score: 100, time: new Date(now - 1000 * 60 * 60) }),
        seedStory({ id: 2, score: 200, time: new Date(now - 1000 * 60 * 60 * 2) }),
      ]);

      // Populate L2 cache
      await storyService.getStories("All", 500);

      // Verify initial L2 cache
      const before = await cacheCollection().doc("All").get();
      expect(before.data().stories[0].score).toBe(200);
      expect(before.data().stories[1].score).toBe(100);

      // Patch with new scores
      await storyService.patchStoryCache([
        { id: 1, score: 999, descendants: 50 },
      ]);

      // Verify L2 cache was updated
      const after = await cacheCollection().doc("All").get();
      const story1 = after.data().stories.find(s => s.id === 1);
      expect(story1.score).toBe(999);
      expect(story1.descendants).toBe(50);
    });

    it("re-sorts stories by score after patching", async () => {
      const now = Date.now();
      await Promise.all([
        seedStory({ id: 1, score: 100, time: new Date(now - 1000 * 60 * 60) }),
        seedStory({ id: 2, score: 200, time: new Date(now - 1000 * 60 * 60 * 2) }),
        seedStory({ id: 3, score: 300, time: new Date(now - 1000 * 60 * 60 * 3) }),
      ]);

      // Populate L2 cache (order: 3=300, 2=200, 1=100)
      await storyService.getStories("All", 500);

      // Patch story 1 to have highest score
      await storyService.patchStoryCache([
        { id: 1, score: 999, descendants: 0 },
      ]);

      const doc = await cacheCollection().doc("All").get();
      const scores = doc.data().stories.map(s => s.score);
      expect(scores).toEqual([999, 300, 200]);
    });

    it("skips missing cache docs without error", async () => {
      // No cache docs exist — should not throw
      await storyService.patchStoryCache([
        { id: 1, score: 999, descendants: 0 },
      ]);
    });

    it("does nothing when updatedStories is empty", async () => {
      const now = Date.now();
      await seedStory({ id: 1, score: 100, time: new Date(now - 1000 * 60 * 60) });
      await storyService.getStories("All", 500);

      await storyService.patchStoryCache([]);

      // L2 cache should be unchanged
      const doc = await cacheCollection().doc("All").get();
      expect(doc.data().stories[0].score).toBe(100);
    });

    it("does not touch hidden cache", async () => {
      await usersCollection().doc("patchuser").collection("hidden").doc("100").set({ addedAt: Date.now() });

      // Populate hidden cache
      const hidden = await storyService.getHidden("patchuser");
      expect(hidden).toEqual([100]);

      const now = Date.now();
      await seedStory({ id: 1, score: 100, time: new Date(now - 1000 * 60 * 60) });
      await storyService.getStories("All", 500);

      // Patch story cache
      await storyService.patchStoryCache([
        { id: 1, score: 999, descendants: 0 },
      ]);

      // Hidden cache should still return cached result
      const hiddenAfter = await storyService.getHidden("patchuser");
      expect(hiddenAfter).toEqual([100]);
    });

    it("skips updates with undefined score", async () => {
      const now = Date.now();
      await Promise.all([
        seedStory({ id: 1, score: 100, time: new Date(now - 1000 * 60 * 60) }),
        seedStory({ id: 2, score: 200, time: new Date(now - 1000 * 60 * 60 * 2) }),
      ]);

      // Populate L2 cache
      await storyService.getStories("All", 500);

      // Patch with one valid and one undefined-score update
      await storyService.patchStoryCache([
        { id: 1, score: 999, descendants: 50 },
        { id: 2, score: undefined, descendants: undefined },
      ]);

      // Story 1 should be updated, story 2 should keep original score
      const doc = await cacheCollection().doc("All").get();
      const story1 = doc.data().stories.find(s => s.id === 1);
      const story2 = doc.data().stories.find(s => s.id === 2);
      expect(story1.score).toBe(999);
      expect(story2.score).toBe(200);
    });

    it("patches multiple timespans", async () => {
      const now = Date.now();
      await seedStory({ id: 1, score: 100, time: new Date(now - 1000 * 60 * 60) }); // 1h ago (in Day + All)

      // Populate both Day and All L2 caches
      await storyService.getStories("Day", 500);
      await storyService.clearCache();
      // Re-seed and re-populate to get both timespans with L2 docs
      await seedStory({ id: 1, score: 100, time: new Date(now - 1000 * 60 * 60) });
      await storyService.getStories("Day", 500);
      await storyService.getStories("All", 500);

      // Clear L1 so we can verify L2 was patched
      await storyService.patchStoryCache([
        { id: 1, score: 777, descendants: 42 },
      ]);

      const dayDoc = await cacheCollection().doc("Day").get();
      expect(dayDoc.data().stories[0].score).toBe(777);

      const allDoc = await cacheCollection().doc("All").get();
      expect(allDoc.data().stories[0].score).toBe(777);
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
