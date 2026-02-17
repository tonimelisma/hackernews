const Database = require("better-sqlite3");
const { setDb, initSchema } = require("../services/database");

/**
 * Suppress console noise during tests and set up in-memory SQLite.
 */
const connect = async () => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  const db = new Database(":memory:");
  setDb(db);
  initSchema(db);
};

/**
 * Clear all data between tests.
 */
const clearDatabase = async () => {
  const { getDb } = require("../services/database");
  const db = getDb();
  db.exec("DELETE FROM hidden; DELETE FROM users; DELETE FROM stories;");
};

/**
 * Cleanup after all tests.
 */
const closeDatabase = async () => {
  if (console.log.mockRestore) {
    console.log.mockRestore();
  }
  if (console.error.mockRestore) {
    console.error.mockRestore();
  }
};

module.exports = { connect, clearDatabase, closeDatabase };
