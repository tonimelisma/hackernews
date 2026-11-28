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

  // Validates: HN-063
  it("copies the migrations directory into the runtime image", () => {
    expect(runtimeStage).toMatch(/^COPY\s+migrations\b/m);
  });

  // Regression guard: scripts/users.js is the only way to create accounts and
  // set passwords, and it is run inside the container (runtime contract).
  // Validates: HN-063
  it("copies the account admin CLI into the runtime image", () => {
    expect(runtimeStage).toMatch(/^COPY\s+[^\n]*scripts\/users\.js/m);
  });

  // scripts/ is mostly dev tooling (preview, screenshots, cloud setup); only
  // the CLIs the runtime contract names belong in the image.
  // Validates: HN-063
  it("does not copy the whole scripts directory", () => {
    expect(runtimeStage).not.toMatch(/^COPY\s+scripts\s/m);
  });

  // Validates: HN-063
  it("copies the application directories needed at runtime", () => {
    for (const dir of ["bin", "routes", "services", "util", "migrations"]) {
      expect(runtimeStage).toMatch(new RegExp(`\\bCOPY\\s+[^\\n]*\\b${dir}\\b`));
    }
  });

  // Regression: the runtime contract runs the app as uid 1000 (the image's
  // `node` user) with all capabilities dropped. A fresh volume takes /data's ownership from
  // the image, so a root-owned /data crashed the app at startup with
  // SQLITE_READONLY_DIRECTORY (found 2026-11-21 in a local run as 1000:1000).
  // Validates: HN-063
  it("gives /data to the node user and runs as node", () => {
    expect(runtimeStage).toMatch(/^COPY\s+--from=builder\s+--chown=node:node\s+\/data\s+\/data/m);
    expect(runtimeStage).toMatch(/^USER\s+node\s*$/m);
  });
  // Clean builds: the same commit rebuilds on the same base.
  // Validates: HN-063
  it("pins every base image by digest", () => {
    const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(1);
    for (const from of froms) expect(from).toMatch(/@sha256:[0-9a-f]{64}$/);
  });
});
