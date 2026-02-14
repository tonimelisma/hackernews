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
  try {
    const response = await axios.post(
      loginUrl,
      new URLSearchParams({ goto, acct, pw }).toString(),
      {
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      }
    );
    // HN returns 302 on both success and failure:
    //   success → Location points to the goto page (e.g. "news")
    //   failure → Location points back to "login"
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location || "";
      if (location.includes("login")) {
        console.error("login failed (HN redirected back to login)");
        return false;
      }
      return true;
    }
    // No redirect — treat as failure
    console.error("login: unexpected response status", response.status);
    return false;
  } catch (e) {
    console.error("login request error:", e.message);
    return false;
  }
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
  }
};

const getNewStories = async () => {
  try {
    const newStories = await axios.get(newStoriesUrl);
    return newStories.data;
  } catch (e) {
    console.error("getNewStories error:", e);
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

const getItems = async itemIdList => {
  const promiseArray = itemIdList.map(async storyId => {
    const storyData = await getItem(storyId);
    if (storyData) {
      return storyData;
    }
  });
  const itemDataList = await Promise.all(promiseArray);
  return itemDataList.filter(Boolean);
};

const checkStoryExists = async storyIdList => {
  const promiseArray = storyIdList.map(async storyId => {
    const doc = await storiesCollection().doc(padId(storyId)).get();
    return doc.exists;
  });
  const results = await Promise.all(promiseArray);

  const missingStories = [];
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
  });
  try {
    await Promise.all(promiseArray);
  } catch (e) {
    console.error("addStories batch error:", e);
  }
};

const updateStories = async storyIdList => {
  const latestRemoteStoryData = await getItems(storyIdList);

  const promiseArray = latestRemoteStoryData.map(async storyData => {
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
  });
  try {
    await Promise.all(promiseArray);
  } catch (e) {
    console.error("updateStories batch error:", e);
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
