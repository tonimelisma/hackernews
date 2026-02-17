const db = require("../setup");
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

describe("worker logic (simulated)", () => {
  describe("stale story detection", () => {
    it("finds monthly stories stale for 48h (compound inequality query)", async () => {
      const now = Date.now();
      seedStory({
        id: 1,
        score: 100,
        time: now - 10 * 24 * 60 * 60 * 1000, // 10d ago (within month)
        updated: now, // just updated
      });
      seedStory({
        id: 2,
        score: 100,
        time: now - 10 * 24 * 60 * 60 * 1000, // 10d ago (within month)
        updated: now - 49 * 60 * 60 * 1000, // 49h ago
      });
      seedStory({
        id: 3,
        score: 100,
        time: now - 60 * 24 * 60 * 60 * 1000, // 60d ago (outside month)
        updated: now - 49 * 60 * 60 * 1000, // 49h ago
      });

      const { getDb } = require("../../services/database");
      const monthTimeThreshold = now - 28 * 24 * 60 * 60 * 1000;
      const staleThreshold = now - 48 * 60 * 60 * 1000;
      const rows = getDb().prepare(
        `SELECT id FROM stories WHERE time > ? AND updated < ? ORDER BY updated ASC LIMIT ?`
      ).all(monthTimeThreshold, staleThreshold, WORKER_BATCH_LIMIT);

      const staleIds = rows.map(r => r.id);
      expect(staleIds).toHaveLength(1);
      expect(staleIds[0]).toBe(2);
    });
  });

  describe("latest story lookup", () => {
    it("finds the story with highest ID", async () => {
      seedStory({ id: 100, score: 50 });
      seedStory({ id: 500, score: 200 });
      seedStory({ id: 300, score: 100 });

      const { getDb } = require("../../services/database");
      const row = getDb().prepare("SELECT id FROM stories ORDER BY id DESC LIMIT 1").get();

      expect(row.id).toBe(500);
    });

    it("returns undefined when no stories exist", async () => {
      const { getDb } = require("../../services/database");
      const row = getDb().prepare("SELECT id FROM stories ORDER BY id DESC LIMIT 1").get();

      expect(row).toBeUndefined();
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
    seedStory({ id: 100, score: 50 });

    Remote.getNewStories.mockResolvedValue([300, 200, 100, 50]);

    await syncOnce();

    expect(Remote.addStories).toHaveBeenCalledWith([300, 200], expect.any(Object));
  });

  it("skips addStories when no new stories available", async () => {
    seedStory({ id: 500, score: 200 });

    Remote.getNewStories.mockResolvedValue([400, 300, 200]);

    await syncOnce();

    expect(Remote.addStories).not.toHaveBeenCalled();
  });

  it("updates stale stories", async () => {
    const now = Date.now();
    seedStory({
      id: 100,
      score: 50,
      time: now - 10 * 24 * 60 * 60 * 1000, // 10d ago (within 28d)
      updated: now - 49 * 60 * 60 * 1000, // 49h ago
    });

    Remote.getNewStories.mockResolvedValue([50]); // no new stories

    await syncOnce();

    expect(Remote.updateStories).toHaveBeenCalledWith([100], expect.any(Object));
  });

  it("does not update recently updated stories", async () => {
    seedStory({
      id: 100,
      score: 50,
      time: Date.now(),
      updated: Date.now(),
    });

    Remote.getNewStories.mockResolvedValue([50]); // no new stories

    await syncOnce();

    expect(Remote.updateStories).not.toHaveBeenCalled();
  });

  it("limits trending batch to WORKER_BATCH_LIMIT", async () => {
    const now = Date.now();
    for (let i = 1; i <= WORKER_BATCH_LIMIT + 50; i++) {
      seedStory({
        id: i,
        score: 50,
        time: now - 2 * 24 * 60 * 60 * 1000, // 2d ago (within week)
        updated: now - 7 * 60 * 60 * 1000, // 7h ago (stale for 6h threshold)
      });
    }

    Remote.getNewStories.mockResolvedValue([1]); // no new stories

    await syncOnce();

    const calls = Remote.updateStories.mock.calls;
    for (const call of calls) {
      expect(call[0].length).toBeLessThanOrEqual(WORKER_BATCH_LIMIT);
    }
    // At least one call should have exactly WORKER_BATCH_LIMIT
    const hasMaxBatch = calls.some(call => call[0].length === WORKER_BATCH_LIMIT);
    expect(hasMaxBatch).toBe(true);
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
