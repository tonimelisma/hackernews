const up = (db) => {
  db.exec(`
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

const down = (db) => {
  db.exec(`
    DROP TABLE IF EXISTS hidden;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS stories;
  `);
};

module.exports = { up, down };
