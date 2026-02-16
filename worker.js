const { storiesCollection } = require("./services/firestore");
const Remote = require("./services/hackernews");
const { createFirestoreContext } = require("./util/firestoreLogger");

const throng = require("throng");

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
}

const syncOnce = async () => {
  const ctx = createFirestoreContext();
  let newCount = 0;
  let updatedCount = 0;

  // LOAD LATEST STORIES
  try {
    // Find latest story by doc ID (zero-padded, so lexicographic = numeric order)
    const t0 = Date.now();
    const latestSnap = await storiesCollection()
      .orderBy("id", "desc")
      .limit(1)
      .get();
    ctx.query("stories", "latest orderBy=id:desc limit=1", latestSnap.docs.length, Date.now() - t0);
    ctx.read("stories", latestSnap.docs.length);

    const latestRemoteStoryIds = await Remote.getNewStories();

    if (latestSnap.empty) {
      console.log("empty db, bootstrapping...");
      await Remote.addStories(latestRemoteStoryIds);
      ctx.write("stories", latestRemoteStoryIds.length);
      newCount = latestRemoteStoryIds.length;
    } else {
      const latestLocalId = latestSnap.docs[0].data().id;
      if (latestLocalId < latestRemoteStoryIds[0]) {
        console.log("new stories available: local=%d remote=%d", latestLocalId, latestRemoteStoryIds[0]);
        const newStoryIds = latestRemoteStoryIds.filter(
          checkStoryId => checkStoryId > latestLocalId
        );
        await Remote.addStories(newStoryIds);
        ctx.write("stories", newStoryIds.length);
        newCount = newStoryIds.length;
      } else {
        console.log("all stories in local db already");
      }
    }
  } catch (e) {
    console.error("error loading stories:", e);
  }

  // UPDATE SCORES FOR TRENDING STORIES
  // Compound inequality queries: time > threshold AND updated < staleness
  // Requires composite index on (time ASC, updated ASC) for each collection
  try {
    const monthTimeThreshold = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    const t0m = Date.now();
    const lastMonthSnap = await storiesCollection()
      .where("time", ">", monthTimeThreshold)
      .where("updated", "<", new Date(Date.now() - 48 * 60 * 60 * 1000))
      .orderBy("updated", "asc")
      .limit(WORKER_BATCH_LIMIT)
      .get();
    ctx.query("stories", `stale-monthly time>${monthTimeThreshold.toISOString()} updated<48h`, lastMonthSnap.docs.length, Date.now() - t0m);
    ctx.read("stories", lastMonthSnap.docs.length);
    const monthStaleIds = lastMonthSnap.docs.map(d => d.data().id);
    if (monthStaleIds.length > 0) {
      await Remote.updateStories(monthStaleIds);
      ctx.write("stories", monthStaleIds.length);
      updatedCount += monthStaleIds.length;
    }

    const weekTimeThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const t0w = Date.now();
    const lastWeekSnap = await storiesCollection()
      .where("time", ">", weekTimeThreshold)
      .where("updated", "<", new Date(Date.now() - 6 * 60 * 60 * 1000))
      .orderBy("updated", "asc")
      .limit(WORKER_BATCH_LIMIT)
      .get();
    ctx.query("stories", `stale-weekly time>${weekTimeThreshold.toISOString()} updated<6h`, lastWeekSnap.docs.length, Date.now() - t0w);
    ctx.read("stories", lastWeekSnap.docs.length);
    const weekStaleIds = lastWeekSnap.docs.map(d => d.data().id);
    if (weekStaleIds.length > 0) {
      await Remote.updateStories(weekStaleIds);
      ctx.write("stories", weekStaleIds.length);
      updatedCount += weekStaleIds.length;
    }

    const dayTimeThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const t0d = Date.now();
    const last24hSnap = await storiesCollection()
      .where("time", ">", dayTimeThreshold)
      .where("updated", "<", new Date(Date.now() - 60 * 60 * 1000))
      .orderBy("updated", "asc")
      .limit(WORKER_BATCH_LIMIT)
      .get();
    ctx.query("stories", `stale-daily time>${dayTimeThreshold.toISOString()} updated<1h`, last24hSnap.docs.length, Date.now() - t0d);
    ctx.read("stories", last24hSnap.docs.length);
    const dayStaleIds = last24hSnap.docs.map(d => d.data().id);
    if (dayStaleIds.length > 0) {
      await Remote.updateStories(dayStaleIds);
      ctx.write("stories", dayStaleIds.length);
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
      await sleep(30 * 60 * 1000);
    }
  } catch (e) {
    console.error("fatal error:", e);
  }
};

if (require.main === module) {
  throng(1, main);
}

module.exports = { main, syncOnce, formatBytes, sleep, WORKER_BATCH_LIMIT };
