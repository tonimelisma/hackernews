/**
 * Audit existing data in Firestore collections.
 * Counts stories, users, and hidden subcollection docs.
 *
 * Usage:
 *   node scripts/audit-firestore.js
 *   TARGET_PREFIX=dev node scripts/audit-firestore.js
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 TARGET_PREFIX=dev node scripts/audit-firestore.js
 *
 * Read-only — does not modify any data.
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

async function countCollection(collection) {
  let count = 0;
  const PAGE = 10000;
  let snapshot = await collection.select().limit(PAGE).get();
  count += snapshot.docs.length;
  while (snapshot.docs.length === PAGE) {
    const last = snapshot.docs[snapshot.docs.length - 1];
    snapshot = await collection.select().startAfter(last).limit(PAGE).get();
    count += snapshot.docs.length;
  }
  return count;
}

async function main() {
  console.log(`=== Firestore Audit ===`);
  console.log(`Target prefix: ${TARGET_PREFIX}-`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`Using emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  }

  // Count stories
  console.log(`\nCounting ${TARGET_PREFIX}-stories...`);
  const storyCount = await countCollection(storiesCol);
  console.log(`  Stories: ${storyCount}`);

  // Count users and their hidden subcollections
  console.log(`\nCounting ${TARGET_PREFIX}-users...`);
  const usersSnapshot = await usersCol.select().get();
  const userCount = usersSnapshot.docs.length;
  console.log(`  Users: ${userCount}`);

  let totalHidden = 0;
  for (const userDoc of usersSnapshot.docs) {
    const hiddenCol = usersCol.doc(userDoc.id).collection("hidden");
    const hiddenCount = await countCollection(hiddenCol);
    totalHidden += hiddenCount;
    if (hiddenCount > 0) {
      console.log(`    "${userDoc.id}": ${hiddenCount} hidden`);
    }
  }
  console.log(`  Total hidden docs: ${totalHidden}`);

  // Compare with exported data if available
  const storiesPath = path.join(__dirname, "data", "stories.json");
  const usersPath = path.join(__dirname, "data", "users.json");

  if (fs.existsSync(storiesPath) && fs.existsSync(usersPath)) {
    const exportedStories = JSON.parse(fs.readFileSync(storiesPath, "utf-8"));
    const exportedUsers = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
    let exportedHidden = 0;
    for (const u of exportedUsers) {
      exportedHidden += (u.hidden || []).length;
    }

    console.log(`\n=== Comparison with exported data ===`);
    console.log(`Stories: ${storyCount} in Firestore / ${exportedStories.length} exported (${exportedStories.length - storyCount} remaining)`);
    console.log(`Users:   ${userCount} in Firestore / ${exportedUsers.length} exported (${exportedUsers.length - userCount} remaining)`);
    console.log(`Hidden:  ${totalHidden} in Firestore / ${exportedHidden} exported (${exportedHidden - totalHidden} remaining)`);

    const remainingWrites = (exportedStories.length - storyCount) + (exportedUsers.length - userCount) + (exportedHidden - totalHidden);
    console.log(`\nTotal remaining writes needed: ${remainingWrites}`);
    if (remainingWrites > 18000) {
      console.log(`  This will require ${Math.ceil(remainingWrites / 18000)} days at 18K writes/day`);
    } else {
      console.log(`  This fits within a single day's budget (18K writes)`);
    }
  } else {
    console.log(`\nNo exported data found in scripts/data/ — cannot compare.`);
  }

  console.log("\nDone!");
}

main().catch((e) => {
  console.error("Audit failed:", e);
  process.exit(1);
});
