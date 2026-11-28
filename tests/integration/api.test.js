const db = require("../setup");

const { SignJWT, jwtVerify } = require("jose");

// Connect to database before requiring app (which requires storyService)
beforeAll(async () => {
  process.env.SECRET = "test-secret-key";
  await db.connect();
});

const request = require("supertest");
const app = require("../../app");
const auth = require("../../services/auth");

// Low-cost scrypt parameters for seeded users; verification reads the
// parameters back out of the stored hash.
const FAST = { N: 1024, r: 8, p: 1 };

afterEach(async () => {
  await db.clearDatabase();
  jest.clearAllMocks();
});

afterAll(async () => await db.closeDatabase());

const seedStory = (overrides = {}) => {
  const { getDb } = require("../../services/database");
  const story = {
    id: 1,
    by: "author",
    descendants: 10,
    score: 100,
    time: Date.now(),
    title: "Test Story",
    url: "https://example.com",
    updated: Date.now(),
    ...overrides,
  };
  getDb().prepare(
    `INSERT OR REPLACE INTO stories (id, by, descendants, score, time, title, url, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(story.id, story.by, story.descendants, story.score, story.time, story.title, story.url, story.updated);
  return story;
};

const secretKey = () => new TextEncoder().encode(process.env.SECRET);

// Default shape matches cookies issued before local passwords existed
// (no `tv` claim); pass claims to mint newer tokens.
const createToken = async (username = "testuser", claims = {}) =>
  new SignJWT({ username, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(secretKey());

const rawDb = () => require("../../services/database").getDb();

// A user row as it exists in production before any password is set.
const seedLegacyUser = (username = "testuser") => {
  rawDb().prepare("INSERT INTO users (username) VALUES (?)").run(username);
};

const seedUser = async (username, password) => {
  rawDb()
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run(username, await auth.hashPassword(password, FAST));
};

// The login limiter is per client IP (app trusts one proxy hop, like a reverse proxy in
// production), so each call gets its own address unless one is pinned.
let clientCounter = 0;
const nextClientIp = () => {
  clientCounter += 1;
  return `10.0.${Math.floor(clientCounter / 250)}.${(clientCounter % 250) + 1}`;
};

const login = (body, ip = nextClientIp()) =>
  request(app).post("/api/v1/login").set("X-Forwarded-For", ip).send(body);

const extractCookieToken = (res) => {
  const setCookie = res.headers["set-cookie"];
  if (!setCookie) return null;
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = cookieStr.match(/token=([^;]+)/);
  return match ? match[1] : null;
};

describe("API routes", () => {
  describe("GET /api/v1/stories", () => {
    // Validates: HN-001
    it("returns stories as JSON", async () => {
      seedStory({ id: 1, score: 200 });
      seedStory({ id: 2, score: 100 });

      const res = await request(app).get("/api/v1/stories");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].score).toBe(200);
    });

    // Validates: HN-001
    it("filters by timespan", async () => {
      seedStory({ id: 1, time: Date.now() }); // recent
      seedStory({
        id: 2,
        time: Date.now() - 48 * 60 * 60 * 1000,
      }); // 2 days ago

      const res = await request(app).get("/api/v1/stories?timespan=Day");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    // Validates: HN-002
    it("defaults to All when no timespan specified", async () => {
      seedStory({ id: 1, time: Date.now() });
      seedStory({
        id: 2,
        time: Date.now() - 400 * 24 * 60 * 60 * 1000,
      });

      const res = await request(app).get("/api/v1/stories");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    // Validates: HN-003
    it("respects limit parameter", async () => {
      seedStory({ id: 1 });
      seedStory({ id: 2 });
      seedStory({ id: 3 });

      const res = await request(app).get("/api/v1/stories?limit=2");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    // Validates: HN-003
    it("respects skip parameter", async () => {
      seedStory({ id: 1, score: 300 });
      seedStory({ id: 2, score: 200 });
      seedStory({ id: 3, score: 100 });

      const res = await request(app).get("/api/v1/stories?skip=1&limit=2");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].score).toBe(200);
    });

    // Validates: HN-004
    it("defaults negative limit to config.limitResults", async () => {
      seedStory({ id: 1 });
      seedStory({ id: 2 });

      const res = await request(app).get("/api/v1/stories?limit=-1");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    // Validates: HN-004
    it("defaults zero limit to config.limitResults", async () => {
      seedStory({ id: 1 });
      seedStory({ id: 2 });

      const res = await request(app).get("/api/v1/stories?limit=0");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    // Validates: HN-002
    it("defaults invalid timespan to All", async () => {
      seedStory({ id: 1 });

      const res = await request(app).get("/api/v1/stories?timespan=Invalid");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    // Validates: HN-009
    it("returns 500 when storyService throws", async () => {
      const storyService = require("../../services/storyService");
      const original = storyService.getStories;
      storyService.getStories = jest.fn().mockRejectedValue(new Error("db failure"));

      const res = await request(app).get("/api/v1/stories");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal server error");
      storyService.getStories = original;
    });

    // Validates: HN-005
    it("excludes hidden stories when authenticated", async () => {
      seedStory({ id: 1, score: 300 });
      seedStory({ id: 2, score: 200 });
      seedStory({ id: 3, score: 100 });

      const { getDb } = require("../../services/database");
      const d = getDb();
      d.prepare("INSERT INTO users (username) VALUES (?)").run("testuser");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("testuser", 2);

      const token = await createToken("testuser");
      const res = await request(app)
        .get("/api/v1/stories")
        .set("Cookie", `token=${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map(s => s.id)).not.toContain(2);
    });

    // Validates: HN-005
    it("returns all stories without auth cookie", async () => {
      seedStory({ id: 1, score: 300 });
      seedStory({ id: 2, score: 200 });
      seedStory({ id: 3, score: 100 });

      const res = await request(app).get("/api/v1/stories");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });
  });

  describe("GET /api/v1/hidden", () => {
    // Validates: HN-013
    it("returns hidden list for authenticated user", async () => {
      const { getDb } = require("../../services/database");
      const d = getDb();
      d.prepare("INSERT INTO users (username) VALUES (?)").run("testuser");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("testuser", 123);
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("testuser", 456);
      const token = await createToken("testuser");

      const res = await request(app)
        .get("/api/v1/hidden")
        .set("Cookie", `token=${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sort()).toEqual([123, 456]);
    });

    // Validates: HN-014
    it("returns 401 without token", async () => {
      const res = await request(app).get("/api/v1/hidden");

      expect(res.status).toBe(401);
    });

    // Validates: HN-014
    it("returns 401 with invalid token", async () => {
      const res = await request(app)
        .get("/api/v1/hidden")
        .set("Cookie", "token=invalid-token");

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/hidden", () => {
    // Validates: HN-011
    it("adds hidden ID for authenticated user", async () => {
      const { getDb } = require("../../services/database");
      getDb().prepare("INSERT INTO users (username) VALUES (?)").run("testuser");
      const token = await createToken("testuser");

      const res = await request(app)
        .post("/api/v1/hidden")
        .set("Cookie", `token=${token}`)
        .send({ hidden: 789 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hidden: 789 });
    });

    // Validates: HN-012
    it("returns 400 for non-integer hidden id", async () => {
      seedLegacyUser("testuser");
      const token = await createToken("testuser");

      const res = await request(app)
        .post("/api/v1/hidden")
        .set("Cookie", `token=${token}`)
        .send({ hidden: "abc" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid story id");
    });

    // Validates: HN-012
    it("returns 400 for negative hidden id", async () => {
      seedLegacyUser("testuser");
      const token = await createToken("testuser");

      const res = await request(app)
        .post("/api/v1/hidden")
        .set("Cookie", `token=${token}`)
        .send({ hidden: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid story id");
    });

    // Validates: HN-012
    it("returns 400 for missing hidden id", async () => {
      seedLegacyUser("testuser");
      const token = await createToken("testuser");

      const res = await request(app)
        .post("/api/v1/hidden")
        .set("Cookie", `token=${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid story id");
    });

    // Validates: HN-014
    it("returns 401 without token", async () => {
      const res = await request(app)
        .post("/api/v1/hidden")
        .send({ hidden: 789 });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/login", () => {
    // Validates: HN-015
    it("returns username and sets cookie for correct password", async () => {
      await seedUser("validuser", "valid-password");

      const res = await login({ username: "validuser", password: "valid-password" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ username: "validuser" });
      expect(res.headers["x-login-request-id"]).toBeTruthy();
      expect(extractCookieToken(res)).toBeTruthy();
    });

    // Validates: HN-015
    it("signs JWT with 365d expiration and the user's token version", async () => {
      await seedUser("expiryuser", "valid-password");
      rawDb().prepare("UPDATE users SET token_version = 4 WHERE username = ?").run("expiryuser");

      const res = await login({ username: "expiryuser", password: "valid-password" });

      const { payload } = await jwtVerify(extractCookieToken(res), secretKey());
      expect(payload.username).toBe("expiryuser");
      expect(payload.tv).toBe(4);
      expect(payload.exp - payload.iat).toBe(365 * 24 * 60 * 60);
    });

    // Validates: HN-016
    it("returns 401 for a wrong password", async () => {
      await seedUser("validuser", "valid-password");

      const res = await login({ username: "validuser", password: "wrong-password" });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "invalid credentials" });
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    // Validates: HN-016
    it("returns the same 401 for an unknown user", async () => {
      const res = await login({ username: "nobody", password: "whatever-password" });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "invalid credentials" });
    });

    // Validates: HN-016
    it("returns 401 for an existing user who has no password yet", async () => {
      seedLegacyUser("legacy");

      const res = await login({ username: "legacy", password: "anything-at-all" });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "invalid credentials" });
    });

    // Validates: HN-017
    it("never creates users on login", async () => {
      await login({ username: "ghost", password: "whatever-password" });

      const user = rawDb().prepare("SELECT * FROM users WHERE username = ?").get("ghost");
      expect(user).toBeUndefined();
    });

    // Validates: HN-018
    it("does not log usernames or passwords on failure", async () => {
      await seedUser("secretive", "valid-password");

      await login({ username: "secretive", password: "wrong-canary-pw" });

      const logged = [...console.log.mock.calls, ...console.error.mock.calls].flat().join(" ");
      expect(logged).toMatch(/\[login\] requestId=\S+ outcome=invalid-credentials/);
      expect(logged).not.toContain("secretive");
      expect(logged).not.toContain("wrong-canary-pw");
    });

    // Validates: HN-073
    it.each([
      ["missing fields", {}],
      ["missing password", { username: "user" }],
      ["missing username", { password: "pass" }],
      ["empty password", { username: "user", password: "" }],
      ["unsanitary username", { username: "user<script>", password: "pass" }],
      ["overlong username", { username: "a".repeat(33), password: "pass" }],
      ["overlong password", { username: "user", password: "p".repeat(auth.MAX_PASSWORD_LENGTH + 1) }],
      ["non-string password", { username: "user", password: { $gt: "" } }],
      ["legacy HN payload", { goto: "news", acct: "user", pw: "pass" }],
    ])("returns 400 for %s", async (_label, body) => {
      const res = await login(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("missing fields");
    });

    // Validates: HN-020
    it("returns 500 on internal error during login", async () => {
      const original = auth.verifyCredentials;
      auth.verifyCredentials = jest.fn().mockRejectedValue(new Error("db failure"));

      const res = await login({ username: "user", password: "some-password" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal server error");
      auth.verifyCredentials = original;
    });

    // Validates: HN-019
    it("returns 429 after 10 attempts from one IP, without blocking other IPs", async () => {
      const attackerIp = "203.0.113.7";
      const statuses = [];
      for (let i = 0; i < 11; i++) {
        statuses.push((await login({}, attackerIp)).status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
      expect(statuses[10]).toBe(429);

      await seedUser("bystander", "bystander-password");
      const other = await login({ username: "bystander", password: "bystander-password" });
      expect(other.status).toBe(200);
    });
  });

  describe("POST /api/v1/logout", () => {
    // Validates: HN-021
    it("clears token cookie and returns success", async () => {
      const res = await request(app).post("/api/v1/logout");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toMatch(/token=/);
    });
  });

  describe("GET /api/v1/me", () => {
    // Validates: HN-022
    it("returns username for authenticated user", async () => {
      seedLegacyUser("testuser");
      const token = await createToken("testuser");

      const res = await request(app)
        .get("/api/v1/me")
        .set("Cookie", `token=${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ username: "testuser" });
    });

    // Validates: HN-022
    it("refreshes token cookie on GET /me", async () => {
      seedLegacyUser("refreshuser");
      const token = await createToken("refreshuser");

      const res = await request(app)
        .get("/api/v1/me")
        .set("Cookie", `token=${token}`);

      expect(res.status).toBe(200);
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      expect(setCookie[0]).toMatch(/^token=/);
    });

    // Validates: HN-014
    it("returns 401 without token", async () => {
      const res = await request(app).get("/api/v1/me");

      expect(res.status).toBe(401);
    });

    // Validates: HN-014
    it("returns 401 for a token without a username", async () => {
      const token = await new SignJWT({ tv: 0 })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("365d")
        .sign(secretKey());

      const res = await request(app).get("/api/v1/me").set("Cookie", `token=${token}`);

      expect(res.status).toBe(401);
    });
  });

  // Moving from HN-proxied login to local passwords must not log out anyone
  // who is already signed in, nor touch their hidden-story history.
  describe("sessions", () => {
    // Validates: HN-023
    it("keeps a pre-migration cookie (no tv claim) valid everywhere", async () => {
      seedStory({ id: 1, score: 300 });
      seedStory({ id: 2, score: 200 });
      seedLegacyUser("legacy");
      rawDb().prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("legacy", 2);
      const legacyToken = await createToken("legacy");

      const me = await request(app).get("/api/v1/me").set("Cookie", `token=${legacyToken}`);
      const hidden = await request(app).get("/api/v1/hidden").set("Cookie", `token=${legacyToken}`);
      const stories = await request(app).get("/api/v1/stories").set("Cookie", `token=${legacyToken}`);
      const hide = await request(app)
        .post("/api/v1/hidden")
        .set("Cookie", `token=${legacyToken}`)
        .send({ hidden: 1 });

      expect(me.status).toBe(200);
      expect(me.body).toEqual({ username: "legacy" });
      expect(hidden.body).toEqual([2]);
      expect(stories.body.map((s) => s.id)).toEqual([1]);
      expect(hide.status).toBe(200);
    });

    // Validates: HN-022, HN-023
    it("upgrades a pre-migration cookie to a versioned one on GET /me", async () => {
      seedLegacyUser("legacy");
      const legacyToken = await createToken("legacy");

      const res = await request(app).get("/api/v1/me").set("Cookie", `token=${legacyToken}`);

      const { payload } = await jwtVerify(extractCookieToken(res), secretKey());
      expect(payload).toMatchObject({ username: "legacy", tv: 0 });
    });

    // Validates: HN-023
    it("keeps the pre-migration cookie valid after the first password is set", async () => {
      seedLegacyUser("legacy");
      const legacyToken = await createToken("legacy");
      rawDb()
        .prepare("UPDATE users SET password_hash = ? WHERE username = ?")
        .run(await auth.hashPassword("new-password", FAST), "legacy");

      const res = await request(app).get("/api/v1/me").set("Cookie", `token=${legacyToken}`);

      expect(res.status).toBe(200);
    });

    // Validates: HN-021
    it("supports simultaneous sessions; logging out one leaves the others", async () => {
      await seedUser("multi", "multi-password");
      const browserA = extractCookieToken(await login({ username: "multi", password: "multi-password" }));
      const browserB = extractCookieToken(await login({ username: "multi", password: "multi-password" }));

      await request(app).post("/api/v1/logout").set("Cookie", `token=${browserB}`);

      const a = await request(app).get("/api/v1/me").set("Cookie", `token=${browserA}`);
      const b = await request(app).get("/api/v1/hidden").set("Cookie", `token=${browserB}`);
      expect(a.status).toBe(200);
      // Logout clears the browser's cookie; the token itself stays valid until
      // revoked, which is what lets other browsers stay signed in.
      expect(b.status).toBe(200);
    });

    // Validates: HN-023, HN-028
    it("revoking sessions logs out every existing cookie", async () => {
      seedStory({ id: 1 });
      seedLegacyUser("legacy");
      rawDb().prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("legacy", 1);
      const legacyToken = await createToken("legacy");
      const versionedToken = await createToken("legacy", { tv: 0 });
      rawDb().prepare("UPDATE users SET token_version = token_version + 1 WHERE username = ?").run("legacy");

      for (const token of [legacyToken, versionedToken]) {
        const me = await request(app).get("/api/v1/me").set("Cookie", `token=${token}`);
        expect(me.status).toBe(401);
      }
      // Revoked cookies read /stories as anonymous: nothing filtered out.
      const stories = await request(app).get("/api/v1/stories").set("Cookie", `token=${legacyToken}`);
      expect(stories.body.map((s) => s.id)).toEqual([1]);
    });

    // Validates: HN-023
    it("rejects a valid token for a user that no longer exists", async () => {
      const token = await createToken("deleted");

      const res = await request(app).get("/api/v1/me").set("Cookie", `token=${token}`);

      expect(res.status).toBe(401);
    });
  });

  describe("Unknown endpoint", () => {
    // Validates: HN-010
    it("returns 404 for unknown routes", async () => {
      const res = await request(app).get("/api/v1/nonexistent");

      expect(res.status).toBe(404);
    });
  });
});
