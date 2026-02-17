const Database = require("better-sqlite3");
const path = require("path");

let db;

const getDb = () => {
  if (!db) {
    const dbPath = process.env.SQLITE_PATH || path.join(__dirname, "..", "data", "hackernews.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
};

const setDb = (newDb) => {
  db = newDb;
};

const initSchema = (database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY,
      by TEXT,
      descendants INTEGER,
      kids TEXT,
      score INTEGER,
      time INTEGER NOT NULL,
      title TEXT,
      url TEXT,
      updated INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stories_score ON stories(score DESC);
    CREATE INDEX IF NOT EXISTS idx_stories_time ON stories(time DESC);
    CREATE INDEX IF NOT EXISTS idx_stories_time_updated ON stories(time, updated);

    CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY);

    CREATE TABLE IF NOT EXISTS hidden (
      username TEXT NOT NULL,
      story_id INTEGER NOT NULL,
      added_at INTEGER DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (username, story_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hidden_username ON hidden(username);
  `);
};

module.exports = { getDb, setDb, initSchema };
