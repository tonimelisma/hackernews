const { Firestore } = require("@google-cloud/firestore");

let db;

const getDb = () => {
  if (!db) {
    db = new Firestore({
      projectId: "melisma-hackernews",
    });
  }
  return db;
};

const setDb = (newDb) => {
  db = newDb;
};

const getCollectionPrefix = () => {
  if (process.env.NODE_ENV === "production") return "prod";
  if (process.env.NODE_ENV === "ci") return "ci";
  return "dev";
};

const storiesCollection = () =>
  getDb().collection(`${getCollectionPrefix()}-stories`);

const usersCollection = () =>
  getDb().collection(`${getCollectionPrefix()}-users`);

const padId = (id) => String(id).padStart(10, "0");

module.exports = {
  getDb,
  setDb,
  getCollectionPrefix,
  storiesCollection,
  usersCollection,
  padId,
};
