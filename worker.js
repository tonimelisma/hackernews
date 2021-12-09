const config = require("./util/config");

const Stories = require("./models/stories");
const Comments = require("./models/comments");
const Remote = require("./services/hackernews");

const mongoose = require("mongoose");
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
    console.log("Connecting to mongodb...");
    await mongoose.connect(config.DB_URI, {
    });
    console.log("Connected!");
  } catch (e) {
    console.log("Couldn't connect: ", e);
  }

  try {
    while (true) {
      console.log("Starting background sync job...");

      // LADATAAN UUSIMMAT TARINAT
      try {
        const latestLocalStory = await Stories.findOne().sort({
          id: -1
        });
        const latestRemoteStoryIds = await Remote.getNewStories();

        if (!latestLocalStory) {
          console.log("empty db, bootstrapping...");
          await Remote.addStories(latestRemoteStoryIds);
        } else if (latestLocalStory.id < latestRemoteStoryIds[0]) {
          console.log(
            "updates available: ",
            latestLocalStory.id,
            "<",
            latestRemoteStoryIds[0]
          );
          const filterNewStories = checkStoryId => {
            return checkStoryId > latestLocalStory.id;
          };
          const newStoryIds = latestRemoteStoryIds.filter(filterNewStories);
          await Remote.addStories(newStoryIds);
        } else {
          console.log("all stories in local db already");
        }
      } catch (e) {
        console.log("err: ", e);
      }

      // UPDATE SCORES FOR TRENDING DAILY STORIES
      try {
        console.log("updating all stories updated more than 14d ago");
        const lastEverStories = await Stories.find({
          updated: { $lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
        });
        if (lastEverStories.length > 0) {
          await Remote.updateStories(lastEverStories.map(x => x.id));
        } else {
          console.log("...none to update");
        }

        console.log("updating last month stories updated more than 24h ago");
        const lastMonthStories = await Stories.find({
          $and: [
            { time: { $gt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000) } },
            { updated: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
          ]
        });
        if (lastMonthStories.length > 0) {
          await Remote.updateStories(lastMonthStories.map(x => x.id));
        } else {
          console.log("...none to update");
        }

        console.log("updating weekly stories updated more than 60m ago");
        const lastWeekStories = await Stories.find({
          $and: [
            { time: { $gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
            { updated: { $lt: new Date(Date.now() - 60 * 60 * 1000) } }
          ]
        });
        if (lastWeekStories.length > 0) {
          await Remote.updateStories(lastWeekStories.map(x => x.id));
        } else {
          console.log("...none to update");
        }

        console.log("updating daily stories updated more than 15m ago");
        const last24hStories = await Stories.find({
          $and: [
            { time: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
            { updated: { $lt: new Date(Date.now() - 15 * 60 * 1000) } }
          ]
        });
        if (last24hStories.length > 0) {
          await Remote.updateStories(last24hStories.map(x => x.id));
        } else {
          console.log("...none to update");
        }
      } catch (e) {
        console.log("whoops: ", e);
      }

      // DELETE OLD STORIES THAT DIDN'T MAKE IT
      try {
        console.log("deleting old stories...");
        const daily = await Stories.deleteMany({
          $and: [
            { time: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
            { score: { $lt: config.minDayScore } }
          ]
        });
        console.log("daily: ", daily.n, ",", daily.ok, ",", daily.deletedCount);

        const weekly = await Stories.deleteMany({
          $and: [
            { time: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
            { score: { $lt: config.minWeekScore } }
          ]
        });
        console.log(
          "weekly: ",
          weekly.n,
          ",",
          weekly.ok,
          ",",
          weekly.deletedCount
        );

        const monthly = await Stories.deleteMany({
          $and: [
            { time: { $lt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000) } },
            { score: { $lt: config.minMonthScore } }
          ]
        });
        console.log(
          "monthly: ",
          monthly.n,
          ",",
          monthly.ok,
          ",",
          monthly.deletedCount
        );

        const yearly = await Stories.deleteMany({
          $and: [
            { time: { $lt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) } },
            { score: { $lt: config.minYearScore } }
          ]
        });
        console.log(
          "yearly: ",
          yearly.n,
          ",",
          yearly.ok,
          ",",
          yearly.deletedCount
        );
      } catch (e) {
        console.log("ei onnistunut: ", e);
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

    // CLOSE CONNECTION
  } finally {
    try {
      await mongoose.connection.close();
      console.log("closed connection");
    } catch (e) {
      console.log("Couldn't close connection: ", e);
    }
  }
};

throng(1, main);
