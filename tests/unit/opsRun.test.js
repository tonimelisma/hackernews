const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const hasAge = spawnSync("sh", ["-c", "command -v age && command -v age-keygen"]).status === 0;

// End to end on the runner side: ops/run.sh -> (stub) gcloud compute ssh ->
// (stub) sudo -> the real ops/remote.sh -> (stub) docker. Proves the public
// log (run.sh's stdout) never carries the user name or the generated
// password, and that the encrypted bundle holds them. CI installs age; the
// suite is skipped only where age is missing.
(hasAge ? describe : describe.skip)("ops/run.sh end to end (stubbed server)", () => {
  let dir;
  let ops;
  let work;
  let identity;

  const stub = (name, body) =>
    fs.writeFileSync(path.join(dir, "bin", name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hn-ops-run-"));
    ops = path.join(dir, "ops");
    work = path.join(dir, "work");
    identity = path.join(dir, "key.txt");
    fs.mkdirSync(path.join(dir, "bin"));
    fs.mkdirSync(ops);
    fs.mkdirSync(path.join(work, "private"), { recursive: true });
    for (const f of ["run.sh", "remote.sh", "workflow.js"]) {
      fs.copyFileSync(path.join(ROOT, "ops", f), path.join(ops, f));
    }
    // A throwaway key pair for this test only.
    expect(spawnSync("age-keygen", ["-o", identity]).status).toBe(0);
    const pub = spawnSync("age-keygen", ["-y", identity], { encoding: "utf8" }).stdout;
    fs.writeFileSync(path.join(ops, "age-recipient.txt"), `# test\n${pub}`);

    // gcloud compute ssh ... --command=CMD: run CMD locally, stdin passed on.
    stub(
      "gcloud",
      'for a in "$@"; do case $a in --command=*) cmd=${a#--command=} ;; esac; done\nexec bash -c "$cmd"'
    );
    stub("sudo", 'exec "$@"');
    // docker compose ... exec -T app node scripts/users.js <command> [user]
    stub(
      "docker",
      `echo "docker $*" >> "${dir}/docker-calls"
args=" $* "
case $args in
  *"users.js list "*) printf 'alice  password=set\\nbob  password=NOT SET\\n' ;;
  *"users.js add "*|*"users.js set-password "*)
    read -r p1; read -r p2
    [[ -n $p1 && $p1 == "$p2" ]] || { echo "Passwords do not match."; exit 1; }
    echo "$p1" > "${dir}/seen-password"
    echo "Created account \${@: -1}." ;;
  *"users.js revoke-sessions "*) echo "No such account: \${@: -1}"; exit 1 ;;
  *) exit 0 ;;
esac`
    );
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    expect(fs.existsSync(dir)).toBe(false);
  });

  const run = (env, username) => {
    if (username) fs.writeFileSync(path.join(work, "private", "username"), username);
    return spawnSync("bash", [path.join(ops, "run.sh")], {
      env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, WORK: work, GITHUB_STEP_SUMMARY: "", ...env },
      encoding: "utf8",
    });
  };

  const decrypt = () => {
    const out = path.join(dir, "decrypted");
    fs.mkdirSync(out);
    const r = spawnSync("sh", ["-c", `age -d -i "${identity}" "${work}/hn-ops.tar.age" | tar -C "${out}" -xf -`]);
    expect(r.status).toBe(0);
    return (f) => fs.readFileSync(path.join(out, "out", f), "utf8");
  };

  it("users-add: password generated, passed on stdin, and only ever encrypted", () => {
    const r = run({ JOB: "users-add", WHERE: "vps", GENERATE_PASSWORD: "true" }, "alice");
    expect(r.status).toBe(0);
    const password = fs.readFileSync(path.join(dir, "seen-password"), "utf8").trim();
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const log = r.stdout + r.stderr;
    expect(log).toContain("HN_OPS_SUMMARY ok=1");
    expect(log).not.toContain("alice");
    expect(log.replace(`::add-mask::${password}`, "")).not.toContain(password);
    expect(fs.readFileSync(path.join(dir, "docker-calls"), "utf8")).not.toContain(password);

    // Plaintext is gone; only the encrypted bundle is left.
    expect(fs.readdirSync(work)).toEqual(["hn-ops.tar.age"]);
    const file = decrypt();
    expect(file("report.txt")).toContain("username: alice");
    expect(file("report.txt")).toContain(`password: ${password}`);
    expect(file("result.txt")).toContain("Created account alice.");
  });

  it("users-list: the log has the count, the bundle has the names", () => {
    const r = run({ JOB: "users-list", WHERE: "vps" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("HN_OPS_SUMMARY ok=1 accounts=2");
    expect(r.stdout).not.toMatch(/alice|bob/);
    expect(decrypt()("result.txt")).toContain("bob  password=NOT SET");
  });

  it("a failing job fails the run without leaking its error message", () => {
    const r = run({ JOB: "users-revoke-sessions", WHERE: "vps" }, "carol");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("HN_OPS_SUMMARY ok=0");
    expect(r.stdout + r.stderr).not.toContain("carol");
    expect(decrypt()("result.txt")).toContain("No such account: carol");
  });
});
