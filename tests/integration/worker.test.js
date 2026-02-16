const db = require("../setup");
const { storiesCollection, padId } = require("../../services/firestore");
const storyService = require("../../services/storyService");

jest.mock("../../services/hackernews");
const Remote = require("../../services/hackernews");

const { syncOnce, formatBytes, sleep, WORKER_BATCH_LIMIT } = require("../../worker");

beforeAll(async () => await db.connect());
afterEach(async () => {
  await storyService.clearCache();
  await db.clearDatabase();
  jest.restoreAllMocks();
});
afterAll(async () => await db.closeDatabase());

describe("worker logic (simulated)", () => {
  describe("stale story detection", () => {
    it("finds monthly stories stale for 48h (compound inequality query)", async () => {
      const now = Date.now();
      await Promise.all([
        storiesCollection().doc(padId(1)).set({
          id: 1,
          score: 100,
          time: new Date(now - 10 * 24 * 60 * 60 * 1000), // 10d ago (within month)
          title: "Recently updated",
          by: "a",
          updated: new Date(), // just updated
        }),
        storiesCollection().doc(padId(2)).set({
          id: 2,
          score: 100,
          time: new Date(now - 10 * 24 * 60 * 60 * 1000), // 10d ago (within month)
          title: "Stale within month",
          by: "a",
          updated: new Date(now - 49 * 60 * 60 * 1000), // 49h ago
        }),
        storiesCollection().doc(padId(3)).set({
          id: 3,
          score: 100,
          time: new Date(now - 60 * 24 * 60 * 60 * 1000), // 60d ago (outside month)
          title: "Stale but too old",
          by: "a",
          updated: new Date(now - 49 * 60 * 60 * 1000), // 49h ago
        }),
      ]);

      // Compound inequality: time > threshold AND updated < staleness
      const monthTimeThreshold = new Date(now - 28 * 24 * 60 * 60 * 1000);
      const staleSnap = await storiesCollection()
        .where("time", ">", monthTimeThreshold)
        .where("updated", "<", new Date(now - 48 * 60 * 60 * 1000))
        .orderBy("updated", "asc")
        .limit(WORKER_BATCH_LIMIT)
        .get();

      const staleIds = staleSnap.docs.map(d => d.data().id);

      expect(staleIds).toHaveLength(1);
      expect(staleIds[0]).toBe(2);
    });
  });

  describe("latest story lookup", () => {
    it("finds the story with highest ID via doc ID ordering", async () => {
      await Promise.all([
        storiesCollection().doc(padId(100)).set({
          id: 100,
          score: 50,
          time: new Date(),
          title: "Older story",
          by: "a",
          updated: new Date(),
        }),
        storiesCollection().doc(padId(500)).set({
          id: 500,
          score: 200,
          time: new Date(),
          title: "Newer story",
          by: "b",
          updated: new Date(),
        }),
        storiesCollection().doc(padId(300)).set({
          id: 300,
          score: 100,
          time: new Date(),
          title: "Middle story",
          by: "c",
          updated: new Date(),
        }),
      ]);

      // Simulate worker's latest story query
      const latestSnap = await storiesCollection()
        .orderBy("id", "desc")
        .limit(1)
        .get();

      expect(latestSnap.docs).toHaveLength(1);
      expect(latestSnap.docs[0].data().id).toBe(500);
    });

    it("returns empty when no stories exist", async () => {
      const latestSnap = await storiesCollection()
        .orderBy("id", "desc")
        .limit(1)
        .get();

      expect(latestSnap.empty).toBe(true);
    });
  });
});

