const fs = require("fs");
const path = require("path");
const { storiesCollection, usersCollection } = require("./firestore");

const MAX_QUERY_DOCS = 500;
const CACHE_FILE = path.join(__dirname, "..", ".cache", "stories.json");
const IS_TEST = process.env.NODE_ENV === "test";

// Per-timespan cache TTLs: Day is freshest, older timespans rarely change
const CACHE_TTLS = {
  Day: 30 * 60 * 1000,             // 30 minutes
  Week: 2 * 24 * 60 * 60 * 1000,   // 2 days
  Month: 7 * 24 * 60 * 60 * 1000,  // 1 week
  Year: 30 * 24 * 60 * 60 * 1000,  // 1 month
  All: 30 * 24 * 60 * 60 * 1000,   // 1 month
};

// In-memory TTL cache for story queries. Key: timespan, Value: { data, timestamp }
const cache = new Map();

// Load cache from disk on startup (production only)
const loadCacheFromDisk = () => {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const entries = JSON.parse(raw);
    for (const [key, value] of Object.entries(entries)) {
      const ttl = CACHE_TTLS[key] || CACHE_TTLS.All;
      if (value && value.timestamp && Date.now() - value.timestamp < ttl) {
        cache.set(key, value);
      }
    }
  } catch {
    // File doesn't exist or is corrupt — start with empty cache
  }
};

// Persist cache to disk asynchronously (production only)
const saveCacheToDisk = () => {
  if (IS_TEST) return;
  const obj = {};
  for (const [key, value] of cache) {
    obj[key] = value;
  }
  const dir = path.dirname(CACHE_FILE);
  fs.mkdir(dir, { recursive: true }, (mkdirErr) => {
    if (mkdirErr) return;
    fs.writeFile(CACHE_FILE, JSON.stringify(obj), (writeErr) => {
      if (writeErr) {
        console.error("cache write failed:", writeErr.message);
      }
    });
  });
};

if (!IS_TEST) {
  loadCacheFromDisk();
}

const clearCache = () => {
  cache.clear();
};

const getHidden = async (reqUsername) => {
  const hiddenSnap = await usersCollection()
    .doc(reqUsername)
    .collection("hidden")
    .get();
  return hiddenSnap.empty ? [] : hiddenSnap.docs.map((doc) => Number(doc.id));
};

const upsertHidden = async (reqUsername, reqHidden) => {
  await usersCollection().doc(reqUsername).set({}, { merge: true });
  await usersCollection()
    .doc(reqUsername)
    .collection("hidden")
    .doc(String(reqHidden))
    .set({ addedAt: Date.now() });
};

const upsertUser = async (loginUsername) => {
  await usersCollection().doc(loginUsername).set({}, { merge: true });
};

// Fetch stories from cache or Firestore (raw, no merge)
const fetchFromCacheOrFirestore = async (timespan) => {
  const ttl = CACHE_TTLS[timespan] || CACHE_TTLS.All;
  const cached = cache.get(timespan);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }

  let stories;

  if (timespan === "All" || !getTimespanDate(timespan)) {
    // "All" timespan: Firestore can sort by score directly (no inequality filter)
    const snapshot = await storiesCollection()
      .orderBy("score", "desc")
      .limit(MAX_QUERY_DOCS)
      .get();
    stories = snapshot.docs.map(docToStory);
  } else {
    // Time-filtered: cap at MAX_QUERY_DOCS most recent, then sort by score client-side
    const timespanDate = getTimespanDate(timespan);
    const snapshot = await storiesCollection()
      .where("time", ">", timespanDate)
      .orderBy("time", "desc")
      .limit(MAX_QUERY_DOCS)
      .get();
    stories = snapshot.docs.map(docToStory);
    stories.sort((a, b) => b.score - a.score);
  }

  cache.set(timespan, { data: stories, timestamp: Date.now() });
  saveCacheToDisk();
  return stories;
};

// Merge fresh Day stories into a longer-timespan result (updated scores + new stories)
const mergeStories = (base, dayStories) => {
  const byId = new Map();
  for (const story of base) {
    byId.set(story.id, story);
  }
  for (const story of dayStories) {
    byId.set(story.id, story); // Day data wins (fresher scores)
  }
  const merged = Array.from(byId.values());
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, MAX_QUERY_DOCS);
};

const getStories = async (timespan, limit, skip = undefined) => {
  const skipN = isNaN(skip) ? 0 : skip;

  let stories = await fetchFromCacheOrFirestore(timespan);

  // For non-Day timespans, merge in fresh Day stories so new high-scoring
  // stories appear in longer views without waiting for full cache expiry
  if (timespan !== "Day") {
    const freshDay = await fetchFromCacheOrFirestore("Day");
    stories = mergeStories(stories, freshDay);
  }

  return stories.slice(skipN, skipN + limit);
};

const getTimespanDate = (timespan) => {
  switch (timespan) {
    case "Day":
      return new Date(Date.now() - 24 * 60 * 60 * 1000);
    case "Week":
      return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    case "Month":
      return new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    case "Year":
      return new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
};

const docToStory = (doc) => {
  const data = doc.data();
  return {
    by: data.by,
    descendants: data.descendants,
    id: data.id,
    score: data.score,
    time: data.time,
    title: data.title,
    url: data.url,
  };
};

module.exports = { getStories, upsertUser, upsertHidden, getHidden, clearCache, CACHE_TTLS };
