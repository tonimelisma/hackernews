const { storiesCollection, padId } = require("./services/firestore");
const Remote = require("./services/hackernews");

const throng = require("throng");

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


const main = async () => {
  try {
    while (true) {
      console.log("Starting background sync job...");

      // LOAD LATEST STORIES
      try {
        // Find latest story by doc ID (zero-padded, so lexicographic = numeric order)
        const latestSnap = await storiesCollection()
          .orderBy("id", "desc")
          .limit(1)
          .get();

        const latestRemoteStoryIds = await Remote.getNewStories();

        if (latestSnap.empty) {
          console.log("empty db, bootstrapping...");
          await Remote.addStories(latestRemoteStoryIds);
        } else {
          const latestLocalId = latestSnap.docs[0].data().id;
          if (latestLocalId < latestRemoteStoryIds[0]) {
            console.log(
              "updates available: ",
              latestLocalId,
              "<",
              latestRemoteStoryIds[0]
            );
            const newStoryIds = latestRemoteStoryIds.filter(
              checkStoryId => checkStoryId > latestLocalId
            );
            await Remote.addStories(newStoryIds);
          } else {
            console.log("all stories in local db already");
          }
        }
      } catch (e) {
        console.log("err: ", e);
      }

      // UPDATE SCORES FOR TRENDING STORIES
      try {
        console.log("updating all stories updated more than 14d ago");
        const lastEverSnap = await storiesCollection()
          .where("updated", "<", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000))
          .get();
        if (!lastEverSnap.empty) {
          await Remote.updateStories(lastEverSnap.docs.map(d => d.data().id));
        } else {
          console.log("...none to update");
        }

        console.log("updating last month stories updated more than 24h ago");
        const lastMonthSnap = await storiesCollection()
          .where("time", ">", new Date(Date.now() - 28 * 24 * 60 * 60 * 1000))
          .where("updated", "<", new Date(Date.now() - 24 * 60 * 60 * 1000))
          .get();
        if (!lastMonthSnap.empty) {
          await Remote.updateStories(lastMonthSnap.docs.map(d => d.data().id));
        } else {
          console.log("...none to update");
        }

        console.log("updating weekly stories updated more than 60m ago");
        const lastWeekSnap = await storiesCollection()
          .where("time", ">", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
          .where("updated", "<", new Date(Date.now() - 60 * 60 * 1000))
          .get();
        if (!lastWeekSnap.empty) {
          await Remote.updateStories(lastWeekSnap.docs.map(d => d.data().id));
        } else {
          console.log("...none to update");
        }

        console.log("updating daily stories updated more than 15m ago");
        const last24hSnap = await storiesCollection()
          .where("time", ">", new Date(Date.now() - 24 * 60 * 60 * 1000))
          .where("updated", "<", new Date(Date.now() - 15 * 60 * 1000))
          .get();
        if (!last24hSnap.empty) {
          await Remote.updateStories(last24hSnap.docs.map(d => d.data().id));
        } else {
          console.log("...none to update");
        }
      } catch (e) {
        console.log("whoops: ", e);
      }

      const memoryUsage = process.memoryUsage();
      console.log("memory usage: rss:", formatBytes(memoryUsage.rss), "heapTotal:",
        formatBytes(memoryUsage.heapTotal),
        "heapUsed:",
        formatBytes(memoryUsage.heapUsed),
        "external:",
        formatBytes(memoryUsage.external),
        "arrayBuffers:",
        formatBytes(memoryUsage.arrayBuffers)
      );
      console.log("");

      await sleep(10 * 60 * 1000);
    }
  } catch (e) {
    console.log("Fatal error: ", e);
  }
};

throng(1, main);
