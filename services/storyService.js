const config = require("../util/config");
const Stories = require("../models/stories");
const Users = require("../models/users");
const mongoose = require("mongoose");

console.log("Connecting to mongodb...");
mongoose
  .connect(config.DB_URI, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false,
    useUnifiedTopology: true,
    family: 4
  })
  .then(result => {
    console.log("Connected!");
  })
  .catch(e => {
    console.log("Couldn't connect: ", e);
  });

const getHidden = async reqUsername => {
  const userDocument = await Users.findOne({ username: reqUsername });
  return userDocument.hidden;
};

const upsertHidden = async (reqUsername, reqHidden) => {
  const writeResult = await Users.updateOne(
    { username: reqUsername },
    { $addToSet: { hidden: reqHidden } },
    { upsert: true }
  );
  if (!writeResult.ok) {
    console.log(
      "error with user upsert:",
      reqUsername,
      ":",
      reqHidden,
      ":",
      writeResult
    );
  }
};

const upsertUser = async loginUsername => {
  const writeResult = await Users.updateOne(
    { username: loginUsername },
    { username: loginUsername },
    { upsert: true }
  );
  if (!writeResult.ok) {
    console.log("error with user upsert:", loginUsername, ":", writeResult);
  }
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

  if (isNaN(skip)) {
    const ret =
      timespan === "All"
        ? await Stories.find(
            {},
            {
              by: 1,
              descendants: 1,
              id: 1,
              score: 1,
              time: 1,
              title: 1,
              url: 1,
              _id: 0
            }
          )
            .sort({ score: -1 })
            .limit(limit)
        : await Stories.find(
            {
              time: { $gt: timespanDate }
            },
            {
              by: 1,
              descendants: 1,
              id: 1,
              score: 1,
              time: 1,
              title: 1,
              url: 1,
              _id: 0
            }
          )
            .sort({ score: -1 })
            .limit(limit);

    return ret;
  } else {
    const ret =
      timespan === "All"
        ? await Stories.find(
            {},
            {
              by: 1,
              descendants: 1,
              id: 1,
              score: 1,
              time: 1,
              title: 1,
              url: 1,
              _id: 0
            }
          )
            .sort({ score: -1 })
            .skip(skip)
            .limit(limit)
        : await Stories.find(
            {
              time: { $gt: timespanDate }
            },
            {
              by: 1,
              descendants: 1,
              id: 1,
              score: 1,
              time: 1,
              title: 1,
              url: 1,
              _id: 0
            }
          )
            .sort({ score: -1 })
            .skip(skip)
            .limit(limit);

    return ret;
  }
};

module.exports = { getStories, upsertUser, upsertHidden, getHidden };
