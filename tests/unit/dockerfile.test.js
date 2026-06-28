const fs = require("fs");
const path = require("path");

// Regression: the runtime image must copy the migrations/ directory, otherwise
// loadMigrationFiles() finds nothing in the container, runMigrations() runs zero
// migrations, and schema_migrations stays empty. The migration system then
// silently does nothing in production (discovered 2026-06-27 — migration 002 and
// the whole system were inert in prod because this COPY was missing).
describe("Dockerfile", () => {
  const dockerfile = fs.readFileSync(
    path.join(__dirname, "..", "..", "Dockerfile"),
    "utf8"
  );

  // The runtime image is the final stage (after the last `FROM`).
  const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));

  it("copies the migrations directory into the runtime image", () => {
    expect(runtimeStage).toMatch(/^COPY\s+migrations\b/m);
  });

  it("copies the application directories needed at runtime", () => {
    for (const dir of ["bin", "routes", "services", "util", "migrations"]) {
      expect(runtimeStage).toMatch(new RegExp(`\\bCOPY\\s+[^\\n]*\\b${dir}\\b`));
    }
  });
});
