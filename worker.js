const { getDb } = require("./services/database");
const Remote = require("./services/hackernews");
const { createDbContext } = require("./util/dbLogger");

const WORKER_BATCH_LIMIT = 200;

const sleep = time => {
  return new Promise(resolve => setTimeout(resolve, time));
};

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const syncOnce = async () => {
  const ctx = createDbContext();
  let newCount = 0;
  let updatedCount = 0;
  const db = getDb();

  // LOAD LATEST STORIES
  try {
    const latestRow = db.prepare("SELECT id FROM stories ORDER BY id DESC LIMIT 1").get();
    ctx.read("stories", latestRow ? 1 : 0);

    const latestRemoteStoryIds = await Remote.getNewStories();

    if (!latestRow) {
      console.log("empty db, bootstrapping...");
      await Remote.addStories(latestRemoteStoryIds, ctx);
      newCount = latestRemoteStoryIds.length;
    } else {
      const latestLocalId = latestRow.id;
      if (latestLocalId < latestRemoteStoryIds[0]) {
        console.log("new stories available: local=%d remote=%d", latestLocalId, latestRemoteStoryIds[0]);
        const newStoryIds = latestRemoteStoryIds.filter(
          checkStoryId => checkStoryId > latestLocalId
        );
        await Remote.addStories(newStoryIds, ctx);
        newCount = newStoryIds.length;
      } else {
        console.log("all stories in local db already");
      }
    }
  } catch (e) {
    console.error("error loading stories:", e);
  }

  // UPDATE SCORES FOR TRENDING STORIES
  try {
    const now = Date.now();

    // Monthly: stories from last 28 days, not updated in 48h
    const monthTimeThreshold = now - 28 * 24 * 60 * 60 * 1000;
    const monthStaleThreshold = now - 48 * 60 * 60 * 1000;
    const monthStaleRows = db.prepare(
      `SELECT id FROM stories WHERE time > ? AND updated < ? ORDER BY updated ASC LIMIT ?`
    ).all(monthTimeThreshold, monthStaleThreshold, WORKER_BATCH_LIMIT);
    ctx.read("stories", monthStaleRows.length);
    const monthStaleIds = monthStaleRows.map(r => r.id);
    if (monthStaleIds.length > 0) {
      await Remote.updateStories(monthStaleIds, ctx);
      updatedCount += monthStaleIds.length;
    }

    // Weekly: stories from last 7 days, not updated in 6h
    const weekTimeThreshold = now - 7 * 24 * 60 * 60 * 1000;
    const weekStaleThreshold = now - 6 * 60 * 60 * 1000;
    const weekStaleRows = db.prepare(
      `SELECT id FROM stories WHERE time > ? AND updated < ? ORDER BY updated ASC LIMIT ?`
    ).all(weekTimeThreshold, weekStaleThreshold, WORKER_BATCH_LIMIT);
    ctx.read("stories", weekStaleRows.length);
    const weekStaleIds = weekStaleRows.map(r => r.id);
    if (weekStaleIds.length > 0) {
      await Remote.updateStories(weekStaleIds, ctx);
      updatedCount += weekStaleIds.length;
    }

    // Daily: stories from last 24h, not updated in 1h
    const dayTimeThreshold = now - 24 * 60 * 60 * 1000;
    const dayStaleThreshold = now - 60 * 60 * 1000;
    const dayStaleRows = db.prepare(
      `SELECT id FROM stories WHERE time > ? AND updated < ? ORDER BY updated ASC LIMIT ?`
    ).all(dayTimeThreshold, dayStaleThreshold, WORKER_BATCH_LIMIT);
    ctx.read("stories", dayStaleRows.length);
    const dayStaleIds = dayStaleRows.map(r => r.id);
    if (dayStaleIds.length > 0) {
      await Remote.updateStories(dayStaleIds, ctx);
      updatedCount += dayStaleIds.length;
    }
  } catch (e) {
    console.error("error updating stories:", e);
  }

  const memoryUsage = process.memoryUsage();
  ctx.log("WORKER sync", {
    new: newCount,
    updated: updatedCount,
    rss: formatBytes(memoryUsage.rss),
    heap: formatBytes(memoryUsage.heapUsed),
  });
};

const main = async () => {
  try {
    while (true) {
      console.log("Starting background sync job...");
      await syncOnce();
      await sleep(15 * 60 * 1000);
    }
  } catch (e) {
    console.error("fatal error:", e);
  }
};

if (require.main === module) {
  main();
}

module.exports = { main, syncOnce, formatBytes, sleep, WORKER_BATCH_LIMIT };
