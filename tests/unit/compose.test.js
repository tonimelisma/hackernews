const fs = require("fs");
const path = require("path");

// docker-compose.yml is for local use only: it runs the CI-built image under
// the runtime contract (docs/RELEASE.md), so a local run
// catches what would break wherever the image runs (above all: uid 1000 with
// no capabilities).
describe("docker-compose.yml (local, runtime contract)", () => {
  const compose = fs.readFileSync(
    path.join(__dirname, "..", "..", "docker-compose.yml"),
    "utf8"
  );

  // Images are built in CI only; a host just pulls them.
  it("runs the CI-built image from GHCR instead of building", () => {
    expect(compose).not.toMatch(/^\s*build:/m);
    expect(compose).toMatch(/image:\s*ghcr\.io\/tonimelisma\/hackernews:\$\{IMAGE_TAG:-latest\}/);
  });

  it("runs as the non-root node user with no capabilities", () => {
    expect(compose).toMatch(/user:\s*"1000:1000"/);
    expect(compose).toMatch(/cap_drop:\s*\[ALL\]/);
    expect(compose).toMatch(/no-new-privileges:true/);
  });

  // The check queries SQLite; on a slow disk under I/O contention a healthy
  // app took >5 s and was marked unhealthy (2026-09-29).
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

// The release is the only thing this repo produces: a signed multi-arch
// image in the registry. CI never reaches anything else, holds no credentials
// beyond its own GITHUB_TOKEN and, for keyless signing, an OIDC token.
describe("CI workflows (release at arm's length)", () => {
  const dir = path.join(__dirname, "..", "..", ".github", "workflows");
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const files = fs.readdirSync(dir);
  const ci = read("ci.yml");
  const job = (name) => {
    const start = ci.indexOf(`\n  ${name}:\n`);
    expect(start).toBeGreaterThan(-1);
    const next = ci.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
    return next === -1 ? ci.slice(start) : ci.slice(start, start + 1 + next);
  };

  it("builds natively for linux/amd64 and linux/arm64", () => {
    expect(job("image")).toMatch(/platform: linux\/amd64\s+runner: ubuntu-24\.04\b/);
    expect(job("image")).toMatch(/platform: linux\/arm64\s+runner: ubuntu-24\.04-arm\b/);
  });

  it("checks every image against the runtime contract before it can be released", () => {
    expect(job("image")).toMatch(/run: scripts\/image-smoke\.sh hackernews:candidate/);
    expect(job("release")).toMatch(/needs: \[image\]/);
  });

  // Hosts that track releases pull :latest; hosts that pin use :<sha>.
  it("tags each release :<sha> and :latest, with provenance and an SBOM", () => {
    expect(ci).toMatch(/IMAGE: ghcr\.io\/tonimelisma\/hackernews/);
    expect(job("release")).toMatch(/-t "\$IMAGE:\$GITHUB_SHA" -t "\$IMAGE:latest"/);
    expect(job("image")).toMatch(/provenance: mode=max/);
    expect(job("image")).toMatch(/sbom: true/);
  });

  it("signs every release keylessly and verifies it", () => {
    expect(job("release")).toMatch(/cosign sign --yes "\$IMAGE@\$DIGEST"/);
    expect(job("release")).toMatch(/cosign verify/);
  });

  it("publishes only from master pushes", () => {
    expect(job("release")).toMatch(/if: github\.ref == 'refs\/heads\/master' && github\.event_name == 'push'/);
    expect(job("image")).toMatch(/PUBLISH: \$\{\{ github\.ref == 'refs\/heads\/master' && github\.event_name == 'push' \}\}/);
  });

  it("never deploys to or reaches into anything but the registry", () => {
    for (const file of files) {
      const wf = read(file);
      expect(wf).not.toMatch(/^\s{2}deploy:/m);
      expect(wf).not.toMatch(/\bssh\b|\bscp\b|repository_dispatch|workflow_dispatch|secrets\.(?!GITHUB_TOKEN\b)/);
      const owners = [...wf.matchAll(/uses:\s*([\w.-]+)\//g)].map((m) => m[1]);
      for (const owner of owners) expect(["actions", "docker", "sigstore"]).toContain(owner);
    }
    // The OIDC token exists only for the cosign signature.
    expect(ci.match(/id-token: write/g)).toHaveLength(1);
    expect(job("release")).toMatch(/id-token: write/);
  });

  it("pins every action to a full commit SHA", () => {
    for (const file of files) {
      const uses = [...read(file).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      expect(uses.length).toBeGreaterThan(0);
      for (const ref of uses) expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });
});
