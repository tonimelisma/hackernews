const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseRequest, safeSummary, USERNAME, JOBS, main } = require("../../ops/workflow");
const { isValidUsername } = require("../../services/auth");

const ROOT = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dispatch = (payload) => parseRequest("repository_dispatch", { client_payload: payload });

// Production jobs run in a PUBLIC repo's GitHub Actions (ops.yml): whatever
// the log shows, anyone can read. These tests pin the rules that keep user
// names, passwords and log lines out of it.
describe("ops request parsing (ops/workflow.js)", () => {
  it("accepts every job with valid arguments", () => {
    expect(dispatch({ job: "users-list" })).toMatchObject({ job: "users-list", where: "vps" });
    expect(dispatch({ job: "users-add", username: "alice_1" })).toMatchObject({
      username: "alice_1",
      generatePassword: true,
    });
    expect(dispatch({ job: "users-revoke-sessions", username: "bob" }).generatePassword).toBe(false);
    expect(dispatch({ job: "backups-list" }).where).toBe("runner");
    expect(dispatch({ job: "backups-download", backup: "hackernews-20261122.db.gz" }).backup).toBe(
      "hackernews-20261122.db.gz"
    );
    expect(
      dispatch({ job: "restore", backup: "prerestore-20261122T101500Z.db.gz", confirm: "restore prerestore-20261122T101500Z.db.gz" })
        .backup
    ).toBe("prerestore-20261122T101500Z.db.gz");
  });

  it("rejects unknown jobs and events", () => {
    expect(() => dispatch({ job: "rm-rf" })).toThrow(/Unknown job/);
    expect(() => dispatch({})).toThrow(/Unknown job/);
    expect(() => parseRequest("push", {})).toThrow(/Unsupported event/);
  });

  it("validates user names with the same rule as the app", () => {
    for (const name of ["alice", "a-b_c", "x".repeat(32), "x".repeat(33), "", "a b", "a;rm", "ä", "$(id)"]) {
      expect(USERNAME.test(name)).toBe(isValidUsername(name));
    }
    expect(() => dispatch({ job: "users-set-password", username: "a b" })).toThrow(/username/);
    expect(() => dispatch({ job: "users-set-password" })).toThrow(/username/);
  });

  // workflow_dispatch inputs are shown on the public run page.
  it("takes user names only through repository_dispatch", () => {
    expect(() =>
      parseRequest("workflow_dispatch", { inputs: { job: "users-add", username: "alice" } })
    ).toThrow(/repository_dispatch only/);
    expect(parseRequest("workflow_dispatch", { inputs: { job: "health" } }).job).toBe("health");
  });

  it("only accepts backup object names, nothing that could escape a path or a shell", () => {
    for (const bad of ["../x.db.gz", "hackernews-2026.db.gz", "hackernews-20261122.db.gz;id", "x"]) {
      expect(() => dispatch({ job: "backups-download", backup: bad })).toThrow(/backup must/);
    }
  });

  it("refuses a restore without an exact confirm for that backup", () => {
    const backup = "hackernews-20261120.db.gz";
    expect(() => dispatch({ job: "restore", backup })).toThrow(/confirm/);
    expect(() => dispatch({ job: "restore", backup, confirm: "yes" })).toThrow(/confirm/);
    expect(() => dispatch({ job: "restore", backup, confirm: "restore hackernews-20261121.db.gz" })).toThrow(/confirm/);
  });

  it("bounds log lines", () => {
    expect(dispatch({ job: "logs" }).lines).toBe(200);
    expect(dispatch({ job: "logs", lines: "50" }).lines).toBe(50);
    for (const bad of ["0", "5001", "1.5", "ten", -1]) {
      expect(() => dispatch({ job: "logs", lines: bad })).toThrow(/lines/);
    }
  });

  it("never echoes request values in its error messages", () => {
    const secret = "Zq9secretname";
    const attempts = [
      { job: secret },
      { job: "users-add", username: `${secret} x` },
      { job: "restore", backup: `${secret}.db.gz` },
      { job: "restore", backup: "hackernews-20261120.db.gz", confirm: secret },
      { job: "logs", lines: secret },
      { job: "health", request_id: `${secret}!` },
    ];
    for (const payload of attempts) {
      try {
        dispatch(payload);
        throw new Error("expected a rejection");
      } catch (e) {
        expect(e.message).not.toContain(secret);
      }
    }
  });
});

