const fs = require("fs");
const path = require("path");

// Regression guards for the production compose file. On 2026-09-29 a deploy
// that built the image on the VPS saturated its pd-standard disk (94% util,
// 88% iowait) and the build died with the SSH session; images are now built in
// CI and the VPS only pulls. Container logs were also unbounded (json-file
// with no limits: 42 MB after four weeks).
describe("docker-compose.yml (production)", () => {
  const compose = fs.readFileSync(
    path.join(__dirname, "..", "..", "docker-compose.yml"),
    "utf8"
  );

  it("never builds on the VPS", () => {
    expect(compose).not.toMatch(/^\s*build:/m);
  });

  it("runs the CI-built image from GHCR, pinned by IMAGE_TAG", () => {
    expect(compose).toMatch(/image:\s*ghcr\.io\/tonimelisma\/hackernews:\$\{IMAGE_TAG:-latest\}/);
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

describe("CI deploy workflow", () => {
  const ci = fs.readFileSync(
    path.join(__dirname, "..", "..", ".github", "workflows", "ci.yml"),
    "utf8"
  );
  const deployJob = ci.slice(ci.indexOf("\n  deploy:"));

  it("builds and pushes the image in CI", () => {
    expect(ci).toMatch(/docker\/build-push-action@/);
    expect(ci).toMatch(/ghcr\.io\/tonimelisma\/hackernews:\$\{\{ github\.sha \}\}/);
  });

  it("deploys by pulling, not building, on the VPS", () => {
    expect(deployJob).toMatch(/docker compose pull/);
    expect(deployJob).not.toMatch(/--build/);
  });
});
