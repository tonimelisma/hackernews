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

  it("log() emits a [firestore] tagged line", () => {
    const ctx = createFirestoreContext();
    ctx.read("stories", 42);
    ctx.cacheHit();
    ctx.log("GET /stories", { timespan: "Day", count: 30 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0];
    expect(line).toMatch(/^\[firestore\] GET \/stories /);
    expect(line).toContain("cache=HIT:1");
    expect(line).toContain("reads=42");
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
});
