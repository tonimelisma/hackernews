const db = require("../setup");

const auth = require("../../services/auth");
const userService = require("../../services/userService");
const { run } = require("../../scripts/users");

const FAST = { N: 1024, r: 8, p: 1 };

beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());

const rawDb = () => require("../../services/database").getDb();

// Mirrors a production row created before local passwords existed.
const seedLegacyUser = (username, hiddenIds = []) => {
  rawDb().prepare("INSERT INTO users (username) VALUES (?)").run(username);
  const ins = rawDb().prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)");
  for (const id of hiddenIds) ins.run(username, id);
};

// Runs the CLI with scripted password answers and captured output.
const cli = async (args, answers = []) => {
  const out = [];
  const err = [];
  const queue = [...answers];
  const code = await run(args, {
    readPassword: async () => {
      if (queue.length === 0) throw new Error("unexpected password prompt");
      return queue.shift();
    },
    log: (msg) => out.push(msg),
    error: (msg) => err.push(msg),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

describe("services/userService", () => {
  it("returns legacy users with no password and token version 0", () => {
    seedLegacyUser("legacy");
    const user = userService.getUser("legacy");
    expect(user.username).toBe("legacy");
    expect(user.password_hash).toBeNull();
    expect(user.token_version).toBe(0);
  });

  it("returns undefined for unknown users", () => {
    expect(userService.getUser("nobody")).toBeUndefined();
  });

  it("matches usernames case-sensitively", () => {
    seedLegacyUser("CaseUser");
    expect(userService.getUser("caseuser")).toBeUndefined();
  });

  it("revokeSessions bumps the token version", () => {
    seedLegacyUser("legacy");
    expect(userService.revokeSessions("legacy")).toBe(true);
    expect(userService.getUser("legacy").token_version).toBe(1);
  });

  it("setPasswordHash keeps the token version and hidden history", () => {
    seedLegacyUser("legacy", [1, 2, 3]);
    expect(userService.setPasswordHash("legacy", "scrypt$hash")).toBe(true);
    const user = userService.getUser("legacy");
    expect(user.password_hash).toBe("scrypt$hash");
    expect(user.token_version).toBe(0);
    const hidden = rawDb().prepare("SELECT count(*) c FROM hidden WHERE username = ?").get("legacy").c;
    expect(hidden).toBe(3);
  });

  it("setPasswordHash and revokeSessions report unknown users", () => {
    expect(userService.setPasswordHash("nobody", "x")).toBe(false);
    expect(userService.revokeSessions("nobody")).toBe(false);
  });
});

describe("auth.verifyCredentials", () => {
  it("returns the user for the correct password", async () => {
    userService.createUser("alice", await auth.hashPassword("alice-password", FAST));
    const user = await auth.verifyCredentials("alice", "alice-password");
    expect(user.username).toBe("alice");
  });

  it("returns null for a wrong password", async () => {
    userService.createUser("alice", await auth.hashPassword("alice-password", FAST));
    expect(await auth.verifyCredentials("alice", "wrong-password")).toBeNull();
  });

  it("returns null for an unknown user", async () => {
    expect(await auth.verifyCredentials("nobody", "whatever-password")).toBeNull();
  });

  it("returns null for a legacy user who has no password yet", async () => {
    seedLegacyUser("legacy");
    expect(await auth.verifyCredentials("legacy", "")).toBeNull();
    expect(await auth.verifyCredentials("legacy", "anything-at-all")).toBeNull();
  });
});

describe("scripts/users.js", () => {
  describe("list", () => {
    it("lists accounts with password state and hidden counts", async () => {
      seedLegacyUser("legacy", [1, 2]);
      userService.createUser("alice", await auth.hashPassword("alice-password", FAST));

      const { code, out } = await cli(["list"]);

      expect(code).toBe(0);
      expect(out).toMatch(/alice\s.*password=set.*hidden=0/);
      expect(out).toMatch(/legacy\s.*password=NOT SET.*hidden=2/);
    });

    it("reports when there are no accounts", async () => {
      const { code, out } = await cli(["list"]);
      expect(code).toBe(0);
      expect(out).toMatch(/no accounts/i);
    });
  });

  describe("add", () => {
    it("creates an account with a hashed password", async () => {
      const { code } = await cli(["add", "newbie"], ["newbie-password", "newbie-password"]);

      expect(code).toBe(0);
      const user = userService.getUser("newbie");
      expect(user.password_hash).toMatch(/^scrypt\$/);
      expect(user.created_at).toEqual(expect.any(Number));
      expect(await auth.verifyCredentials("newbie", "newbie-password")).not.toBeNull();
    });

    it("refuses to overwrite an existing account", async () => {
      seedLegacyUser("legacy", [1]);
      const { code, err } = await cli(["add", "legacy"], ["some-password", "some-password"]);
      expect(code).toBe(1);
      expect(err).toMatch(/already exists/);
      expect(userService.getUser("legacy").password_hash).toBeNull();
    });

    it("rejects an invalid username", async () => {
      const { code, err } = await cli(["add", "bad name"]);
      expect(code).toBe(1);
      expect(err).toMatch(/invalid username/i);
    });

    it("rejects a too-short password", async () => {
      const { code, err } = await cli(["add", "newbie"], ["short"]);
      expect(code).toBe(1);
      expect(err).toMatch(/at least/);
      expect(userService.getUser("newbie")).toBeUndefined();
    });

    it("rejects mismatched confirmation", async () => {
      const { code, err } = await cli(["add", "newbie"], ["newbie-password", "different-password"]);
      expect(code).toBe(1);
      expect(err).toMatch(/do not match/);
      expect(userService.getUser("newbie")).toBeUndefined();
    });
  });

  describe("set-password", () => {
    // The production migration path: the existing account gets its first
    // password without losing hidden history or logging out current sessions.
    it("sets a first password on a legacy account, keeping sessions and history", async () => {
      seedLegacyUser("legacy", [1, 2, 3]);

      const { code, out } = await cli(["set-password", "legacy"], ["legacy-password", "legacy-password"]);

      expect(code).toBe(0);
      expect(out).toMatch(/revoke-sessions/);
      const user = userService.getUser("legacy");
      expect(user.token_version).toBe(0);
      expect(await auth.verifyCredentials("legacy", "legacy-password")).not.toBeNull();
      const hidden = rawDb().prepare("SELECT count(*) c FROM hidden WHERE username = ?").get("legacy").c;
      expect(hidden).toBe(3);
    });

    it("resets an existing password", async () => {
      userService.createUser("alice", await auth.hashPassword("old-password", FAST));

      await cli(["set-password", "alice"], ["new-password", "new-password"]);

      expect(await auth.verifyCredentials("alice", "old-password")).toBeNull();
      expect(await auth.verifyCredentials("alice", "new-password")).not.toBeNull();
    });

    it("fails for an unknown account", async () => {
      const { code, err } = await cli(["set-password", "nobody"]);
      expect(code).toBe(1);
      expect(err).toMatch(/no such account/i);
    });
  });

  describe("revoke-sessions", () => {
    it("bumps the token version", async () => {
      seedLegacyUser("legacy");
      const { code } = await cli(["revoke-sessions", "legacy"]);
      expect(code).toBe(0);
      expect(userService.getUser("legacy").token_version).toBe(1);
    });

    it("fails for an unknown account", async () => {
      const { code } = await cli(["revoke-sessions", "nobody"]);
      expect(code).toBe(1);
    });
  });

  it("prints usage for an unknown command", async () => {
    const { code, err } = await cli(["frobnicate"]);
    expect(code).toBe(1);
    expect(err).toMatch(/Usage/);
  });

  it("requires a username for account commands", async () => {
    const { code, err } = await cli(["set-password"]);
    expect(code).toBe(1);
    expect(err).toMatch(/Usage/);
  });
});
