const db = require("../setup");
const { storiesCollection, padId } = require("../../services/firestore");

beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
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
