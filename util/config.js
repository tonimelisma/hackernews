require("dotenv").config();

const DB_URI =
  process.env.NODE_ENV === "test"
    ? process.env.DB_URI_TEST
    : process.env.DB_URI_PROD;

const DB_URI_CLOUD = process.env.DB_URI_CLOUD;

const minDayScore = 10; // a bit over 100 stories a day
const minWeekScore = 20; // 40; // over 300 stories a week over
const minMonthScore = 30; // 100; // over 300 stories a month over

const limitResults = 500;

module.exports = {
  DB_URI,
  DB_URI_CLOUD,
  minDayScore,
  minWeekScore,
  minMonthScore,
  limitResults
};
