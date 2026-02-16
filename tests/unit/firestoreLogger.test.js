const { createFirestoreContext } = require("../../util/firestoreLogger");

describe("util/firestoreLogger", () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("starts with all counters at zero", () => {
    const ctx = createFirestoreContext();
    expect(ctx.reads).toBe(0);
    expect(ctx.writes).toBe(0);
    expect(ctx.cacheHits).toBe(0);
    expect(ctx.cacheMisses).toBe(0);
    expect(ctx.collections.size).toBe(0);
  });

  it("read() increments reads by docCount", () => {
    const ctx = createFirestoreContext();
    ctx.read("stories", 50);
    ctx.read("stories", 100);
    expect(ctx.reads).toBe(150);
  });

  it("write() increments writes by docCount", () => {
    const ctx = createFirestoreContext();
    ctx.write("users", 1);
    ctx.write("users/hidden", 3);
    expect(ctx.writes).toBe(4);
  });

  it("read/write default docCount to 1", () => {
    const ctx = createFirestoreContext();
    ctx.read("stories");
    ctx.write("users");
    expect(ctx.reads).toBe(1);
    expect(ctx.writes).toBe(1);
  });

  it("cacheHit() and cacheMiss() increment correctly", () => {
    const ctx = createFirestoreContext();
    ctx.cacheHit();
    ctx.cacheHit();
    ctx.cacheMiss();
    expect(ctx.cacheHits).toBe(2);
    expect(ctx.cacheMisses).toBe(1);
  });

  it("tracks collections as a Set (no duplicates)", () => {
    const ctx = createFirestoreContext();
    ctx.read("stories", 10);
    ctx.read("stories", 20);
    ctx.write("users", 1);
    expect(ctx.collections.size).toBe(2);
    expect(ctx.collections.has("stories")).toBe(true);
    expect(ctx.collections.has("users")).toBe(true);
  });

  it("log() emits a [firestore] tagged line with per-collection breakdown", () => {
    const ctx = createFirestoreContext();
    ctx.read("stories", 42);
    ctx.l1CacheHit();
    ctx.log("GET /stories", { timespan: "Day", count: 30 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0];
    expect(line).toMatch(/^\[firestore\] GET \/stories /);
    expect(line).toContain("cache=L1:1");
    expect(line).toContain("reads=stories:42");
    expect(line).toContain("writes=0");
    expect(line).toContain("collections=stories");
    expect(line).toContain("timespan=Day");
    expect(line).toContain("count=30");
  });

  it("log() shows cache=- when no cache activity", () => {
    const ctx = createFirestoreContext();
    ctx.read("users/hidden", 5);
    ctx.log("GET /hidden");

    const line = logSpy.mock.calls[0][0];
    expect(line).toContain("cache=-");
  });

  it("tracks L1, L2, and MISS cache types separately", () => {
    const ctx = createFirestoreContext();
    ctx.l1CacheHit();
    ctx.l1CacheHit();
    ctx.l2CacheHit();
    ctx.cacheMiss();

    // cacheHits is sum of L1 + L2
    expect(ctx.cacheHits).toBe(3);
    expect(ctx.cacheMisses).toBe(1);

    ctx.log("TEST");
    const line = logSpy.mock.calls[0][0];
    expect(line).toContain("cache=L1:2,L2:1,MISS:1");
  });

  it("shows per-collection read/write breakdown in log", () => {
    const ctx = createFirestoreContext();
    ctx.read("stories", 500);
    ctx.read("cache", 1);
    ctx.write("cache", 1);
    ctx.log("GET /stories");

    const line = logSpy.mock.calls[0][0];
    expect(line).toContain("reads=stories:500,cache:1");
    expect(line).toContain("writes=cache:1");
  });

  it("readsByCollection and writesByCollection expose per-collection Maps", () => {
    const ctx = createFirestoreContext();
    ctx.read("stories", 42);
    ctx.read("cache", 1);
    ctx.write("users", 2);

    expect(ctx.readsByCollection.get("stories")).toBe(42);
    expect(ctx.readsByCollection.get("cache")).toBe(1);
    expect(ctx.writesByCollection.get("users")).toBe(2);
  });

  it("query() emits [firestore-query] tagged inline log", () => {
    const ctx = createFirestoreContext();
    ctx.query("stories", "orderBy=score:desc limit=500", 500, 120);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0];
    expect(line).toMatch(/^\[firestore-query\] stories/);
    expect(line).toContain("docs=500");
    expect(line).toContain("ms=120");
  });

  it("l1CacheHit and legacy cacheHit both increment L1 counter", () => {
    const ctx = createFirestoreContext();
    ctx.cacheHit();
    ctx.l1CacheHit();
    expect(ctx.cacheHits).toBe(2);

    ctx.log("TEST");
    const line = logSpy.mock.calls[0][0];
    expect(line).toContain("cache=L1:2");
  });
});
