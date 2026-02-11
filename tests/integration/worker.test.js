const db = require("../setup");
const { storiesCollection, padId } = require("../../services/firestore");

jest.mock("../../services/hackernews");
const Remote = require("../../services/hackernews");

const { syncOnce, formatBytes, sleep } = require("../../worker");

beforeAll(async () => await db.connect());
afterEach(async () => {
  await db.clearDatabase();
  jest.restoreAllMocks();
});
afterAll(async () => await db.closeDatabase());

describe("worker logic (simulated)", () => {
  describe("stale story detection", () => {
    it("finds stories updated more than 14d ago", async () => {
      await Promise.all([
        storiesCollection().doc(padId(1)).set({
          id: 1,
          score: 100,
          time: new Date(),
          title: "Recently updated",
          by: "a",
          updated: new Date(),
        }),
        storiesCollection().doc(padId(2)).set({
          id: 2,
          score: 100,
          time: new Date(),
          title: "Stale",
          by: "a",
          updated: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15d ago
        }),
      ]);

      // Simulate worker's stale story query
      const staleSnap = await storiesCollection()
        .where("updated", "<", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000))
        .get();

      expect(staleSnap.docs).toHaveLength(1);
      expect(staleSnap.docs[0].data().id).toBe(2);
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
    Remote.updateStories.mockResolvedValue();
  });

  it("bootstraps when DB is empty", async () => {
    Remote.getNewStories.mockResolvedValue([300, 200, 100]);

    await syncOnce();

    expect(Remote.addStories).toHaveBeenCalledWith([300, 200, 100]);
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

    expect(Remote.addStories).toHaveBeenCalledWith([300, 200]);
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
    // Seed a story updated 15 days ago
    await storiesCollection().doc(padId(100)).set({
      id: 100,
      score: 50,
      time: new Date(),
      title: "Stale story",
      by: "a",
      updated: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    });

    Remote.getNewStories.mockResolvedValue([50]); // no new stories

    await syncOnce();

    expect(Remote.updateStories).toHaveBeenCalledWith([100]);
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
});
