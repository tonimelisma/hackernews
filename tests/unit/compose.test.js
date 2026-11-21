const fs = require("fs");
const path = require("path");

// The repo's docker-compose.yml is for local use only since 2026-11-21: the
// server runs a fixed compose file owned by the latchkey repo
// (deploy/server/host/hackernews-compose.yml). This one runs the same CI-built
// image with the same limits, so a local run catches what would break there
// (above all: the app runs as uid 1000 with no capabilities).
describe("docker-compose.yml (local, mirrors the server)", () => {
  const compose = fs.readFileSync(
    path.join(__dirname, "..", "..", "docker-compose.yml"),
    "utf8"
  );

  // On 2026-09-29 an on-box build saturated the server's pd-standard disk;
  // images are built in CI only.
  it("runs the CI-built image from GHCR instead of building", () => {
    expect(compose).not.toMatch(/^\s*build:/m);
    expect(compose).toMatch(/image:\s*ghcr\.io\/tonimelisma\/hackernews:\$\{IMAGE_TAG:-latest\}/);
  });

  it("runs as the non-root node user with no capabilities, like the server", () => {
    expect(compose).toMatch(/user:\s*"1000:1000"/);
    expect(compose).toMatch(/cap_drop:\s*\[ALL\]/);
    expect(compose).toMatch(/no-new-privileges:true/);
  });

  // The check queries SQLite on a pd-standard disk; under I/O contention a
  // healthy app took >5 s and was marked unhealthy (3 timeouts at 15:08 on
  // 2026-09-29 with no deploy running).
  it("gives the health check at least 10 s before timing out", () => {
    const match = compose.match(/healthcheck:[\s\S]*?timeout:\s*(\d+)s/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBeGreaterThanOrEqual(10);
  });

  it("caps container log size", () => {
    expect(compose).toMatch(/max-size:\s*"?\d+m"?/);
    expect(compose).toMatch(/max-file:\s*"?\d+"?/);
  });
});

// Since 2026-11-21 the server's SSH is reachable only through Google's IAP
// tunnel, so CI no longer deploys: the server pulls :latest itself every few
// minutes. CI must keep pushing :latest, or production never updates.
describe("CI workflow", () => {
  const ci = fs.readFileSync(
    path.join(__dirname, "..", "..", ".github", "workflows", "ci.yml"),
    "utf8"
  );

  it("builds and pushes the image with :sha and :latest tags", () => {
    expect(ci).toMatch(/docker\/build-push-action@/);
    expect(ci).toMatch(/ghcr\.io\/tonimelisma\/hackernews:\$\{\{ github\.sha \}\}/);
    expect(ci).toMatch(/ghcr\.io\/tonimelisma\/hackernews:latest/);
  });

  it("has no SSH deploy job", () => {
    expect(ci).not.toMatch(/^\s{2}deploy:/m);
    expect(ci).not.toMatch(/ssh-action|VPS_SSH_KEY|VPS_USER/);
  });
});
