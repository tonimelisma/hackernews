const axios = require("axios");
const Stories = require("../models/stories");
const qs = require("qs");

const newStoriesUrl =
  "https://hacker-news.firebaseio.com/v0/newstories.json?print=pretty";

const itemUrl = async item => {
  return String(
    `https://hacker-news.firebaseio.com/v0/item/${item}.json?print=pretty`
  );
};

const loginUrl = "https://news.ycombinator.com/login";

const dailyTopStoriesUrl = "http://www.hntoplinks.com/today/";
const weeklyTopStoriesUrl = "http://www.hntoplinks.com/week/";
const monthlyTopStoriesUrl = "http://www.hntoplinks.com/month/";
const yearlyTopStoriesUrl = "http://www.hntoplinks.com/year/";
const alltimeTopStoriesUrl = "http://www.hntoplinks.com/all/";

const login = async (goto, acct, pw) => {
  const response = await axios.post(
    loginUrl,
    qs.stringify({ goto, acct, pw }),
    { withCredentials: true }
  );
  if (response.status === 200) {
    if (response.request.path === "/login") {
      console.log("whoops: ", response);
      return false;
    } else if (response.request.path === "/news") {
      return true;
    }
  }
  return false;
};

const getTopStories = async time => {
  try {
    let url = "";
    switch (time) {
      case "weekly":
        url = weeklyTopStoriesUrl;
        break;
      case "monthly":
        url = monthlyTopStoriesUrl;
        break;
      case "yearly":
        url = yearlyTopStoriesUrl;
        break;
      case "alltime":
        url = alltimeTopStoriesUrl;
        break;
      case "daily":
      default:
        url = dailyTopStoriesUrl;
        break;
    }
    console.log("getting url: ", url);

    let moreItems = true;
    let i = 0;
    let ids = [];
    while (moreItems && i < 15) {
      i++;
      const page = await axios.get(url + i);

      if (page.data.includes("No more items")) moreItems = false;

      var articles = page.data.match(/score_[0-9]+/g);
      if (articles) ids.push(...articles.map(x => x.replace(/^\D+/g, "")));

      console.log("url: ", url + i);
    }

    // TODO deduplicate ids
    return ids;
  } catch (e) {
    console.log("oops: ", e);
  }
};

const getNewStories = async () => {
  try {
    const newStories = await axios.get(newStoriesUrl);
    return newStories.data;
  } catch (e) {
    console.log("oops: ", e);
  }
};

const getItem = async itemId => {
  try {
    const itemData = await axios.get(String(await itemUrl(itemId)));
    return itemData.data;
  } catch (e) {
    console.log("oops2: ", e);
  }
};

const getItems = async itemIdList => {
  const promiseArray = itemIdList.map(async storyId => {
    const storyData = await getItem(storyId);
    if (storyData !== null) {
      return storyData;
    }
  });
  const itemDataList = await Promise.all(promiseArray);
  return itemDataList;
};

const checkStoryExists = async storyIdList => {
  // this function is kind of nasty, but you can't use async/await with map/filter
  const promiseArray = storyIdList.map(async storyId => {
    const promise = Stories.countDocuments({ id: storyId });
    return promise;
  });
  const results = await Promise.all(promiseArray);

  let missingStories = [];
  for (let i = 0; i < storyIdList.length; i++) {
    if (!results[i]) missingStories.push(storyIdList[i]);
  }
  return missingStories;
};

const addStories = async storyIdList => {
  const latestRemoteStoryData = await getItems(storyIdList);

  const promiseArray = latestRemoteStoryData.map(async storyData => {
    try {
      if (storyData) {
        const newStory = new Stories({
          by: storyData.by,
          descendants: storyData.descendants,
          id: storyData.id,
          kids: storyData.kids,
          score: storyData.score,
          time: storyData.time * 1000,
          title: storyData.title,
          type: storyData.type,
          url: storyData.url,
          updated: Date.now()
        });
        return newStory.save();
      }
    } catch (e) {
      console.log("oops3: ", e);
      console.log("opp: ", storyData);
    }
  });
  try {
    await Promise.all(promiseArray);
  } catch (e) {
    console.log("oops4: ", e);
  }
};

const updateStories = async storyIdList => {
  const latestRemoteStoryData = await getItems(storyIdList);

  const promiseArray = latestRemoteStoryData.map(async storyData => {
    try {
      if (storyData) {
        return Stories.findOneAndUpdate(
          { id: storyData.id },
          {
            descendants: storyData.descendants,
            kids: storyData.kids,
            score: storyData.score,
            updated: Date.now()
          }
        );
      }
    } catch (e) {
      console.log("oops7: ", e);
      console.log("opp: ", storyData);
    }
  });
  try {
    await Promise.all(promiseArray);
  } catch (e) {
    console.log("oops8: ", e);
  }
};

module.exports = {
  getNewStories,
  getTopStories,
  getItem,
  getItems,
  addStories,
  updateStories,
  checkStoryExists,
  login
};
