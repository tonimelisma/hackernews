#!/usr/bin/env node
// Seeds a throwaway SQLite database (SQLITE_PATH, which must be set and must
// not be the real data/hackernews.db) with sample stories and one test
// account, for scripts/preview.sh. Usage:
//   SQLITE_PATH=/tmp/x/preview.db node scripts/seed-preview.js <username> <password>

const path = require("path");

const dbPath = process.env.SQLITE_PATH;
if (!dbPath || path.resolve(dbPath) === path.resolve(__dirname, "..", "data", "hackernews.db")) {
  console.error("Set SQLITE_PATH to a throwaway database file.");
  process.exit(1);
}
const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error("Usage: seed-preview.js <username> <password>");
  process.exit(1);
}

const { getDb } = require("../services/database");
const auth = require("../services/auth");
const userService = require("../services/userService");

const main = async () => {
  const db = getDb(); // runs the migrations
  // stories.time and .updated are milliseconds (see services/hackernews.js).
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO stories (id, by, descendants, kids, score, time, title, url, updated)
     VALUES (?, ?, ?, '[]', ?, ?, ?, ?, ?)`
  );
  const samples = [
    ["Show HN: A tiny SQLite-backed news reader", "https://example.com/reader", 412, 180],
    ["Why query planners need statistics", "https://example.com/analyze", 356, 97],
    ["The case for boring infrastructure", "https://example.com/boring", 298, 143],
    ["Ask HN: What's your favorite self-hosting setup?", null, 187, 220],
    ["Headless Chrome screenshots without Puppeteer", "https://example.com/cdp", 121, 34],
    ["Scrypt parameters for small machines", "https://example.com/scrypt", 88, 21],
  ];
  db.transaction(() => {
    samples.forEach(([title, url, score, comments], i) => {
      insert.run(900000001 + i, `user${i + 1}`, comments, score, now - (i + 1) * 3600 * 1000, title, url, now);
    });
  })();
  userService.createUser(username, await auth.hashPassword(password));
  db.exec("ANALYZE");
  db.close();
  console.log(`Seeded ${samples.length} stories and account ${username} into ${dbPath}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
