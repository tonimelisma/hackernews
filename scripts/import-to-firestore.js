/**
 * Import local JSON data into Firestore collections.
 *
 * Usage:
 *   node scripts/import-to-firestore.js [options]
 *
 * Options:
 *   --dry-run         Count writes without executing, print summary
 *   --max-writes N    Stop after N writes (default: unlimited)
 *   --users-only      Import only users + hidden subcollections (skip stories)
 *   --stories-only    Import only stories (skip users)
 *   --limit N         Import only the N newest stories (by time descending)
 *
 * Environment:
 *   TARGET_PREFIX     Collection prefix (default: "prod")
 *   FIRESTORE_EMULATOR_HOST   If set, uses the Firestore emulator
 *
 * Reads:
 *   scripts/data/stories.json
 *   scripts/data/users.json
 *
 * Writes:
 *   scripts/data/progress.json  (tracks import progress for resume)
 *
 * Idempotent: skips docs already in Firestore, safe to re-run after partial failure.
 * Resumable: reads progress.json on start, skips already-imported items.
 * Handles Firestore RESOURCE_EXHAUSTED with exponential backoff.
 */

const { Firestore } = require("@google-cloud/firestore");
const fs = require("fs");
const path = require("path");

// --- Parse CLI args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const USERS_ONLY = args.includes("--users-only");
const STORIES_ONLY = args.includes("--stories-only");

let MAX_WRITES = Infinity;
const maxIdx = args.indexOf("--max-writes");
if (maxIdx !== -1 && args[maxIdx + 1]) {
  MAX_WRITES = parseInt(args[maxIdx + 1], 10);
  if (isNaN(MAX_WRITES) || MAX_WRITES <= 0) {
    console.error("--max-writes must be a positive integer");
    process.exit(1);
  }
}

let LIMIT = Infinity;
const limitIdx = args.indexOf("--limit");
if (limitIdx !== -1 && args[limitIdx + 1]) {
  LIMIT = parseInt(args[limitIdx + 1], 10);
  if (isNaN(LIMIT) || LIMIT <= 0) {
    console.error("--limit must be a positive integer");
    process.exit(1);
  }
}

if (USERS_ONLY && STORIES_ONLY) {
  console.error("Cannot use both --users-only and --stories-only");
  process.exit(1);
}

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

