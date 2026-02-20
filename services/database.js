const Database = require("better-sqlite3");
const path = require("path");
const { runMigrations } = require("./migrator");

let db;

const getDb = () => {
  if (!db) {
    const dbPath = process.env.SQLITE_PATH || path.join(__dirname, "..", "data", "hackernews.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  }
  return db;
};

const setDb = (newDb) => {
  db = newDb;
};

const initSchema = (database) => {
  runMigrations(database);
};

module.exports = { getDb, setDb, initSchema };
