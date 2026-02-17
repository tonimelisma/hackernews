// Suppress Node 22+ experimental localStorage warning noise
const originalEmit = process.emit;
process.emit = function (event, ...args) {
  if (event === "warning" && args[0]?.message?.includes("localstorage-file")) {
    return false;
  }
  return originalEmit.apply(this, [event, ...args]);
};

module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  testPathIgnorePatterns: ["/hackernews-frontend/", "/node_modules/"],
  testTimeout: 10000,
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
