const { storiesCollection, usersCollection, cacheCollection, getDb } = require("./firestore");

const stripUndefined = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const MAX_QUERY_DOCS = 500;
const HIDDEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Per-timespan cache TTLs: Day is freshest, older timespans rarely change
const CACHE_TTLS = {
  Day: 30 * 60 * 1000,             // 30 minutes
  Week: 2 * 24 * 60 * 60 * 1000,   // 2 days
  Month: 7 * 24 * 60 * 60 * 1000,  // 1 week
  Year: 30 * 24 * 60 * 60 * 1000,  // 1 month
  All: 30 * 24 * 60 * 60 * 1000,   // 1 month
};

// L1: In-memory TTL cache for story queries. Key: timespan, Value: { data, timestamp }
const cache = new Map();

// Per-user in-memory cache for hidden story IDs
const hiddenCache = new Map();

// In-flight getHidden promises for deduplication
const hiddenPending = new Map();

// Convert stories to cache-safe format (time as epoch millis)
const storiesToCacheDoc = (stories, timestamp) => ({
  stories: stories.map(s => stripUndefined({
    by: s.by,
    descendants: s.descendants,
    id: s.id,
    score: s.score,
    time: s.time instanceof Date ? s.time.getTime() : s.time,
    title: s.title,
    url: s.url,
  })),
  cachedAt: timestamp,
});

// Convert cache doc back to story objects (epoch millis to Date)
const cacheDocToStories = (doc) =>
  doc.stories.map(s => ({
    ...s,
    time: new Date(s.time),
  }));

// L2: Load from Firestore cache doc if within TTL
const loadFromFirestoreCache = async (timespan, ttl, ctx) => {
  const t0 = Date.now();
  const doc = await cacheCollection().doc(timespan).get();
  const ms = Date.now() - t0;
  ctx?.query("cache", `doc=${timespan}`, doc.exists ? 1 : 0, ms);
  ctx?.read("cache", 1);
  if (!doc.exists) return null;
  const data = doc.data();
  if (!data.cachedAt || Date.now() - data.cachedAt >= ttl) return null;
  return cacheDocToStories(data);
};

// L2: Save to Firestore cache doc (fire-and-forget)
const saveToFirestoreCache = (timespan, stories, timestamp, ctx) => {
  try {
    const doc = storiesToCacheDoc(stories, timestamp);
    const t0 = Date.now();
    cacheCollection().doc(timespan).set(doc).then(() => {
      ctx?.write("cache", 1);
      ctx?.query("cache", `L2-write doc=${timespan}`, 1, Date.now() - t0);
    }).catch(err => {
      console.error("L2 cache write failed:", err.message);
    });
  } catch (err) {
    console.error("L2 cache write failed:", err.message);
  }
};

const clearCache = async (ctx) => {
  cache.clear();
  hiddenCache.clear();
  hiddenPending.clear();
  const timespans = ["Day", "Week", "Month", "Year", "All"];
  const batch = getDb().batch();
  for (const ts of timespans) {
    batch.delete(cacheCollection().doc(ts));
  }
  const t0 = Date.now();
  await batch.commit();
  ctx?.write("cache", timespans.length);
  ctx?.query("cache", `clearCache batch-delete`, timespans.length, Date.now() - t0);
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
    const t0 = Date.now();
    const hiddenSnap = await usersCollection()
      .doc(reqUsername)
      .collection("hidden")
      .get();
    const ms = Date.now() - t0;
    ctx?.query("users/hidden", `user=${reqUsername}`, hiddenSnap.docs.length, ms);
    ctx?.read("users/hidden", hiddenSnap.docs.length);
    const ids = hiddenSnap.empty ? [] : hiddenSnap.docs.map((doc) => Number(doc.id));
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
  await usersCollection().doc(reqUsername).set({}, { merge: true });
  ctx?.write("users", 1);
  await usersCollection()
    .doc(reqUsername)
    .collection("hidden")
    .doc(String(reqHidden))
    .set({ addedAt: Date.now() });
  ctx?.write("users/hidden", 1);
  hiddenCache.delete(reqUsername);
};

const upsertUser = async (loginUsername, ctx) => {
  await usersCollection().doc(loginUsername).set({}, { merge: true });
  ctx?.write("users", 1);
};

