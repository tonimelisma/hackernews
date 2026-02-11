const { storiesCollection, usersCollection, padId } = require("./firestore");

const getHidden = async (reqUsername) => {
  const userDoc = await usersCollection().doc(reqUsername).get();
  if (!userDoc.exists) {
    return [];
  }
  const hiddenSnap = await usersCollection()
    .doc(reqUsername)
    .collection("hidden")
    .get();
  return hiddenSnap.docs.map((doc) => Number(doc.id));
};

const upsertHidden = async (reqUsername, reqHidden) => {
  await usersCollection().doc(reqUsername).set({}, { merge: true });
  await usersCollection()
    .doc(reqUsername)
    .collection("hidden")
    .doc(String(reqHidden))
    .set({ addedAt: Date.now() });
};

const upsertUser = async (loginUsername) => {
  await usersCollection().doc(loginUsername).set({}, { merge: true });
};

const getStories = async (timespan, limit, skip = undefined) => {
  let timespanDate;
  switch (timespan) {
    case "Day":
      timespanDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      break;
    case "Week":
      timespanDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "Month":
      timespanDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
      break;
    case "Year":
      timespanDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      break;
  }

  let query = storiesCollection();
  if (timespan !== "All" && timespanDate) {
    query = query.where("time", ">", timespanDate);
  }

  const snapshot = await query.get();
  let stories = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      by: data.by,
      descendants: data.descendants,
      id: data.id,
      score: data.score,
      time: data.time,
      title: data.title,
      url: data.url,
    };
  });

  // Client-side sort by score descending
  stories.sort((a, b) => b.score - a.score);

  // Apply skip and limit
  const skipN = isNaN(skip) ? 0 : skip;
  stories = stories.slice(skipN, skipN + limit);

  return stories;
};

module.exports = { getStories, upsertUser, upsertHidden, getHidden };
