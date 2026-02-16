const axios = require("axios");
const db = require("../setup");
const { storiesCollection, padId } = require("../../services/firestore");

jest.mock("axios");

// Must require after mocking axios
const hackernews = require("../../services/hackernews");

beforeAll(async () => await db.connect());
afterEach(async () => {
  await db.clearDatabase();
  jest.clearAllMocks();
});
afterAll(async () => await db.closeDatabase());

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

  describe("getNewStories", () => {
    it("returns story IDs from HN API", async () => {
      const mockIds = [123, 456, 789];
      axios.get.mockResolvedValue({ data: mockIds });

      const result = await hackernews.getNewStories();
      expect(result).toEqual(mockIds);
      expect(axios.get).toHaveBeenCalledWith(
        "https://hacker-news.firebaseio.com/v0/newstories.json?print=pretty"
      );
    });

    it("returns empty array on error", async () => {
      axios.get.mockRejectedValue(new Error("network error"));

      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await hackernews.getNewStories();
      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe("getTopStories", () => {
    it("scrapes story IDs from hntoplinks for daily", async () => {
      const htmlWithStories =
        '<div class="score_12345"></div><div class="score_67890"></div>';
      axios.get.mockResolvedValueOnce({ data: htmlWithStories + "No more items" });

      const result = await hackernews.getTopStories("daily");

      expect(result).toEqual(["12345", "67890"]);
      expect(axios.get).toHaveBeenCalledWith(
        "https://www.hntoplinks.com/today/1"
      );
    });

    it("paginates until 'No more items' is found", async () => {
      const page1 = '<div class="score_111"></div>';
      const page2 = '<div class="score_222"></div>No more items';

      axios.get
        .mockResolvedValueOnce({ data: page1 })
        .mockResolvedValueOnce({ data: page2 });

      const result = await hackernews.getTopStories("daily");

      expect(result).toEqual(["111", "222"]);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it("returns empty array on error", async () => {
      axios.get.mockRejectedValue(new Error("network error"));

      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await hackernews.getTopStories("daily");
      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });

    it("uses weekly URL for weekly timespan", async () => {
      axios.get.mockResolvedValueOnce({ data: "No more items" });

      await hackernews.getTopStories("weekly");

      expect(axios.get).toHaveBeenCalledWith(
        "https://www.hntoplinks.com/week/1"
      );
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
      await storiesCollection().doc(padId(100)).set({
        id: 100,
        title: "Existing",
        by: "test",
        score: 50,
        time: new Date(),
        updated: new Date(),
      });

      const result = await hackernews.checkStoryExists([100, 200, 300]);
      expect(result).toEqual([200, 300]);
    });

    it("returns empty array when all stories exist", async () => {
      await storiesCollection().doc(padId(100)).set({
        id: 100,
        title: "Existing",
        by: "test",
        score: 50,
        time: new Date(),
        updated: new Date(),
      });

      const result = await hackernews.checkStoryExists([100]);
      expect(result).toEqual([]);
    });

    it("tracks reads and queries via ctx", async () => {
      await storiesCollection().doc(padId(100)).set({
        id: 100,
        title: "Existing",
        by: "test",
        score: 50,
        time: new Date(),
        updated: new Date(),
      });

      const ctx = { read: jest.fn(), query: jest.fn() };
      await hackernews.checkStoryExists([100, 200], ctx);

      expect(ctx.read).toHaveBeenCalledTimes(2);
      expect(ctx.read).toHaveBeenCalledWith("stories", 1);
      expect(ctx.query).toHaveBeenCalledTimes(1);
      expect(ctx.query).toHaveBeenCalledWith("stories", "checkExists batch size=2", 2, expect.any(Number));
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

      const doc = await storiesCollection().doc(padId(500)).get();
      expect(doc.exists).toBe(true);
      const saved = doc.data();
      expect(saved.title).toBe("New Story");
      expect(saved.by).toBe("author");
      // time is multiplied by 1000 (seconds to ms) and stored as Date
      expect(saved.time.toDate().getTime()).toBe(1609459200 * 1000);
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
        // kids, url, text are undefined
      };

      axios.get.mockResolvedValue({ data: mockStory });

      await hackernews.addStories([501]);

      const doc = await storiesCollection().doc(padId(501)).get();
      expect(doc.exists).toBe(true);
      const saved = doc.data();
      expect(saved.title).toBe("No URL Story");
      expect(saved.kids).toBeUndefined();
      expect(saved.url).toBeUndefined();
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

      expect(ctx.write).toHaveBeenCalledTimes(1);
      expect(ctx.write).toHaveBeenCalledWith("stories", 1);
      expect(ctx.query).toHaveBeenCalledTimes(1);
      expect(ctx.query).toHaveBeenCalledWith("stories", "addStories batch size=1", 1, expect.any(Number));
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

      const doc = await storiesCollection().doc(padId(503)).get();
      expect(doc.exists).toBe(true);
    });
  });

  describe("updateStories", () => {
    it("updates existing stories in the database", async () => {
      // Insert a story first
      await storiesCollection().doc(padId(600)).set({
        id: 600,
        title: "Old Title",
        by: "author",
        score: 10,
        descendants: 5,
        time: new Date(),
        updated: new Date(Date.now() - 100000),
      });

      const updatedData = {
        id: 600,
        descendants: 20,
        kids: [1, 2, 3],
        score: 200,
      };

      axios.get.mockResolvedValue({ data: updatedData });

      await hackernews.updateStories([600]);

      const doc = await storiesCollection().doc(padId(600)).get();
      const updated = doc.data();
      expect(updated.score).toBe(200);
      expect(updated.descendants).toBe(20);
    });

    it("handles items with undefined kids field", async () => {
      await storiesCollection().doc(padId(700)).set({
        id: 700,
        title: "Story",
        by: "author",
        score: 10,
        descendants: 5,
        kids: [1, 2],
        time: new Date(),
        updated: new Date(Date.now() - 100000),
      });

      const updatedData = {
        id: 700,
        descendants: 0,
        score: 15,
        // kids is undefined
      };

      axios.get.mockResolvedValue({ data: updatedData });

      await hackernews.updateStories([700]);

      const doc = await storiesCollection().doc(padId(700)).get();
      const updated = doc.data();
      expect(updated.score).toBe(15);
      expect(updated.descendants).toBe(0);
      // Original kids preserved since undefined was stripped
      expect(updated.kids).toEqual([1, 2]);
    });

    it("tracks writes and queries via ctx", async () => {
      await storiesCollection().doc(padId(800)).set({
        id: 800,
        title: "Story",
        by: "author",
        score: 10,
        descendants: 5,
        time: new Date(),
        updated: new Date(Date.now() - 100000),
      });

      const updatedData = {
        id: 800,
        descendants: 25,
        score: 300,
      };

      axios.get.mockResolvedValue({ data: updatedData });

      const ctx = { write: jest.fn(), query: jest.fn() };
      await hackernews.updateStories([800], ctx);

      expect(ctx.write).toHaveBeenCalledTimes(1);
      expect(ctx.write).toHaveBeenCalledWith("stories", 1);
      expect(ctx.query).toHaveBeenCalledTimes(1);
      expect(ctx.query).toHaveBeenCalledWith("stories", "updateStories batch size=1", 1, expect.any(Number));
    });

    it("works without ctx (backward compat)", async () => {
      await storiesCollection().doc(padId(801)).set({
        id: 801,
        title: "Story",
        by: "author",
        score: 10,
        descendants: 5,
        time: new Date(),
        updated: new Date(Date.now() - 100000),
      });

      axios.get.mockResolvedValue({ data: { id: 801, score: 20, descendants: 10 } });

      await hackernews.updateStories([801]);

      const doc = await storiesCollection().doc(padId(801)).get();
      expect(doc.data().score).toBe(20);
    });

    it("returns array of updated {id, score, descendants}", async () => {
      await storiesCollection().doc(padId(900)).set({
        id: 900,
        title: "Story A",
        by: "author",
        score: 10,
        descendants: 1,
        time: new Date(),
        updated: new Date(Date.now() - 100000),
      });
      await storiesCollection().doc(padId(901)).set({
        id: 901,
        title: "Story B",
        by: "author",
        score: 20,
        descendants: 2,
        time: new Date(),
        updated: new Date(Date.now() - 100000),
      });

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
      await storiesCollection().doc(padId(910)).set({
        id: 910,
        title: "Normal Story",
        by: "author",
        score: 50,
        descendants: 5,
        time: new Date(),
        updated: new Date(Date.now() - 100000),
      });
      await storiesCollection().doc(padId(911)).set({
        id: 911,
        title: "Deleted Story",
        by: "author",
        score: 30,
        descendants: 2,
        time: new Date(),
        updated: new Date(Date.now() - 100000),
      });

      axios.get
        .mockResolvedValueOnce({ data: { id: 910, score: 150, descendants: 30 } })
        .mockResolvedValueOnce({ data: { id: 911 } }); // deleted/flagged — no score

      const result = await hackernews.updateStories([910, 911]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: 910, score: 150, descendants: 30 });
    });
  });
});
