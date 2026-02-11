/**
 * Export MongoDB data to local JSON files for inspection before Firestore import.
 *
 * Usage:
 *   npm install --no-save mongoose
 *   DB_URI_PROD="mongodb+srv://..." node scripts/export-from-mongodb.js
 *   npm install   # removes mongoose
 *
 * Outputs:
 *   scripts/data/stories.json — cleaned story objects
 *   scripts/data/users.json   — { username, hidden: [number] } objects
 */

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const DB_URI = process.env.DB_URI_PROD;

if (!DB_URI) {
  console.error("DB_URI_PROD environment variable is required");
  process.exit(1);
}

// Mongoose schemas (temporary for export)
const storySchema = new mongoose.Schema({
  by: String,
  descendants: Number,
  id: { type: Number, unique: true },
  kids: [Number],
  score: Number,
  time: Date,
  title: String,
  type: String,
  url: String,
  updated: Date,
});
const Story = mongoose.model("Story", storySchema);

const userSchema = new mongoose.Schema({
  username: String,
  hidden: [{ type: Number }],
});
const User = mongoose.model("User", userSchema);

const DATA_DIR = path.join(__dirname, "data");

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(DB_URI);
  console.log("Connected!");

  // --- Export stories ---
  const rawStories = await Story.find({});
  console.log(`Found ${rawStories.length} stories in MongoDB`);

  const now = new Date().toISOString();
  const storyIds = new Set();

  const stories = rawStories.map((s) => {
    storyIds.add(s.id);
    return {
      id: s.id,
      by: s.by || "",
      descendants: s.descendants || 0,
      kids: s.kids || [],
      score: s.score || 0,
      time: s.time ? s.time.toISOString() : now,
      title: s.title || "",
      url: s.url || "",
      updated: s.updated ? s.updated.toISOString() : now,
    };
  });

  // --- Export users ---
  const rawUsers = await User.find({});
  console.log(`Found ${rawUsers.length} users in MongoDB`);

  let totalHidden = 0;
  let orphanedHidden = 0;

  const users = [];
  for (const u of rawUsers) {
    if (!u.username) {
      console.log(`  Skipping user with no username (MongoDB _id: ${u._id})`);
      continue;
    }

    const allHidden = u.hidden || [];
    const validHidden = allHidden.filter((id) => storyIds.has(id));
    const orphaned = allHidden.length - validHidden.length;
    orphanedHidden += orphaned;
    totalHidden += validHidden.length;

    users.push({
      username: u.username,
      hidden: validHidden,
    });

    if (orphaned > 0) {
      console.log(`  User "${u.username}": ${validHidden.length} valid hidden, ${orphaned} orphaned purged`);
    }
  }

  // --- Write files ---
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const storiesPath = path.join(DATA_DIR, "stories.json");
  fs.writeFileSync(storiesPath, JSON.stringify(stories, null, 2));
  console.log(`\nWrote ${stories.length} stories to ${storiesPath}`);

  const usersPath = path.join(DATA_DIR, "users.json");
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  console.log(`Wrote ${users.length} users to ${usersPath}`);

  // --- Summary ---
  console.log(`\n--- Summary ---`);
  console.log(`Stories: ${stories.length}`);
  console.log(`Users: ${users.length}`);
  console.log(`Total valid hidden IDs: ${totalHidden}`);
  console.log(`Orphaned hidden IDs purged: ${orphanedHidden}`);

  await mongoose.connection.close();
  console.log("Done! MongoDB connection closed.");
}

main().catch((e) => {
  console.error("Export failed:", e);
  process.exit(1);
});