describe("syncOnce()", () => {
  beforeEach(() => {
    Remote.getNewStories.mockReset();
    Remote.addStories.mockReset();
    Remote.updateStories.mockReset();
    Remote.addStories.mockResolvedValue();
    Remote.updateStories.mockResolvedValue([]);
  });

  it("bootstraps when DB is empty", async () => {
    Remote.getNewStories.mockResolvedValue([300, 200, 100]);

    await syncOnce();

    expect(Remote.addStories).toHaveBeenCalledWith([300, 200, 100], expect.any(Object));
  });

  it("adds only new stories when local DB has stories", async () => {
    // Seed a story with id=100
    await storiesCollection().doc(padId(100)).set({
      id: 100,
      score: 50,
      time: new Date(),
      title: "Existing story",
      by: "a",
      updated: new Date(),
    });

    Remote.getNewStories.mockResolvedValue([300, 200, 100, 50]);

    await syncOnce();

    expect(Remote.addStories).toHaveBeenCalledWith([300, 200], expect.any(Object));
  });

  it("skips addStories when no new stories available", async () => {
    // Seed a story with id=500
    await storiesCollection().doc(padId(500)).set({
      id: 500,
      score: 200,
      time: new Date(),
      title: "Latest story",
      by: "a",
      updated: new Date(),
    });

    Remote.getNewStories.mockResolvedValue([400, 300, 200]);

    await syncOnce();

    expect(Remote.addStories).not.toHaveBeenCalled();
  });

  it("updates stale stories", async () => {
    const now = Date.now();
    // Seed a story within the month window, updated 49h ago (stale for monthly threshold)
    await storiesCollection().doc(padId(100)).set({
      id: 100,
      score: 50,
      time: new Date(now - 10 * 24 * 60 * 60 * 1000), // 10d ago (within 28d)
      title: "Stale story",
      by: "a",
      updated: new Date(now - 49 * 60 * 60 * 1000), // 49h ago
    });

    Remote.getNewStories.mockResolvedValue([50]); // no new stories

    await syncOnce();

    expect(Remote.updateStories).toHaveBeenCalledWith([100], expect.any(Object));
  });

  it("does not update recently updated stories", async () => {
    // Seed a story updated just now
    await storiesCollection().doc(padId(100)).set({
      id: 100,
      score: 50,
      time: new Date(),
      title: "Fresh story",
      by: "a",
      updated: new Date(),
    });

    Remote.getNewStories.mockResolvedValue([50]); // no new stories

    await syncOnce();

    expect(Remote.updateStories).not.toHaveBeenCalled();
  });

  it("limits trending batch to WORKER_BATCH_LIMIT", async () => {
    const now = Date.now();
    // Seed more stories than WORKER_BATCH_LIMIT, all stale
    const promises = [];
    for (let i = 1; i <= WORKER_BATCH_LIMIT + 50; i++) {
      promises.push(
        storiesCollection().doc(padId(i)).set({
          id: i,
          score: 50,
          time: new Date(now - 2 * 24 * 60 * 60 * 1000), // 2d ago (within week)
          title: `Story ${i}`,
          by: "a",
          updated: new Date(now - 7 * 60 * 60 * 1000), // 7h ago (stale for 6h threshold)
        })
      );
    }
    await Promise.all(promises);

    Remote.getNewStories.mockResolvedValue([1]); // no new stories

    await syncOnce();

    // Should have been called with at most WORKER_BATCH_LIMIT IDs per query
    const calls = Remote.updateStories.mock.calls;
    for (const call of calls) {
      expect(call[0].length).toBeLessThanOrEqual(WORKER_BATCH_LIMIT);
    }
    // At least one call should have exactly WORKER_BATCH_LIMIT (the weekly query hits the cap)
    const hasMaxBatch = calls.some(call => call[0].length === WORKER_BATCH_LIMIT);
    expect(hasMaxBatch).toBe(true);
  });
});

describe("syncOnce() cache patching", () => {
  beforeEach(() => {
    Remote.getNewStories.mockReset();
    Remote.addStories.mockReset();
    Remote.updateStories.mockReset();
    Remote.addStories.mockResolvedValue();
  });

  it("patches L2 cache after updating stale stories", async () => {
    const { cacheCollection } = require("../../services/firestore");
    const now = Date.now();

    // Seed a story within daily range, stale (updated 2h ago)
    await storiesCollection().doc(padId(100)).set({
      id: 100,
      score: 50,
      time: new Date(now - 2 * 60 * 60 * 1000), // 2h ago
      title: "Stale story",
      by: "a",
      updated: new Date(now - 2 * 60 * 60 * 1000), // 2h ago (stale for 1h daily threshold)
    });

    // Populate L2 cache for Day
    await storyService.getStories("Day", 500);

    // Verify initial L2 cache
    const before = await cacheCollection().doc("Day").get();
    expect(before.exists).toBe(true);
    expect(before.data().stories[0].score).toBe(50);

    // Mock updateStories to return new scores
    Remote.updateStories.mockResolvedValue([
      { id: 100, score: 999, descendants: 42 },
    ]);
    Remote.getNewStories.mockResolvedValue([50]); // no new stories

    await syncOnce();

    // Verify L2 cache was patched with new score
    const after = await cacheCollection().doc("Day").get();
    expect(after.data().stories[0].score).toBe(999);
    expect(after.data().stories[0].descendants).toBe(42);
  });
});

describe("utility functions", () => {
  it("formatBytes formats correctly", () => {
    expect(formatBytes(0)).toBe("0 Bytes");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("sleep resolves after delay", async () => {
    jest.useFakeTimers();
    const promise = sleep(1000);
    jest.advanceTimersByTime(1000);
    await promise;
    jest.useRealTimers();
  });

  it("exports WORKER_BATCH_LIMIT", () => {
    expect(WORKER_BATCH_LIMIT).toBe(200);
  });
});
