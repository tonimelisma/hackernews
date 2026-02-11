module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  testPathIgnorePatterns: ["/hackernews-frontend/", "/node_modules/"],
  testTimeout: 10000,
  moduleNameMapper: {
    "^@google-cloud/firestore$": "<rootDir>/tests/mocks/firestore-sdk-shim.js",
  },
};
