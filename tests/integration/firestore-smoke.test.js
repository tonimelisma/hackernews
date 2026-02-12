/**
 * Smoke tests against real Firestore (dev- prefix).
 *
 * Validates that imported data is readable and app code works
 * against the real database.
 *
 * Run via: npm run test:firestore
 *
 * NOT a Jest test — runs as a standalone Node.js script because
 * Jest's VM sandbox breaks gRPC/auth in the Firestore SDK.
 *
 * Operation budget: max 50 reads + 50 writes per run.
 */

const assert = require("assert");
const storyService = require("../../services/storyService");
const { usersCollection } = require("../../services/firestore");

const MAX_READS = 50;
const MAX_WRITES = 50;
let reads = 0;
let writes = 0;

// --- Instrument Firestore SDK ---
const {
  DocumentReference,
  Query,
} = require("@google-cloud/firestore");

const origQueryGet = Query.prototype.get;
Query.prototype.get = function (...args) {
  reads++;
  if (reads > MAX_READS) throw new Error(`Read limit exceeded (${reads}/${MAX_READS})`);
  return origQueryGet.apply(this, args);
};

const origDocGet = DocumentReference.prototype.get;
DocumentReference.prototype.get = function (...args) {
  reads++;
  if (reads > MAX_READS) throw new Error(`Read limit exceeded (${reads}/${MAX_READS})`);
  return origDocGet.apply(this, args);
};

const origDocSet = DocumentReference.prototype.set;
DocumentReference.prototype.set = function (...args) {
  writes++;
  if (writes > MAX_WRITES) throw new Error(`Write limit exceeded (${writes}/${MAX_WRITES})`);
  return origDocSet.apply(this, args);
};

const origDocUpdate = DocumentReference.prototype.update;
DocumentReference.prototype.update = function (...args) {
  writes++;
  if (writes > MAX_WRITES) throw new Error(`Write limit exceeded (${writes}/${MAX_WRITES})`);
  return origDocUpdate.apply(this, args);
};

const origDocDelete = DocumentReference.prototype.delete;
DocumentReference.prototype.delete = function (...args) {
  writes++;
  if (writes > MAX_WRITES) throw new Error(`Write limit exceeded (${writes}/${MAX_WRITES})`);
  return origDocDelete.apply(this, args);
};

// --- Test runner ---
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// --- Tests ---
async function run() {
  console.log("\nFirestore smoke tests (real dev- data)\n");

  console.log("storyService.getStories");

  await test("returns stories sorted by score descending", async () => {
    const stories = await storyService.getStories("All", 10);
    assert(stories.length > 0, "expected stories");
    for (let i = 1; i < stories.length; i++) {
      assert(
        stories[i - 1].score >= stories[i].score,
        `score not sorted: ${stories[i - 1].score} < ${stories[i].score}`
      );
    }
  });

  await test("returns stories with correct schema", async () => {
    const stories = await storyService.getStories("All", 1);
    const s = stories[0];
    for (const field of ["id", "by", "score", "title", "url", "time", "descendants"]) {
      assert(s[field] !== undefined, `missing field: ${field}`);
    }
    assert(s._id === undefined, "should not have _id");
  });

  await test("respects limit parameter", async () => {
    const stories = await storyService.getStories("All", 3);
    assert.strictEqual(stories.length, 3);
  });

  await test("respects skip parameter", async () => {
    const all = await storyService.getStories("All", 5);
    const skipped = await storyService.getStories("All", 3, 2);
    assert.strictEqual(skipped[0].id, all[2].id, "skip offset mismatch");
  });

  console.log("\nstoryService.getHidden");

  await test("returns array for existing user", async () => {
    const hidden = await storyService.getHidden("villahousut");
    assert(Array.isArray(hidden), "expected array");
  });

  await test("returns empty array for nonexistent user", async () => {
    const hidden = await storyService.getHidden("_nonexistent_user_");
    assert.deepStrictEqual(hidden, []);
  });

  console.log("\nstoryService.upsertHidden");

  const TEST_USER = "_smoke_test_user";
  const TEST_STORY_ID = 99999999;

  await test("writes hidden ID and reads it back", async () => {
    await storyService.upsertHidden(TEST_USER, TEST_STORY_ID);
    const hidden = await storyService.getHidden(TEST_USER);
    assert(hidden.includes(TEST_STORY_ID), `expected ${TEST_STORY_ID} in hidden list`);
  });

  // Cleanup test data
  await test("cleans up test data", async () => {
    await usersCollection()
      .doc(TEST_USER)
      .collection("hidden")
      .doc(String(TEST_STORY_ID))
      .delete();
    await usersCollection().doc(TEST_USER).delete();
  });

  // --- Summary ---
  console.log(`\n  Firestore ops: ${reads} reads, ${writes} writes (limits: ${MAX_READS}/${MAX_WRITES})`);
  console.log(`  Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