// Fetch stories from L1 cache, L2 Firestore cache, or L3 expensive query
const fetchFromCacheOrFirestore = async (timespan, ctx) => {
  const ttl = CACHE_TTLS[timespan] || CACHE_TTLS.All;

  // L1: in-memory cache
  const cached = cache.get(timespan);
  if (cached && Date.now() - cached.timestamp < ttl) {
    ctx?.l1CacheHit();
    return cached.data;
  }

  // L2: Firestore cache doc
  const l2Stories = await loadFromFirestoreCache(timespan, ttl, ctx);
  if (l2Stories) {
    ctx?.l2CacheHit();
    const now = Date.now();
    cache.set(timespan, { data: l2Stories, timestamp: now });
    return l2Stories;
  }

  // L3: expensive Firestore query
  ctx?.cacheMiss();
  let stories;

  if (timespan === "All" || !getTimespanDate(timespan)) {
    // "All" timespan: Firestore can sort by score directly (no inequality filter)
    const t0 = Date.now();
    const snapshot = await storiesCollection()
      .orderBy("score", "desc")
      .limit(MAX_QUERY_DOCS)
      .get();
    const ms = Date.now() - t0;
    ctx?.query("stories", "orderBy=score:desc limit=500", snapshot.docs.length, ms);
    ctx?.read("stories", snapshot.docs.length);
    stories = snapshot.docs.map(docToStory);
  } else {
    // Time-filtered: fetch ALL stories in range, sort by score client-side, cache top 500.
    const timespanDate = getTimespanDate(timespan);
    const t0 = Date.now();
    const snapshot = await storiesCollection()
      .where("time", ">", timespanDate)
      .orderBy("time", "desc")
      .get();
    const ms = Date.now() - t0;
    ctx?.query("stories", `where=time>${timespanDate.toISOString()} orderBy=time:desc`, snapshot.docs.length, ms);
    ctx?.read("stories", snapshot.docs.length);
    stories = snapshot.docs.map(docToStory);
    stories.sort((a, b) => b.score - a.score);
    stories = stories.slice(0, MAX_QUERY_DOCS);
  }

  const now = Date.now();
  cache.set(timespan, { data: stories, timestamp: now });
  saveToFirestoreCache(timespan, stories, now, ctx);
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

const getStories = async (timespan, limit, skip = undefined, ctx, hiddenIds = []) => {
  const skipN = isNaN(skip) ? 0 : skip;

  let stories = await fetchFromCacheOrFirestore(timespan, ctx);

  // For non-Day timespans, merge in fresh Day stories so new high-scoring
  // stories appear in longer views without waiting for full cache expiry
  if (timespan !== "Day") {
    const freshDay = await fetchFromCacheOrFirestore("Day", ctx);
    stories = mergeStories(stories, freshDay);
  }

  if (hiddenIds.length > 0) {
    const hiddenSet = new Set(hiddenIds);
    stories = stories.filter(s => !hiddenSet.has(s.id));
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
    time: data.time?.toDate ? data.time.toDate() : data.time,
    title: data.title,
    url: data.url,
  };
};

// Patch L2 cache docs in-place with updated scores/descendants from the worker.
// L1 expires naturally at its TTL and picks up the patched L2.
const patchStoryCache = async (updatedStories, ctx) => {
  if (updatedStories.length === 0) return;
  const updatesById = new Map(updatedStories.map(s => [s.id, s]));
  const timespans = ["Day", "Week", "Month", "Year", "All"];
  const batch = getDb().batch();
  let batchHasWrites = false;

  for (const ts of timespans) {
    const docRef = cacheCollection().doc(ts);
    const doc = await docRef.get();
    ctx?.read("cache", 1);
    if (!doc.exists) continue;
    const data = doc.data();
    let changed = false;
    for (const story of data.stories) {
      const update = updatesById.get(story.id);
      if (update) {
        story.score = update.score;
        story.descendants = update.descendants;
        changed = true;
      }
    }
    if (changed) {
      data.stories.sort((a, b) => b.score - a.score);
      batch.set(docRef, data);
      ctx?.write("cache", 1);
      batchHasWrites = true;
    }
  }

  if (batchHasWrites) {
    await batch.commit();
  }
};

module.exports = { getStories, upsertUser, upsertHidden, getHidden, clearCache, patchStoryCache, CACHE_TTLS };
