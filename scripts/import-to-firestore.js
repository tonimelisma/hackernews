/**
 * Import local JSON data into Firestore prod- collections.
 *
 * Usage:
 *   node scripts/import-to-firestore.js
 *   TARGET_PREFIX=dev node scripts/import-to-firestore.js
 *
 * Reads:
 *   scripts/data/stories.json
 *   scripts/data/users.json
 *
 * Idempotent: skips stories already in Firestore, safe to re-run after partial failure.
 * Handles Firestore RESOURCE_EXHAUSTED with exponential backoff.
 */

const { Firestore } = require("@google-cloud/firestore");
const fs = require("fs");
const path = require("path");

const TARGET_PREFIX = process.env.TARGET_PREFIX || "prod";

const db = new Firestore({
  projectId: "melisma-essentials",
  databaseId: "hackernews",
});

const storiesCol = db.collection(`${TARGET_PREFIX}-stories`);
const usersCol = db.collection(`${TARGET_PREFIX}-users`);

const padId = (id) => String(id).padStart(10, "0");

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

async function importStories(stories) {
  console.log("Importing stories...");
  console.log(`Loaded ${stories.length} stories from JSON`);

  const existingDocs = await getExistingDocIds(storiesCol);
  console.log(`Already in Firestore: ${existingDocs.size} stories`);

  let batch = db.batch();
  let batchCount = 0;
  let total = 0;
  let skipped = 0;

  for (const story of stories) {
    const docId = padId(story.id);

    if (existingDocs.has(docId)) {
      skipped++;
      continue;
    }

    batch.set(storiesCol.doc(docId), {
      by: story.by,
      descendants: story.descendants,
      id: story.id,
      kids: story.kids,
      score: story.score,
      time: new Date(story.time),
      title: story.title,
      url: story.url,
      updated: new Date(story.updated),
    });
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
  console.log(`Imported ${total} new stories (skipped ${skipped} existing)`);
}

async function importUsers(users) {
  console.log("Importing users...");
  console.log(`Loaded ${users.length} users from JSON`);

  let totalHidden = 0;

  for (const user of users) {
    // Create user doc
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

    // Import hidden IDs
    const hidden = user.hidden || [];
    let batch = db.batch();
    let batchCount = 0;

    for (const hiddenId of hidden) {
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

    console.log(`  User "${user.username}": ${hidden.length} hidden imported`);
  }

  console.log(`Imported ${totalHidden} hidden IDs total`);
}

async function main() {
  const dataDir = path.join(__dirname, "data");

  const storiesPath = path.join(dataDir, "stories.json");
  const usersPath = path.join(dataDir, "users.json");

  if (!fs.existsSync(storiesPath) || !fs.existsSync(usersPath)) {
    console.error("Missing data files. Run export-from-mongodb.js first.");
    console.error(`Expected: ${storiesPath}`);
    console.error(`Expected: ${usersPath}`);
    process.exit(1);
  }

  const stories = JSON.parse(fs.readFileSync(storiesPath, "utf-8"));
  const users = JSON.parse(fs.readFileSync(usersPath, "utf-8"));

  console.log(`Target Firestore prefix: ${TARGET_PREFIX}-`);

  await importStories(stories);
  await importUsers(users);

  console.log("Done!");
}

main().catch((e) => {
  console.error("Import failed:", e);
  process.exit(1);
});
