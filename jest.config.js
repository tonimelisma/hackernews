module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  testPathIgnorePatterns: ["/hackernews-frontend/", "/node_modules/"],
  testTimeout: 10000,
  moduleNameMapper: {
    "^@google-cloud/firestore$": "<rootDir>/tests/mocks/firestore-sdk-shim.js",
  },
  collectCoverageFrom: [
    "**/*.js",
    "!node_modules/**",
    "!hackernews-frontend/**",
    "!coverage/**",
    "!tests/**",
    "!jest.config.js",
    "!eslint.config.js",
    "!scripts/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "text-summary", "lcov"],
};
