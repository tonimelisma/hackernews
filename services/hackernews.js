const axios = require("axios");
const { getDb } = require("./database");

const newStoriesUrl =
  "https://hacker-news.firebaseio.com/v0/newstories.json?print=pretty";
const topStoriesUrl =
  "https://hacker-news.firebaseio.com/v0/topstories.json?print=pretty";
const bestStoriesUrl =
  "https://hacker-news.firebaseio.com/v0/beststories.json?print=pretty";

const itemUrl = item =>
  `https://hacker-news.firebaseio.com/v0/item/${item}.json?print=pretty`;

const loginUrl = "https://news.ycombinator.com/login";

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

const getAllStoryIds = async () => {
  try {
    const [newRes, topRes, bestRes] = await Promise.all([
      axios.get(newStoriesUrl),
      axios.get(topStoriesUrl),
      axios.get(bestStoriesUrl),
    ]);
    const combined = [
      ...(newRes.data || []),
      ...(topRes.data || []),
      ...(bestRes.data || []),
    ];
    return [...new Set(combined)];
  } catch (e) {
    console.error("getAllStoryIds error:", e);
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

const checkStoryExists = async (storyIdList, ctx) => {
  const db = getDb();
  const missingStories = [];
  const placeholders = storyIdList.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id FROM stories WHERE id IN (${placeholders})`).all(...storyIdList);
  ctx?.read("stories", rows.length);
  const existingIds = new Set(rows.map(r => r.id));
  for (const id of storyIdList) {
    if (!existingIds.has(id)) {
      missingStories.push(id);
    }
  }
  return missingStories;
};

const addStories = async (storyIdList, ctx) => {
  const latestRemoteStoryData = await getItems(storyIdList);
  const db = getDb();

  const insert = db.prepare(
    `INSERT OR REPLACE INTO stories (id, by, descendants, kids, score, time, title, url, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction((stories) => {
    for (const storyData of stories) {
      if (storyData) {
        try {
          insert.run(
            storyData.id,
            storyData.by || null,
            storyData.descendants || null,
            storyData.kids ? JSON.stringify(storyData.kids) : null,
            storyData.score || null,
            storyData.time * 1000,
            storyData.title || null,
            storyData.url || null,
            Date.now()
          );
          ctx?.write("stories", 1);
        } catch (e) {
          console.error("addStories insert error:", e, storyData);
        }
      }
    }
  });

  insertMany(latestRemoteStoryData);
  ctx?.query("stories", `addStories batch size=${latestRemoteStoryData.length}`, latestRemoteStoryData.length, 0);
};

const updateStories = async (storyIdList, ctx) => {
  const latestRemoteStoryData = await getItems(storyIdList);
  const db = getDb();
  const updated = [];

  const update = db.prepare(
    `UPDATE stories SET descendants = ?, kids = COALESCE(?, kids), score = ?, updated = ?
     WHERE id = ?`
  );

  const updateMany = db.transaction((stories) => {
    for (const storyData of stories) {
      if (storyData) {
        try {
          update.run(
            storyData.descendants !== undefined ? storyData.descendants : null,
            storyData.kids ? JSON.stringify(storyData.kids) : null,
            storyData.score !== undefined ? storyData.score : null,
            Date.now(),
            storyData.id
          );
          ctx?.write("stories", 1);
          if (storyData.score !== undefined && storyData.score !== null) {
            updated.push({ id: storyData.id, score: storyData.score, descendants: storyData.descendants });
          }
        } catch (e) {
          console.error("updateStories update error:", e, storyData);
        }
      }
    }
  });

  updateMany(latestRemoteStoryData);
  ctx?.query("stories", `updateStories batch size=${latestRemoteStoryData.length}`, latestRemoteStoryData.length, 0);

  return updated;
};

module.exports = {
  getAllStoryIds,
  getItem,
  getItems,
  addStories,
  updateStories,
  checkStoryExists,
  login
};
