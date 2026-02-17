const { getDb } = require("./database");

const HIDDEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL = 60 * 1000; // 1 minute L1 cache for burst traffic

// L1: In-memory TTL cache for story queries. Key: cacheKey, Value: { data, timestamp }
const cache = new Map();

// Per-user in-memory cache for hidden story IDs
const hiddenCache = new Map();

// In-flight getHidden promises for deduplication
const hiddenPending = new Map();

const clearCache = async () => {
  cache.clear();
  hiddenCache.clear();
  hiddenPending.clear();
};

const getTimespanSeconds = (timespan) => {
  switch (timespan) {
    case "Day":
      return 24 * 60 * 60;
    case "Week":
      return 7 * 24 * 60 * 60;
    case "Month":
      return 28 * 24 * 60 * 60;
    case "Year":
      return 365 * 24 * 60 * 60;
    default:
      return null; // "All"
  }
};

const getStories = async (timespan, limit, skip = undefined, ctx, hiddenIds = []) => {
  const skipN = isNaN(skip) ? 0 : skip;
  const db = getDb();

  // L1 cache key includes timespan + hidden IDs signature
  const hiddenKey = hiddenIds.length > 0 ? hiddenIds.sort().join(",") : "";
  const cacheKey = `${timespan}:${limit}:${skipN}:${hiddenKey}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    ctx?.l1CacheHit();
    return cached.data;
  }
  ctx?.cacheMiss();

  const timespanSeconds = getTimespanSeconds(timespan);
  let stories;

  if (timespanSeconds === null) {
    // "All" timespan — no time filter
    if (hiddenIds.length > 0) {
      const placeholders = hiddenIds.map(() => "?").join(",");
      const stmt = db.prepare(
        `SELECT id, by, descendants, score, time, title, url
         FROM stories
         WHERE id NOT IN (${placeholders})
         ORDER BY score DESC
         LIMIT ? OFFSET ?`
      );
      stories = stmt.all(...hiddenIds, limit, skipN);
    } else {
      const stmt = db.prepare(
        `SELECT id, by, descendants, score, time, title, url
         FROM stories
         ORDER BY score DESC
         LIMIT ? OFFSET ?`
      );
      stories = stmt.all(limit, skipN);
    }
  } else {
    const threshold = Date.now() - timespanSeconds * 1000;
    if (hiddenIds.length > 0) {
      const placeholders = hiddenIds.map(() => "?").join(",");
      const stmt = db.prepare(
        `SELECT id, by, descendants, score, time, title, url
         FROM stories
         WHERE time > ?
           AND id NOT IN (${placeholders})
         ORDER BY score DESC
         LIMIT ? OFFSET ?`
      );
      stories = stmt.all(threshold, ...hiddenIds, limit, skipN);
    } else {
      const stmt = db.prepare(
        `SELECT id, by, descendants, score, time, title, url
         FROM stories
         WHERE time > ?
         ORDER BY score DESC
         LIMIT ? OFFSET ?`
      );
      stories = stmt.all(threshold, limit, skipN);
    }
  }

  // Convert time from epoch ms (integer) to Date object for API compatibility
  const result = stories.map(s => ({
    ...s,
    time: new Date(s.time),
  }));

  cache.set(cacheKey, { data: result, timestamp: Date.now() });
  ctx?.read("stories", stories.length);
  return result;
};

const getHidden = async (reqUsername, ctx) => {
  const cached = hiddenCache.get(reqUsername);
  if (cached && Date.now() - cached.timestamp < HIDDEN_CACHE_TTL) {
    return cached.ids;
  }

  // Deduplicate concurrent requests for the same user
  if (hiddenPending.has(reqUsername)) {
    return hiddenPending.get(reqUsername);
  }

  const promise = (async () => {
    const db = getDb();
    const rows = db.prepare("SELECT story_id FROM hidden WHERE username = ?").all(reqUsername);
    ctx?.read("hidden", rows.length);
    const ids = rows.map(r => r.story_id);
    hiddenCache.set(reqUsername, { ids, timestamp: Date.now() });
    return ids;
  })();

  hiddenPending.set(reqUsername, promise);
  try {
    return await promise;
  } finally {
    hiddenPending.delete(reqUsername);
  }
};

const upsertHidden = async (reqUsername, reqHidden, ctx) => {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (username) VALUES (?)").run(reqUsername);
  ctx?.write("users", 1);
  db.prepare("INSERT OR REPLACE INTO hidden (username, story_id) VALUES (?, ?)").run(reqUsername, reqHidden);
  ctx?.write("hidden", 1);
  hiddenCache.delete(reqUsername);
};

const upsertUser = async (loginUsername, ctx) => {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (username) VALUES (?)").run(loginUsername);
  ctx?.write("users", 1);
};

module.exports = { getStories, upsertUser, upsertHidden, getHidden, clearCache };
