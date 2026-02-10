/**
 * One-time migration: MongoDB → Firestore
 *
 * Usage:
 *   DB_URI_PROD="mongodb+srv://..." node scripts/migrate-to-firestore.js
 *   DB_URI_PROD="mongodb+srv://..." TARGET_PREFIX=dev node scripts/migrate-to-firestore.js
 *
 * Requires: mongoose (install temporarily: npm install --no-save mongoose)
 *
 * Idempotent: skips stories already in Firestore, safe to re-run after partial failure.
 * Handles Firestore RESOURCE_EXHAUSTED with exponential backoff.
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

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 5000;
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function commitWithRetry(batch, label) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await batch.commit();
      return;
    } catch (e) {
      if (e.code === 4 || (e.message && e.message.includes("RESOURCE_EXHAUSTED"))) {
        const backoff = BATCH_DELAY_MS * Math.pow(2, attempt);
        console.log(`  ${label}: RESOURCE_EXHAUSTED, backing off ${backoff / 1000}s (attempt ${attempt}/${MAX_RETRIES})...`);
        await sleep(backoff);
      } else {
        throw e;
      }
    }
  }
  throw new Error(`${label}: Failed after ${MAX_RETRIES} retries`);
}

async function getExistingDocIds(collection) {
  const existing = new Set();
  const PAGE = 10000;
  let snapshot = await collection.select().limit(PAGE).get();
  for (const doc of snapshot.docs) {
    existing.add(doc.id);
  }
  while (snapshot.docs.length === PAGE) {
    const last = snapshot.docs[snapshot.docs.length - 1];
    snapshot = await collection.select().startAfter(last).limit(PAGE).get();
    for (const doc of snapshot.docs) {
      existing.add(doc.id);
    }
  }
  return existing;
}

async function migrateStories() {
  console.log("Migrating stories...");
  const stories = await Story.find({});
  console.log(`Found ${stories.length} stories in MongoDB`);

  const existingDocs = await getExistingDocIds(storiesCol);
  console.log(`Already in Firestore: ${existingDocs.size} stories`);

  const storyIds = new Set();
  let batch = db.batch();
  let batchCount = 0;
  let total = 0;
  let skipped = 0;

  for (const story of stories) {
    const docId = padId(story.id);
    storyIds.add(story.id);

    if (existingDocs.has(docId)) {
      skipped++;
      continue;
    }

    const data = {
      by: story.by || "",
      descendants: story.descendants || 0,
      id: story.id,
      kids: story.kids || [],
      score: story.score || 0,
      time: story.time,
      title: story.title || "",
      url: story.url || "",
      updated: story.updated || new Date(),
    };

    batch.set(storiesCol.doc(docId), data);
    batchCount++;
    total++;

    if (batchCount >= BATCH_SIZE) {
      await commitWithRetry(batch, `Stories batch ${total}`);
      console.log(`  Committed ${total} new stories...`);
      batch = db.batch();
      batchCount = 0;
      await sleep(BATCH_DELAY_MS);
    }
  }

  if (batchCount > 0) {
    await commitWithRetry(batch, `Stories final batch`);
  }
  console.log(`Migrated ${total} new stories (skipped ${skipped} existing)`);
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

    // Create user doc (with retry)
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await usersCol.doc(user.username).set({});
        break;
      } catch (e) {
        if (attempt === MAX_RETRIES) throw e;
        if (e.code === 4 || (e.message && e.message.includes("RESOURCE_EXHAUSTED"))) {
          const backoff = BATCH_DELAY_MS * Math.pow(2, attempt);
          console.log(`  User ${user.username}: RESOURCE_EXHAUSTED, backing off ${backoff / 1000}s...`);
          await sleep(backoff);
        } else {
          throw e;
        }
      }
    }

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
        await commitWithRetry(batch, `User ${user.username} hidden`);
        batch = db.batch();
        batchCount = 0;
        await sleep(BATCH_DELAY_MS);
      }
    }

    if (batchCount > 0) {
      await commitWithRetry(batch, `User ${user.username} hidden final`);
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
