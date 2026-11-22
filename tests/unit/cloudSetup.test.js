const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// Claude Code cloud sessions (claude.ai/code) run .claude/settings.json hooks;
// the SessionStart hook installs Node 24 and node_modules there, and must be a
// no-op on Toni's Mac and anywhere else.
describe("cloud session setup", () => {
  const settings = JSON.parse(read(".claude/settings.json"));

  it("runs scripts/cloud-setup.sh at SessionStart within the 600 s hook limit", () => {
    const hooks = settings.hooks.SessionStart.flatMap((h) => h.hooks);
    const hook = hooks.find((h) => h.command.includes("scripts/cloud-setup.sh"));
    expect(hook).toBeDefined();
    expect(hook.command).toContain("$CLAUDE_PROJECT_DIR");
    expect(hook.timeout).toBeLessThanOrEqual(600);
  });

  it("exits at once, silently, when CLAUDE_CODE_REMOTE is not true", () => {
    for (const value of [undefined, "false", ""]) {
      const env = { ...process.env, CLAUDE_ENV_FILE: "/nonexistent/env" };
      if (value === undefined) delete env.CLAUDE_CODE_REMOTE;
      else env.CLAUDE_CODE_REMOTE = value;
      const r = spawnSync("bash", [path.join(ROOT, "scripts/cloud-setup.sh")], { env, encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("");
    }
  });

  // The cloud VM gets the Node major from .node-version; CI and the Docker
  // image must use the same one.
  it("pins the same Node major as CI and the Dockerfile", () => {
    const major = read(".node-version").trim();
    const ci = [...read(".github/workflows/ci.yml").matchAll(/node-version:\s*(\d+)/g)].map((m) => m[1]);
    expect(ci.length).toBeGreaterThan(0);
    expect(new Set(ci)).toEqual(new Set([major]));
    const froms = [...read("Dockerfile").matchAll(/^FROM node:(\d+)/gm)].map((m) => m[1]);
    expect(new Set(froms)).toEqual(new Set([major]));
  });

  // scripts/preview.sh seeds a throwaway DB; the seeder must refuse to write
  // into the real database.
  it("seed-preview refuses to run without a throwaway SQLITE_PATH", () => {
    const run = (sqlitePath) => {
      const env = { ...process.env };
      if (sqlitePath === undefined) delete env.SQLITE_PATH;
      else env.SQLITE_PATH = sqlitePath;
      return spawnSync("node", [path.join(ROOT, "scripts/seed-preview.js"), "u", "p"], { env, encoding: "utf8" });
    };
    expect(run(undefined).status).toBe(1);
    expect(run(path.join(ROOT, "data", "hackernews.db")).status).toBe(1);
  });

  // Regression: the seeder first wrote story times in seconds, but the app
  // stores milliseconds (hackernews.js), so the "Day" page was empty.
  it("seed-preview writes stories the Day query returns, and a working account", () => {
    const os = require("os");
    const Database = require("better-sqlite3");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hn-seed-test-"));
    try {
      const dbPath = path.join(dir, "preview.db");
      const r = spawnSync("node", [path.join(ROOT, "scripts/seed-preview.js"), "tester", "pw-123456789"], {
        env: { ...process.env, SQLITE_PATH: dbPath }, encoding: "utf8",
      });
      expect(r.status).toBe(0);
      const db = new Database(dbPath, { readonly: true });
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recent = db.prepare("SELECT COUNT(*) AS n FROM stories WHERE time > ?").get(dayAgo).n;
      const user = db.prepare("SELECT password_hash FROM users WHERE username = 'tester'").get();
      db.close();
      expect(recent).toBe(6);
      expect(user.password_hash).toMatch(/^scrypt\$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(fs.existsSync(dir)).toBe(false);
  });
});