const DATA_DIR = path.join(__dirname, "data");
const PROGRESS_PATH = path.join(DATA_DIR, "progress.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Progress tracking ---
function loadProgress() {
  if (fs.existsSync(PROGRESS_PATH)) {
    return JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
  }
  return {
    storiesImported: 0,
    storiesSkipped: 0,
    usersImported: 0,
    hiddenImported: 0,
    totalWritesUsed: 0,
    lastRunDate: null,
    lastStoryIndex: 0,
    lastUserIndex: 0,
  };
}

function saveProgress(progress) {
  progress.lastRunDate = new Date().toISOString().split("T")[0];
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

let writesThisRun = 0;

function checkBudget() {
  if (writesThisRun >= MAX_WRITES) {
    return false;
  }
  return true;
}

// --- Batch helpers ---
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

// --- Stories import ---
async function importStories(stories, progress) {
  console.log("\n--- Importing stories ---");
  console.log(`Total stories in JSON: ${stories.length}`);
  console.log(`Resuming from index: ${progress.lastStoryIndex}`);

  // Slice to resume point
  const remaining = stories.slice(progress.lastStoryIndex);
  console.log(`Stories remaining: ${remaining.length}`);

  if (remaining.length === 0) {
    console.log("All stories already imported (per progress.json).");
    return;
  }

  if (DRY_RUN) {
    // In dry-run, still check existing docs to get accurate count
    console.log("Fetching existing docs for accurate dry-run count...");
    const existingDocs = await getExistingDocIds(storiesCol);
    console.log(`Already in Firestore: ${existingDocs.size} stories`);

    let wouldWrite = 0;
    let wouldSkip = 0;
    for (const story of remaining) {
      const docId = padId(story.id);
      if (existingDocs.has(docId)) {
        wouldSkip++;
      } else {
        wouldWrite++;
      }
    }
    console.log(`Dry-run: would write ${wouldWrite} stories, skip ${wouldSkip} existing`);
    writesThisRun += wouldWrite;
    return;
  }

  // Real import
  const existingDocs = await getExistingDocIds(storiesCol);
  console.log(`Already in Firestore: ${existingDocs.size} stories`);

  let batch = db.batch();
  let batchCount = 0;
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < remaining.length; i++) {
    if (!checkBudget()) {
      console.log(`\nBudget limit reached (${MAX_WRITES} writes). Saving progress...`);
      if (batchCount > 0) {
        await commitWithRetry(batch, `Stories budget-stop batch`);
      }
      progress.lastStoryIndex += i;
      progress.storiesImported += imported;
      progress.storiesSkipped += skipped;
      progress.totalWritesUsed += writesThisRun;
      saveProgress(progress);
      return;
    }

    const story = remaining[i];
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
    imported++;
    writesThisRun++;

    if (batchCount >= BATCH_SIZE) {
      await commitWithRetry(batch, `Stories batch ${imported}`);
      console.log(`  Committed ${imported} new stories (${writesThisRun} total writes)...`);
      batch = db.batch();
      batchCount = 0;
      await sleep(BATCH_DELAY_MS);
    }
  }

  if (batchCount > 0) {
    await commitWithRetry(batch, `Stories final batch`);
  }

  progress.lastStoryIndex += remaining.length;
  progress.storiesImported += imported;
  progress.storiesSkipped += skipped;
  console.log(`Imported ${imported} new stories (skipped ${skipped} existing)`);
}

// --- Users + hidden import ---
async function importUsers(users, progress) {
  console.log("\n--- Importing users ---");
  console.log(`Total users in JSON: ${users.length}`);
  console.log(`Resuming from index: ${progress.lastUserIndex}`);

  const remaining = users.slice(progress.lastUserIndex);
  console.log(`Users remaining: ${remaining.length}`);

  if (remaining.length === 0) {
    console.log("All users already imported (per progress.json).");
    return;
  }

  if (DRY_RUN) {
    let wouldWriteUsers = 0;
    let wouldWriteHidden = 0;
    for (const user of remaining) {
      wouldWriteUsers++;
      wouldWriteHidden += (user.hidden || []).length;
    }
    console.log(`Dry-run: would write ${wouldWriteUsers} user docs + ${wouldWriteHidden} hidden docs = ${wouldWriteUsers + wouldWriteHidden} writes`);
    writesThisRun += wouldWriteUsers + wouldWriteHidden;
    return;
  }

  let usersImported = 0;
  let hiddenImported = 0;

  for (let i = 0; i < remaining.length; i++) {
    if (!checkBudget()) {
      console.log(`\nBudget limit reached (${MAX_WRITES} writes). Saving progress...`);
      progress.lastUserIndex += i;
      progress.usersImported += usersImported;
      progress.hiddenImported += hiddenImported;
      progress.totalWritesUsed += writesThisRun;
      saveProgress(progress);
      return;
    }

    const user = remaining[i];

    // Create user doc
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await usersCol.doc(user.username).set({});
        writesThisRun++;
        usersImported++;
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

    for (let j = 0; j < hidden.length; j++) {
      if (!checkBudget()) {
        console.log(`\nBudget limit reached during hidden import for "${user.username}". Saving progress...`);
        if (batchCount > 0) {
          await commitWithRetry(batch, `User ${user.username} hidden budget-stop`);
        }
        // We can't resume mid-user cleanly, so we mark this user as done
        // and the Firestore idempotency (set()) handles re-writing hidden docs
        progress.lastUserIndex += i + 1;
        progress.usersImported += usersImported;
        progress.hiddenImported += hiddenImported;
        progress.totalWritesUsed += writesThisRun;
        saveProgress(progress);
        return;
      }

      batch.set(
        usersCol.doc(user.username).collection("hidden").doc(String(hidden[j])),
        { addedAt: Date.now() }
      );
      batchCount++;
      hiddenImported++;
      writesThisRun++;

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

    console.log(`  User "${user.username}": ${hidden.length} hidden imported (${writesThisRun} total writes)`);
  }

  progress.lastUserIndex += remaining.length;
  progress.usersImported += usersImported;
  progress.hiddenImported += hiddenImported;
  console.log(`Imported ${usersImported} users, ${hiddenImported} hidden IDs`);
}

// --- Main ---
async function main() {
  const storiesPath = path.join(DATA_DIR, "stories.json");
  const usersPath = path.join(DATA_DIR, "users.json");

  if (!fs.existsSync(storiesPath) || !fs.existsSync(usersPath)) {
    console.error("Missing data files. Run export-from-mongodb.js first.");
    console.error(`Expected: ${storiesPath}`);
    console.error(`Expected: ${usersPath}`);
    process.exit(1);
  }

  let stories = JSON.parse(fs.readFileSync(storiesPath, "utf-8"));
  const users = JSON.parse(fs.readFileSync(usersPath, "utf-8"));

  // Apply --limit: sort by time descending, take newest N
  if (LIMIT < Infinity) {
    stories.sort((a, b) => new Date(b.time) - new Date(a.time));
    stories = stories.slice(0, LIMIT);

    // Filter hidden IDs to only those matching imported stories
    const storyIds = new Set(stories.map((s) => s.id));
    for (const user of users) {
      if (user.hidden) {
        user.hidden = user.hidden.filter((id) => storyIds.has(id));
      }
    }
  }

  const progress = loadProgress();

  console.log(`=== Firestore Import ===`);
  console.log(`Target prefix: ${TARGET_PREFIX}-`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Max writes: ${MAX_WRITES === Infinity ? "unlimited" : MAX_WRITES}`);
  console.log(`Import scope: ${USERS_ONLY ? "users only" : STORIES_ONLY ? "stories only" : "all"}`);
  if (LIMIT < Infinity) {
    console.log(`Story limit: ${LIMIT} newest`);
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`Using emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  }
  console.log(`\nProgress from previous runs:`);
  console.log(`  Stories: ${progress.storiesImported} imported, index at ${progress.lastStoryIndex}`);
  console.log(`  Users: ${progress.usersImported} imported, index at ${progress.lastUserIndex}`);
  console.log(`  Hidden: ${progress.hiddenImported} imported`);
  console.log(`  Total writes used (all runs): ${progress.totalWritesUsed}`);

  if (!STORIES_ONLY) {
    await importUsers(users, progress);
  }
  if (!USERS_ONLY) {
    await importStories(stories, progress);
  }

  // Save final progress
  if (!DRY_RUN) {
    progress.totalWritesUsed += writesThisRun;
    saveProgress(progress);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Writes this run: ${writesThisRun}`);
  if (!DRY_RUN) {
    console.log(`Total writes all runs: ${progress.totalWritesUsed}`);
    console.log(`Progress saved to: ${PROGRESS_PATH}`);
  }
  console.log("Done!");
}

main().catch((e) => {
  console.error("Import failed:", e);
  process.exit(1);
});