describe("ops public summary filter", () => {
  it("passes only a final digits-only summary line", () => {
    expect(safeSummary("noise\nHN_OPS_SUMMARY ok=1 accounts=3\n")).toBe("HN_OPS_SUMMARY ok=1 accounts=3");
    expect(safeSummary("HN_OPS_SUMMARY ok=0 line=12\nHN_OPS_SUMMARY ok=1 x=2")).toBe("HN_OPS_SUMMARY ok=1 x=2");
    expect(safeSummary("alice password=set")).toBeNull();
    expect(safeSummary("HN_OPS_SUMMARY ok=1 user=alice")).toBeNull();
    expect(safeSummary("HN_OPS_SUMMARY ok=1 ip=10.0.0.1")).toBeNull();
    expect(safeSummary("HN_OPS_SUMMARY ok=1 accounts=3 alice")).toBeNull();
    expect(safeSummary("HN_OPS_SUMMARY")).toBeNull();
    expect(safeSummary("")).toBeNull();
  });

  it("prints a fixed line when the summary is missing or unsafe", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hn-ops-test-"));
    const file = path.join(dir, "result.txt");
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      fs.writeFileSync(file, "HN_OPS_SUMMARY ok=1 user=alice\n");
      expect(main(["summary", file])).toBe(1);
      expect(log.mock.calls.flat().join("\n")).not.toContain("alice");
    } finally {
      log.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(fs.existsSync(dir)).toBe(false);
  });
});

// ops/remote.sh runs as root on the production server; it re-checks its
// arguments before touching anything. A stub `docker` records any call.
describe("ops/remote.sh argument checks", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hn-remote-test-"));
    for (const cmd of ["docker", "curl", "journalctl", "systemctl"]) {
      fs.writeFileSync(path.join(dir, cmd), `#!/bin/sh\necho "$0 $*" >> "${dir}/calls"\n`, { mode: 0o755 });
    }
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    expect(fs.existsSync(dir)).toBe(false);
  });

  const remote = (...args) =>
    spawnSync("bash", [path.join(ROOT, "ops/remote.sh"), ...args], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      encoding: "utf8",
      input: "",
    });

  it.each([
    ["unknown job", ["nope"]],
    ["bad username", ["users-add", "a b"]],
    ["injected username", ["users-revoke-sessions", "$(id)"]],
    ["missing username", ["users-set-password"]],
    ["bad line count", ["logs", "99999"]],
    ["bad backup", ["restore", "../etc/passwd", "confirm=../etc/passwd"]],
    ["unconfirmed restore", ["restore", "hackernews-20261120.db.gz", "confirm=hackernews-20261121.db.gz"]],
  ])("rejects %s without calling docker", (_name, args) => {
    const r = remote(...args);
    expect(r.status).toBe(1);
    expect(r.stdout.trim().split("\n").at(-1)).toBe("HN_OPS_SUMMARY ok=0");
    expect(fs.existsSync(path.join(dir, "calls"))).toBe(false);
  });
});

describe("ops workflow (.github/workflows/ops.yml)", () => {
  const ops = read(".github/workflows/ops.yml");
  const workflows = fs.readdirSync(path.join(ROOT, ".github/workflows"));

  it("is started by repository_dispatch hn-ops (the cloud proxy allows that)", () => {
    expect(ops).toMatch(/repository_dispatch:\s*\n\s*types:\s*\[hn-ops\]/);
  });

  it("pins every action in every workflow to a full commit SHA", () => {
    for (const file of workflows) {
      const uses = [...read(`.github/workflows/${file}`).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      expect(uses.length).toBeGreaterThan(0);
      for (const ref of uses) expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });

  it("authenticates to GCP with Workload Identity Federation, not a stored key", () => {
    expect(ops).toMatch(/id-token: write/);
    expect(ops).toMatch(/workload_identity_provider: \$\{\{ vars\.GCP_WIF_PROVIDER \}\}/);
    expect(ops).toMatch(/service_account: \$\{\{ vars\.GCP_SA_EMAIL \}\}/);
    expect(ops).not.toMatch(/credentials_json|secrets\./);
  });

  // `env:` values and `run:` text are printed in the public log (and inline
  // ${{ }} in run: is a script-injection hole). Only run-name may use the
  // payload, and only its job and request id.
  it("never puts request values into env or run text", () => {
    const uses = [...ops.matchAll(/(github\.event\.[\w.]+|\binputs\.\w+)/g)].map((m) => m[1]);
    expect(new Set(uses)).toEqual(
      new Set(["github.event.client_payload.job", "inputs.job", "github.event.client_payload.request_id"])
    );
    expect(ops.match(/^run-name:.*$/m)[0]).toContain("client_payload.job");
  });

  it("uploads only the encrypted bundle, kept for one day", () => {
    expect(ops).toMatch(/path: \$\{\{ env\.WORK \}\}\/hn-ops\.tar\.age/);
    expect(ops).toMatch(/retention-days: 1/);
  });

  it("offers every job in ops/workflow.js through scripts/ops.sh", () => {
    const client = read("scripts/ops.sh");
    for (const job of Object.keys(JOBS)) expect(client).toContain(job);
  });

  it("has an age recipient file that holds only comments or age public keys", () => {
    const lines = read("ops/age-recipient.txt").split("\n").filter((l) => l.trim() !== "");
    for (const line of lines) expect(line).toMatch(/^(#.*|age1[0-9a-z]{58})$/);
  });
});
