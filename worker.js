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
    const latestSnap = await storiesCollection()
      .orderBy("id", "desc")
      .limit(1)
      .get();
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
  try {
    const lastMonthSnap = await storiesCollection()
      .where("time", ">", new Date(Date.now() - 28 * 24 * 60 * 60 * 1000))
      .where("updated", "<", new Date(Date.now() - 48 * 60 * 60 * 1000))
      .orderBy("updated", "asc")
      .limit(WORKER_BATCH_LIMIT)
      .get();
    ctx.read("stories", lastMonthSnap.docs.length);
    if (!lastMonthSnap.empty) {
      await Remote.updateStories(lastMonthSnap.docs.map(d => d.data().id));
      ctx.write("stories", lastMonthSnap.docs.length);
      updatedCount += lastMonthSnap.docs.length;
    }

    const lastWeekSnap = await storiesCollection()
      .where("time", ">", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      .where("updated", "<", new Date(Date.now() - 6 * 60 * 60 * 1000))
      .orderBy("updated", "asc")
      .limit(WORKER_BATCH_LIMIT)
      .get();
    ctx.read("stories", lastWeekSnap.docs.length);
    if (!lastWeekSnap.empty) {
      await Remote.updateStories(lastWeekSnap.docs.map(d => d.data().id));
      ctx.write("stories", lastWeekSnap.docs.length);
      updatedCount += lastWeekSnap.docs.length;
    }

    const last24hSnap = await storiesCollection()
      .where("time", ">", new Date(Date.now() - 24 * 60 * 60 * 1000))
      .where("updated", "<", new Date(Date.now() - 60 * 60 * 1000))
      .orderBy("updated", "asc")
      .limit(WORKER_BATCH_LIMIT)
      .get();
    ctx.read("stories", last24hSnap.docs.length);
    if (!last24hSnap.empty) {
      await Remote.updateStories(last24hSnap.docs.map(d => d.data().id));
      ctx.write("stories", last24hSnap.docs.length);
      updatedCount += last24hSnap.docs.length;
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
