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
  });
});
