const { getDb } = require("../services/firestore");

/**
 * Suppress console noise during tests.
 */
const connect = async () => {
  jest.spyOn(console, "log").mockImplementation(() => {});
};

/**
 * Clear all in-memory mock data between tests.
 */
const clearDatabase = async () => {
  getDb()._clear();
};

/**
 * Cleanup after all tests.
 */
const closeDatabase = async () => {
  if (console.log.mockRestore) {
    console.log.mockRestore();
  }
};

module.exports = { connect, clearDatabase, closeDatabase };
