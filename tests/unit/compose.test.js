const fs = require("fs");
const path = require("path");

// docker-compose.yml is for local use only: it runs the CI-built image under
// the runtime contract (docs/ARCHITECTURE.md#runtime-contract), so a local run
// catches what would break wherever the image runs (above all: uid 1000 with
// no capabilities).
describe("docker-compose.yml (local, runtime contract)", () => {
  const compose = fs.readFileSync(
    path.join(__dirname, "..", "..", "docker-compose.yml"),
    "utf8"
  );

  // Images are built in CI only (an on-box build once saturated a production
  // disk, 2026-09-29).
  it("runs the CI-built image from GHCR instead of building", () => {
    expect(compose).not.toMatch(/^\s*build:/m);
    expect(compose).toMatch(/image:\s*ghcr\.io\/tonimelisma\/hackernews:\$\{IMAGE_TAG:-latest\}/);
  });

  it("runs as the non-root node user with no capabilities", () => {
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

// Releasing = CI pushing the image. CI never reaches a server and holds no
// cloud credentials: whatever runs the image pulls it on its own.
describe("CI workflows", () => {
  const dir = path.join(__dirname, "..", "..", ".github", "workflows");
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const ci = read("ci.yml");

  it("builds and pushes the image with :sha and :latest tags", () => {
    expect(ci).toMatch(/docker\/build-push-action@/);
    expect(ci).toMatch(/ghcr\.io\/tonimelisma\/hackernews:\$\{\{ github\.sha \}\}/);
    expect(ci).toMatch(/ghcr\.io\/tonimelisma\/hackernews:latest/);
  });

  it("never deploys to or reaches into a server", () => {
    for (const file of fs.readdirSync(dir)) {
      const wf = read(file);
      expect(wf).not.toMatch(/^\s{2}deploy:/m);
      expect(wf).not.toMatch(/ssh|gcloud|google-github-actions|id-token|repository_dispatch|VPS_/i);
    }
  });

  it("pins every action to a full commit SHA", () => {
    for (const file of fs.readdirSync(dir)) {
      const uses = [...read(file).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      expect(uses.length).toBeGreaterThan(0);
      for (const ref of uses) expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });
});
