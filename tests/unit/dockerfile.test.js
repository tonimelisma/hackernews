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

  // Regression guard: scripts/users.js is the only way to create accounts and
  // set passwords, and it is run inside the container via `docker exec`.
  it("copies the account admin CLI into the runtime image", () => {
    expect(runtimeStage).toMatch(/^COPY\s+[^\n]*scripts\/users\.js/m);
  });

  // scripts/data/ holds local JSON exports (usernames + hidden lists); they are
  // only for the builder's import step and must not ship in the runtime image.
  it("does not copy the whole scripts directory (keeps data exports out)", () => {
    expect(runtimeStage).not.toMatch(/^COPY\s+scripts\s/m);
  });

  it("copies the application directories needed at runtime", () => {
    for (const dir of ["bin", "routes", "services", "util", "migrations"]) {
      expect(runtimeStage).toMatch(new RegExp(`\\bCOPY\\s+[^\\n]*\\b${dir}\\b`));
    }
  });
});
