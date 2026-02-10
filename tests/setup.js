const { getDb, storiesCollection, usersCollection } = require("../services/firestore");

/**
 * Connect to Firestore and suppress console noise during tests.
 */
const connect = async () => {
  // Suppress console noise from production code during tests
  jest.spyOn(console, "log").mockImplementation(() => {});

  // Verify Firestore is accessible by reading a doc
  await getDb().collection("_health").doc("ping").set({ ts: Date.now() });
};

/**
 * Clear test collections between tests.
 */
const clearDatabase = async () => {
  await deleteCollection(storiesCollection());
  await deleteCollection(usersCollection());
};

/**
 * Delete all docs in a collection (including subcollections for users).
 */
const deleteCollection = async (collectionRef) => {
  const snapshot = await collectionRef.get();
  if (snapshot.empty) return;

  const batch = getDb().batch();
  for (const doc of snapshot.docs) {
    // Delete subcollections (e.g., hidden under users)
    const subcollections = await doc.ref.listCollections();
    for (const sub of subcollections) {
      const subSnap = await sub.get();
      for (const subDoc of subSnap.docs) {
        batch.delete(subDoc.ref);
      }
    }
    batch.delete(doc.ref);
  }
  await batch.commit();
};

/**
 * Cleanup after all tests.
 */
const closeDatabase = async () => {
  // Restore console.log
  if (console.log.mockRestore) {
    console.log.mockRestore();
  }
};

module.exports = { connect, clearDatabase, closeDatabase };
