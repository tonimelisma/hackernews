// this is a one-off script to populate the database with top HN articles from hntoplinks.com
const config = require("./util/config");

const Stories = require("./models/stories");
const Remote = require("./services/hackernews");

const mongoose = require("mongoose");

const main = async () => {
  try {
    console.log("Connecting to mongodb...");
    await mongoose.connect(config.DB_URI_CLOUD, {
      useNewUrlParser: true,
      useCreateIndex: true,
      useFindAndModify: false
    });
    console.log("Connected!");
  } catch (e) {
    console.log("Couldn't connect: ", e);
  }

  try {
    console.log("Starting web scraping...");

    // LADATAAN UUSIMMAT TARINAT
    try {
      let ids = [];
      ids.push(...await Remote.getTopStories("daily"));
      ids.push(...await Remote.getTopStories("weekly"));
      ids.push(...await Remote.getTopStories("monthly"));
      ids.push(...await Remote.getTopStories("yearly"));
      ids.push(...await Remote.getTopStories("alltime"));

      const missingStories = await Remote.checkStoryExists(ids);

      console.log("fetching: ", missingStories);

      await Remote.addStories(missingStories);
    } catch (e) {
      console.log("err: ", e);
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

main();
