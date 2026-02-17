#!/usr/bin/env node

/**
 * Import stories and users/hidden from JSON exports into SQLite.
 *
 * Usage:
 *   node scripts/import-json-to-sqlite.js [output.db]
 *
 * Reads:
 *   scripts/data/stories.json   — array of story objects (from MongoDB/Firestore export)
 *   scripts/data/users.json     — array of { username, hidden: [id, ...] }
 *
 * Writes:
 *   output.db (default: data/hackernews.db)
 */

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const outputPath = process.argv[2] || path.join(__dirname, "..", "data", "hackernews.db");
const storiesPath = path.join(__dirname, "data", "stories.json");
const usersPath = path.join(__dirname, "data", "users.json");

// Ensure output directory exists
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log("Opening database:", outputPath);
const db = new Database(outputPath);
db.pragma("journal_mode = WAL");

// Create schema
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

// Import stories
if (fs.existsSync(storiesPath)) {
  console.log("Reading stories from:", storiesPath);
  const stories = JSON.parse(fs.readFileSync(storiesPath, "utf-8"));
  console.log(`Found ${stories.length} stories`);

  const insert = db.prepare(
    `INSERT OR REPLACE INTO stories (id, by, descendants, kids, score, time, title, url, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction((items) => {
    for (const s of items) {
      // Handle various time formats from different exports
      let timeMs;
      if (s.time && typeof s.time === "object" && s.time._seconds) {
        timeMs = s.time._seconds * 1000;
      } else if (s.time && typeof s.time === "object" && s.time.$date) {
        timeMs = new Date(s.time.$date).getTime();
      } else if (typeof s.time === "number") {
        // If < 10 billion, it's seconds; otherwise ms
        timeMs = s.time < 10000000000 ? s.time * 1000 : s.time;
      } else {
        timeMs = new Date(s.time).getTime();
      }

      let updatedMs = Date.now();
      if (s.updated && typeof s.updated === "object" && s.updated._seconds) {
        updatedMs = s.updated._seconds * 1000;
      } else if (s.updated && typeof s.updated === "number") {
        updatedMs = s.updated < 10000000000 ? s.updated * 1000 : s.updated;
      }

      insert.run(
        s.id,
        s.by || null,
        s.descendants || null,
        s.kids ? JSON.stringify(s.kids) : null,
        s.score || null,
        timeMs,
        s.title || null,
        s.url || null,
        updatedMs
      );
    }
  });

  insertMany(stories);
  console.log(`Imported ${stories.length} stories`);
} else {
  console.log("No stories.json found at", storiesPath);
}

// Import users + hidden
if (fs.existsSync(usersPath)) {
  console.log("Reading users from:", usersPath);
  const users = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
  console.log(`Found ${users.length} users`);

  const insertUser = db.prepare("INSERT OR IGNORE INTO users (username) VALUES (?)");
  const insertHidden = db.prepare("INSERT OR IGNORE INTO hidden (username, story_id) VALUES (?, ?)");

  const importUsers = db.transaction((items) => {
    for (const user of items) {
      insertUser.run(user.username);
      if (user.hidden && Array.isArray(user.hidden)) {
        for (const storyId of user.hidden) {
          insertHidden.run(user.username, storyId);
        }
      }
    }
  });

  importUsers(users);
  let totalHidden = 0;
  for (const u of users) totalHidden += (u.hidden || []).length;
  console.log(`Imported ${users.length} users with ${totalHidden} hidden stories`);
} else {
  console.log("No users.json found at", usersPath);
}

db.close();
console.log("Done. Database at:", outputPath);
