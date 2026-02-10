/**
 * One-time migration: MongoDB → Firestore
 *
 * Usage:
 *   DB_URI_PROD="mongodb+srv://..." node scripts/migrate-to-firestore.js
 *   DB_URI_PROD="mongodb+srv://..." TARGET_PREFIX=dev node scripts/migrate-to-firestore.js
 *
 * Requires: mongoose (install temporarily: npm install mongoose)
 */

const mongoose = require("mongoose");
const { Firestore } = require("@google-cloud/firestore");

const DB_URI = process.env.DB_URI_PROD;
const TARGET_PREFIX = process.env.TARGET_PREFIX || "prod";

if (!DB_URI) {
  console.error("DB_URI_PROD environment variable is required");
  process.exit(1);
}

const db = new Firestore({
  projectId: "melisma-essentials",
  databaseId: "hackernews",
});

const storiesCol = db.collection(`${TARGET_PREFIX}-stories`);
const usersCol = db.collection(`${TARGET_PREFIX}-users`);

const padId = (id) => String(id).padStart(10, "0");

// Mongoose schemas (temporary for migration)
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

const BATCH_SIZE = 500;

async function migrateStories() {
  console.log("Migrating stories...");
  const stories = await Story.find({});
  console.log(`Found ${stories.length} stories in MongoDB`);

  const storyIds = new Set();
  let batch = db.batch();
  let batchCount = 0;
  let total = 0;

  for (const story of stories) {
    const docId = padId(story.id);
    storyIds.add(story.id);

    const data = {
      by: story.by,
      descendants: story.descendants,
      id: story.id,
      kids: story.kids || [],
      score: story.score,
      time: story.time,
      title: story.title,
      url: story.url,
      updated: story.updated || new Date(),
    };

    batch.set(storiesCol.doc(docId), data);
    batchCount++;
    total++;

    if (batchCount >= BATCH_SIZE) {
      await batch.commit();
      console.log(`  Committed ${total} stories...`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }
  console.log(`Migrated ${total} stories`);
  return storyIds;
}

async function migrateUsers(existingStoryIds) {
  console.log("Migrating users...");
  const users = await User.find({});
  console.log(`Found ${users.length} users in MongoDB`);

  let totalHidden = 0;
  let orphanedHidden = 0;

  for (const user of users) {
    if (!user.username) continue;

    // Create user doc
    await usersCol.doc(user.username).set({});

    // Migrate hidden IDs — only those that reference existing stories
    const validHidden = (user.hidden || []).filter((id) => existingStoryIds.has(id));
    orphanedHidden += (user.hidden || []).length - validHidden.length;

    let batch = db.batch();
    let batchCount = 0;

    for (const hiddenId of validHidden) {
      batch.set(
        usersCol.doc(user.username).collection("hidden").doc(String(hiddenId)),
        { addedAt: Date.now() }
      );
      batchCount++;
      totalHidden++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(
      `  User "${user.username}": ${validHidden.length} hidden migrated, ${(user.hidden || []).length - validHidden.length} orphaned purged`
    );
  }

  console.log(`Migrated ${totalHidden} hidden IDs total, purged ${orphanedHidden} orphaned`);
}

async function main() {
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(DB_URI);
  console.log("Connected!");

  console.log(`Target Firestore prefix: ${TARGET_PREFIX}-`);

  const storyIds = await migrateStories();
  await migrateUsers(storyIds);

  await mongoose.connection.close();
  console.log("Done! MongoDB connection closed.");
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
