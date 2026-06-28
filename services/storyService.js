const { getDb } = require("./database");

// In-flight getHidden promises for deduplication (not a TTL cache)
const hiddenPending = new Map();

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

  const timespanSeconds = getTimespanSeconds(timespan);
  let stories;

  if (timespanSeconds === null) {
    // "All" — score index matches ORDER BY; no time filter
    if (hiddenIds.length > 0) {
      const placeholders = hiddenIds.map(() => "?").join(",");
      const stmt = db.prepare(
        `SELECT id, by, descendants, score, time, title, url
         FROM stories INDEXED BY idx_stories_score
         WHERE id NOT IN (${placeholders})
         ORDER BY score DESC
         LIMIT ? OFFSET ?`
      );
      stories = stmt.all(...hiddenIds, limit, skipN);
    } else {
      const stmt = db.prepare(
        `SELECT id, by, descendants, score, time, title, url
         FROM stories INDEXED BY idx_stories_score
         ORDER BY score DESC
         LIMIT ? OFFSET ?`
      );
      stories = stmt.all(limit, skipN);
    }
  } else {
    // Day–Month: time index (selective; score scan can take 16s+ on Month).
    // Year: score index (~89% of rows match; time scan + sort takes 14–17s).
    const indexHint = timespan === "Year"
      ? " INDEXED BY idx_stories_score"
      : " INDEXED BY idx_stories_time";
    const threshold = Date.now() - timespanSeconds * 1000;
    if (hiddenIds.length > 0) {
      const placeholders = hiddenIds.map(() => "?").join(",");
      const stmt = db.prepare(
        `SELECT id, by, descendants, score, time, title, url
         FROM stories${indexHint}
         WHERE time > ?
           AND id NOT IN (${placeholders})
         ORDER BY score DESC
         LIMIT ? OFFSET ?`
      );
      stories = stmt.all(threshold, ...hiddenIds, limit, skipN);
    } else {
      const stmt = db.prepare(
        `SELECT id, by, descendants, score, time, title, url
         FROM stories${indexHint}
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

  ctx?.read("stories", stories.length);
  return result;
};

const getHidden = async (reqUsername, ctx) => {
  // Deduplicate concurrent requests for the same user
  if (hiddenPending.has(reqUsername)) {
    return hiddenPending.get(reqUsername);
  }

  const promise = (async () => {
    const db = getDb();
    const rows = db.prepare("SELECT story_id FROM hidden WHERE username = ?").all(reqUsername);
    ctx?.read("hidden", rows.length);
    return rows.map(r => r.story_id);
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
};

const upsertUser = async (loginUsername, ctx) => {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (username) VALUES (?)").run(loginUsername);
  ctx?.write("users", 1);
};

module.exports = { getStories, upsertUser, upsertHidden, getHidden };
