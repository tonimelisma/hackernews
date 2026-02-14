const db = require("../setup");

describe("services/firestore", () => {
  const originalEnv = process.env;

  beforeAll(async () => await db.connect());
  afterEach(async () => {
    await db.clearDatabase();
    process.env = { ...originalEnv };
    jest.resetModules();
  });
  afterAll(async () => {
    process.env = originalEnv;
    await db.closeDatabase();
  });

  describe("getCollectionPrefix", () => {
    it("returns 'prod' for production", () => {
      process.env.NODE_ENV = "production";
      const { getCollectionPrefix } = require("../../services/firestore");
      expect(getCollectionPrefix()).toBe("prod");
    });

    it("returns 'staging' for staging", () => {
      process.env.NODE_ENV = "staging";
      const { getCollectionPrefix } = require("../../services/firestore");
      expect(getCollectionPrefix()).toBe("staging");
    });

    it("returns 'ci' for ci", () => {
      process.env.NODE_ENV = "ci";
      const { getCollectionPrefix } = require("../../services/firestore");
      expect(getCollectionPrefix()).toBe("ci");
    });

    it("returns 'dev' for development", () => {
      process.env.NODE_ENV = "development";
      const { getCollectionPrefix } = require("../../services/firestore");
      expect(getCollectionPrefix()).toBe("dev");
    });

    it("returns 'dev' for undefined NODE_ENV", () => {
      delete process.env.NODE_ENV;
      const { getCollectionPrefix } = require("../../services/firestore");
      expect(getCollectionPrefix()).toBe("dev");
    });
  });

  describe("padId", () => {
    it("zero-pads small numbers to 10 digits", () => {
      const { padId } = require("../../services/firestore");
      expect(padId(1)).toBe("0000000001");
    });

    it("preserves 10-digit numbers", () => {
      const { padId } = require("../../services/firestore");
      expect(padId(9999999999)).toBe("9999999999");
    });

    it("handles string input", () => {
      const { padId } = require("../../services/firestore");
      expect(padId("42")).toBe("0000000042");
    });
  });

  describe("storiesCollection and usersCollection", () => {
    it("returns collection with correct prefix", () => {
      process.env.NODE_ENV = "ci";
      const { storiesCollection, usersCollection } = require("../../services/firestore");
      const stories = storiesCollection();
      const users = usersCollection();
      expect(stories._path).toBe("ci-stories");
      expect(users._path).toBe("ci-users");
    });
  });

  describe("getDb and setDb", () => {
    it("returns a Firestore instance", () => {
      const { getDb } = require("../../services/firestore");
      const instance = getDb();
      expect(instance).toBeDefined();
      expect(typeof instance.collection).toBe("function");
    });

    it("setDb replaces the instance", () => {
      const { getDb, setDb } = require("../../services/firestore");
      const fakeDb = { collection: jest.fn() };
      setDb(fakeDb);
      expect(getDb()).toBe(fakeDb);
    });
  });
});
