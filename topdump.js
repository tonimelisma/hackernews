// this is a one-off script to populate the database with top HN articles from hntoplinks.com
const Remote = require("./services/hackernews");

const main = async () => {
  try {
    console.log("Starting web scraping...");

    let ids = [];
    ids.push(...await Remote.getTopStories("daily"));
    ids.push(...await Remote.getTopStories("weekly"));
    ids.push(...await Remote.getTopStories("monthly"));
    ids.push(...await Remote.getTopStories("yearly"));
    ids.push(...await Remote.getTopStories("alltime"));

    const missingStories = await Remote.checkStoryExists(ids);

    console.log("fetching: ", missingStories);

    await Remote.addStories(missingStories);

    console.log("Done!");
  } catch (e) {
    console.log("err: ", e);
  }
};

main();
