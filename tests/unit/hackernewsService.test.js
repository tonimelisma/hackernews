const axios = require("axios");
const db = require("../setup");

jest.mock("axios");

// Must require after mocking axios
const hackernews = require("../../services/hackernews");

beforeAll(async () => await db.connect());
afterEach(async () => {
  await db.clearDatabase();
  jest.clearAllMocks();
});
afterAll(async () => await db.closeDatabase());

const seedStory = (overrides = {}) => {
  const { getDb } = require("../../services/database");
  const story = {
    id: 100,
    by: "test",
    descendants: 5,
    score: 50,
    time: Date.now(),
    title: "Test",
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

describe("services/hackernews", () => {
  describe("login", () => {
    it("returns true when redirected to /news", async () => {
      axios.post.mockResolvedValue({
        status: 200,
        request: { path: "/news" },
      });

      const result = await hackernews.login("news", "testuser", "testpass");
      expect(result).toBe(true);
    });

    it("returns false when redirected back to /login", async () => {
      axios.post.mockResolvedValue({
        status: 200,
        request: { path: "/login" },
      });

      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await hackernews.login("news", "testuser", "wrongpass");
      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });

    it("returns false for unexpected redirect path", async () => {
      axios.post.mockResolvedValue({
        status: 200,
        request: { path: "/other" },
      });

      const result = await hackernews.login("news", "testuser", "testpass");
      expect(result).toBe(false);
    });
  });

  describe("getAllStoryIds", () => {
    it("fetches and deduplicates IDs from new, top, and best endpoints", async () => {
      axios.get
        .mockResolvedValueOnce({ data: [100, 200, 300] })  // newstories
        .mockResolvedValueOnce({ data: [200, 400, 500] })  // topstories
        .mockResolvedValueOnce({ data: [300, 500, 600] }); // beststories

      const result = await hackernews.getAllStoryIds();

      expect(result).toEqual(expect.arrayContaining([100, 200, 300, 400, 500, 600]));
      expect(result).toHaveLength(6);
    });

    it("returns empty array on error", async () => {
      axios.get.mockRejectedValue(new Error("network error"));

      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await hackernews.getAllStoryIds();
      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe("getItem", () => {
    it("fetches a single item by ID", async () => {
      const mockItem = { id: 123, title: "Test Story" };
      axios.get.mockResolvedValue({ data: mockItem });

      const result = await hackernews.getItem(123);
      expect(result).toEqual(mockItem);
    });

    it("returns undefined on error", async () => {
      axios.get.mockRejectedValue(new Error("not found"));

      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await hackernews.getItem(999);
      expect(result).toBeUndefined();
      consoleSpy.mockRestore();
    });
  });

  describe("getItems", () => {
    it("fetches multiple items in parallel", async () => {
      const item1 = { id: 1, title: "Story 1" };
      const item2 = { id: 2, title: "Story 2" };

      axios.get
        .mockResolvedValueOnce({ data: item1 })
        .mockResolvedValueOnce({ data: item2 });

      const result = await hackernews.getItems([1, 2]);
      expect(result).toEqual([item1, item2]);
    });
  });

  describe("checkStoryExists", () => {
    it("returns IDs of stories not in the database", async () => {
      seedStory({ id: 100 });

      const result = await hackernews.checkStoryExists([100, 200, 300]);
      expect(result).toEqual([200, 300]);
    });

    it("returns empty array when all stories exist", async () => {
      seedStory({ id: 100 });

      const result = await hackernews.checkStoryExists([100]);
      expect(result).toEqual([]);
    });

    it("tracks reads via ctx", async () => {
      seedStory({ id: 100 });

      const ctx = { read: jest.fn(), query: jest.fn() };
      await hackernews.checkStoryExists([100, 200], ctx);

      expect(ctx.read).toHaveBeenCalledWith("stories", 1);
    });

    it("works without ctx (backward compat)", async () => {
      const result = await hackernews.checkStoryExists([999]);
      expect(result).toEqual([999]);
    });
  });

  describe("addStories", () => {
    it("saves new stories to the database", async () => {
      const mockStory = {
        id: 500,
        by: "author",
        descendants: 10,
        kids: [1, 2],
        score: 100,
        time: 1609459200, // seconds since epoch
        title: "New Story",
        type: "story",
        url: "https://example.com",
      };

      axios.get.mockResolvedValue({ data: mockStory });

      await hackernews.addStories([500]);

      const { getDb } = require("../../services/database");
      const row = getDb().prepare("SELECT * FROM stories WHERE id = ?").get(500);
      expect(row).toBeDefined();
      expect(row.title).toBe("New Story");
      expect(row.by).toBe("author");
      expect(row.time).toBe(1609459200 * 1000);
    });

    it("handles stories with undefined kids/url fields", async () => {
      const mockStory = {
        id: 501,
        by: "author",
        descendants: 0,
        score: 50,
        time: 1609459200,
        title: "No URL Story",
        type: "story",
      };

      axios.get.mockResolvedValue({ data: mockStory });

      await hackernews.addStories([501]);

      const { getDb } = require("../../services/database");
      const row = getDb().prepare("SELECT * FROM stories WHERE id = ?").get(501);
      expect(row).toBeDefined();
      expect(row.title).toBe("No URL Story");
      expect(row.kids).toBeNull();
      expect(row.url).toBeNull();
    });

    it("tracks writes and queries via ctx", async () => {
      const mockStory = {
        id: 502,
        by: "author",
        descendants: 5,
        score: 80,
        time: 1609459200,
        title: "Tracked Story",
        type: "story",
        url: "https://example.com",
      };

      axios.get.mockResolvedValue({ data: mockStory });

      const ctx = { write: jest.fn(), query: jest.fn() };
      await hackernews.addStories([502], ctx);

      expect(ctx.write).toHaveBeenCalledWith("stories", 1);
      expect(ctx.query).toHaveBeenCalledTimes(1);
    });

    it("works without ctx (backward compat)", async () => {
      const mockStory = {
        id: 503,
        by: "author",
        descendants: 0,
        score: 10,
        time: 1609459200,
        title: "No Ctx Story",
        type: "story",
      };

      axios.get.mockResolvedValue({ data: mockStory });

      await hackernews.addStories([503]);

      const { getDb } = require("../../services/database");
      const row = getDb().prepare("SELECT * FROM stories WHERE id = ?").get(503);
      expect(row).toBeDefined();
    });
  });

  describe("updateStories", () => {
    it("updates existing stories in the database", async () => {
      seedStory({ id: 600, score: 10, descendants: 5 });

      const updatedData = {
        id: 600,
        descendants: 20,
        kids: [1, 2, 3],
        score: 200,
      };

      axios.get.mockResolvedValue({ data: updatedData });

      await hackernews.updateStories([600]);

      const { getDb } = require("../../services/database");
      const row = getDb().prepare("SELECT * FROM stories WHERE id = ?").get(600);
      expect(row.score).toBe(200);
      expect(row.descendants).toBe(20);
    });

    it("tracks writes and queries via ctx", async () => {
      seedStory({ id: 800, score: 10, descendants: 5 });

      const updatedData = {
        id: 800,
        descendants: 25,
        score: 300,
      };

      axios.get.mockResolvedValue({ data: updatedData });

      const ctx = { write: jest.fn(), query: jest.fn() };
      await hackernews.updateStories([800], ctx);

      expect(ctx.write).toHaveBeenCalledWith("stories", 1);
      expect(ctx.query).toHaveBeenCalledTimes(1);
    });

    it("works without ctx (backward compat)", async () => {
      seedStory({ id: 801, score: 10, descendants: 5 });

      axios.get.mockResolvedValue({ data: { id: 801, score: 20, descendants: 10 } });

      await hackernews.updateStories([801]);

      const { getDb } = require("../../services/database");
      const row = getDb().prepare("SELECT * FROM stories WHERE id = ?").get(801);
      expect(row.score).toBe(20);
    });

    it("returns array of updated {id, score, descendants}", async () => {
      seedStory({ id: 900, score: 10, descendants: 1 });
      seedStory({ id: 901, score: 20, descendants: 2 });

      axios.get
        .mockResolvedValueOnce({ data: { id: 900, score: 150, descendants: 30 } })
        .mockResolvedValueOnce({ data: { id: 901, score: 250, descendants: 40 } });

      const result = await hackernews.updateStories([900, 901]);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ id: 900, score: 150, descendants: 30 });
      expect(result).toContainEqual({ id: 901, score: 250, descendants: 40 });
    });

    it("returns empty array when no stories to update", async () => {
      axios.get.mockResolvedValue({ data: null });

      const result = await hackernews.updateStories([]);
      expect(result).toEqual([]);
    });

    it("skips stories with undefined score in return value", async () => {
      seedStory({ id: 910, score: 50, descendants: 5 });
      seedStory({ id: 911, score: 30, descendants: 2 });

      axios.get
        .mockResolvedValueOnce({ data: { id: 910, score: 150, descendants: 30 } })
        .mockResolvedValueOnce({ data: { id: 911 } }); // deleted/flagged — no score

      const result = await hackernews.updateStories([910, 911]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: 910, score: 150, descendants: 30 });
    });
  });
});
