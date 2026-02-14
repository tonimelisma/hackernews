const axios = require("axios");
const { storiesCollection, padId } = require("./firestore");

const newStoriesUrl =
  "https://hacker-news.firebaseio.com/v0/newstories.json?print=pretty";

const itemUrl = item =>
  `https://hacker-news.firebaseio.com/v0/item/${item}.json?print=pretty`;

const loginUrl = "https://news.ycombinator.com/login";

const dailyTopStoriesUrl = "https://www.hntoplinks.com/today/";
const weeklyTopStoriesUrl = "https://www.hntoplinks.com/week/";
const monthlyTopStoriesUrl = "https://www.hntoplinks.com/month/";
const yearlyTopStoriesUrl = "https://www.hntoplinks.com/year/";
const alltimeTopStoriesUrl = "https://www.hntoplinks.com/all/";

const login = async (goto, acct, pw) => {
  const response = await axios.post(
    loginUrl,
    new URLSearchParams({ goto, acct, pw }),
    { withCredentials: true }
  );
  if (response.status === 200) {
    if (response.request.path === "/login") {
      console.error("login failed (redirected to /login):", response.status);
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
    let moreItems = true;
    let i = 0;
    const ids = [];
    while (moreItems && i < 15) {
      i++;
      const page = await axios.get(url + i);

      if (page.data.includes("No more items")) moreItems = false;

      const articles = page.data.match(/score_[0-9]+/g);
      if (articles) ids.push(...articles.map(x => x.replace(/^\D+/g, "")));
    }

    return [...new Set(ids)];
  } catch (e) {
    console.error("getTopStories error:", e);
    return [];
  }
};

const getNewStories = async () => {
  try {
    const newStories = await axios.get(newStoriesUrl);
    return newStories.data;
  } catch (e) {
    console.error("getNewStories error:", e);
    return [];
  }
};

const getItem = async itemId => {
  try {
    const itemData = await axios.get(itemUrl(itemId));
    return itemData.data;
  } catch (e) {
    console.error("getItem error:", e);
  }
};

const BATCH_SIZE = 20;

const getItems = async itemIdList => {
  const results = [];
  for (let i = 0; i < itemIdList.length; i += BATCH_SIZE) {
    const batch = itemIdList.slice(i, i + BATCH_SIZE);
    const promiseArray = batch.map(async storyId => {
      const storyData = await getItem(storyId);
      if (storyData) {
        return storyData;
      }
    });
    const batchResults = await Promise.all(promiseArray);
    results.push(...batchResults.filter(Boolean));
  }
  return results;
};

const checkStoryExists = async storyIdList => {
  const missingStories = [];
  for (let i = 0; i < storyIdList.length; i += BATCH_SIZE) {
    const batch = storyIdList.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async storyId => {
        const doc = await storiesCollection().doc(padId(storyId)).get();
        return { storyId, exists: doc.exists };
      })
    );
    for (const { storyId, exists } of results) {
      if (!exists) missingStories.push(storyId);
    }
  }
  return missingStories;
};

const addStories = async storyIdList => {
  const latestRemoteStoryData = await getItems(storyIdList);

  for (let i = 0; i < latestRemoteStoryData.length; i += BATCH_SIZE) {
    const batch = latestRemoteStoryData.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async storyData => {
        try {
          if (storyData) {
            return storiesCollection().doc(padId(storyData.id)).set({
              by: storyData.by,
              descendants: storyData.descendants,
              id: storyData.id,
              kids: storyData.kids,
              score: storyData.score,
              time: new Date(storyData.time * 1000),
              title: storyData.title,
              url: storyData.url,
              updated: new Date()
            });
          }
        } catch (e) {
          console.error("addStories set error:", e, storyData);
        }
      })
    );
  }
};

const updateStories = async storyIdList => {
  const latestRemoteStoryData = await getItems(storyIdList);

  for (let i = 0; i < latestRemoteStoryData.length; i += BATCH_SIZE) {
    const batch = latestRemoteStoryData.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async storyData => {
        try {
          if (storyData) {
            return storiesCollection().doc(padId(storyData.id)).update({
              descendants: storyData.descendants,
              kids: storyData.kids,
              score: storyData.score,
              updated: new Date()
            });
          }
        } catch (e) {
          console.error("updateStories update error:", e, storyData);
        }
      })
    );
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
