const { createDbContext } = require("../../util/dbLogger");

describe("util/dbLogger", () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("starts with all counters at zero", () => {
    const ctx = createDbContext();
    expect(ctx.reads).toBe(0);
    expect(ctx.writes).toBe(0);
    expect(ctx.cacheHits).toBe(0);
    expect(ctx.cacheMisses).toBe(0);
    expect(ctx.collections.size).toBe(0);
  });

  it("read() increments reads by docCount", () => {
    const ctx = createDbContext();
    ctx.read("stories", 50);
    ctx.read("stories", 100);
    expect(ctx.reads).toBe(150);
  });

  it("write() increments writes by docCount", () => {
    const ctx = createDbContext();
    ctx.write("users", 1);
    ctx.write("hidden", 3);
    expect(ctx.writes).toBe(4);
  });

  it("read/write default docCount to 1", () => {
    const ctx = createDbContext();
    ctx.read("stories");
    ctx.write("users");
    expect(ctx.reads).toBe(1);
    expect(ctx.writes).toBe(1);
  });

  it("cacheHit() and cacheMiss() increment correctly", () => {
    const ctx = createDbContext();
    ctx.cacheHit();
    ctx.cacheHit();
    ctx.cacheMiss();
    expect(ctx.cacheHits).toBe(2);
    expect(ctx.cacheMisses).toBe(1);
  });

  it("tracks tables as a Set (no duplicates)", () => {
    const ctx = createDbContext();
    ctx.read("stories", 10);
    ctx.read("stories", 20);
    ctx.write("users", 1);
    expect(ctx.collections.size).toBe(2);
    expect(ctx.collections.has("stories")).toBe(true);
    expect(ctx.collections.has("users")).toBe(true);
  });

  it("log() emits a [db] tagged line with per-table breakdown", () => {
    const ctx = createDbContext();
    ctx.read("stories", 42);
    ctx.l1CacheHit();
    ctx.log("GET /stories", { timespan: "Day", count: 30 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0];
    expect(line).toMatch(/^\[db\] GET \/stories /);
    expect(line).toContain("cache=L1:1");
    expect(line).toContain("reads=stories:42");
    expect(line).toContain("writes=0");
    expect(line).toContain("tables=stories");
    expect(line).toContain("timespan=Day");
    expect(line).toContain("count=30");
  });

  it("log() shows cache=- when no cache activity", () => {
    const ctx = createDbContext();
    ctx.read("hidden", 5);
    ctx.log("GET /hidden");

    const line = logSpy.mock.calls[0][0];
    expect(line).toContain("cache=-");
  });

  it("tracks L1 and MISS cache types separately", () => {
    const ctx = createDbContext();
    ctx.l1CacheHit();
    ctx.l1CacheHit();
    ctx.cacheMiss();

    expect(ctx.cacheHits).toBe(2);
    expect(ctx.cacheMisses).toBe(1);

    ctx.log("TEST");
    const line = logSpy.mock.calls[0][0];
    expect(line).toContain("cache=L1:2,MISS:1");
  });

  it("shows per-table read/write breakdown in log", () => {
    const ctx = createDbContext();
    ctx.read("stories", 500);
    ctx.read("hidden", 1);
    ctx.write("stories", 1);
    ctx.log("GET /stories");

    const line = logSpy.mock.calls[0][0];
    expect(line).toContain("reads=stories:500,hidden:1");
    expect(line).toContain("writes=stories:1");
  });

  it("readsByCollection and writesByCollection expose per-table Maps", () => {
    const ctx = createDbContext();
    ctx.read("stories", 42);
    ctx.read("hidden", 1);
    ctx.write("users", 2);

    expect(ctx.readsByCollection.get("stories")).toBe(42);
    expect(ctx.readsByCollection.get("hidden")).toBe(1);
    expect(ctx.writesByCollection.get("users")).toBe(2);
  });

  it("query() emits [db-query] tagged inline log", () => {
    const ctx = createDbContext();
    ctx.query("stories", "ORDER BY score DESC LIMIT 500", 500, 120);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0];
    expect(line).toMatch(/^\[db-query\] stories/);
    expect(line).toContain("rows=500");
    expect(line).toContain("ms=120");
  });

  it("l1CacheHit and legacy cacheHit both increment L1 counter", () => {
    const ctx = createDbContext();
    ctx.cacheHit();
    ctx.l1CacheHit();
    expect(ctx.cacheHits).toBe(2);

    ctx.log("TEST");
    const line = logSpy.mock.calls[0][0];
    expect(line).toContain("cache=L1:2");
  });
});
