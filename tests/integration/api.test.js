const db = require("../setup");

// jsonwebtoken's transitive dependency buffer-equal-constant-time uses SlowBuffer
// which was removed in Node.js 25. We mock jsonwebtoken to avoid this.
const mockTokens = {};
jest.mock("jsonwebtoken", () => ({
  sign: (payload, secret, options) => {
    const token = `mock-token-${payload.username}-${Date.now()}`;
    mockTokens[token] = { ...payload, options };
    return token;
  },
  verify: (token, _secret) => {
    const payload = mockTokens[token];
    if (!payload) throw new Error("invalid token");
    return payload;
  },
}));

// Connect to database before requiring app (which requires storyService)
beforeAll(async () => {
  process.env.SECRET = "test-secret-key";
  await db.connect();
});

const request = require("supertest");
const app = require("../../app");

jest.mock("../../services/hackernews");
const hackernews = require("../../services/hackernews");

afterEach(async () => {
  const storyService = require("../../services/storyService");
  await storyService.clearCache();
  await db.clearDatabase();
  jest.clearAllMocks();
  // Clear token store
  Object.keys(mockTokens).forEach((k) => delete mockTokens[k]);
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

const createToken = (username = "testuser") => {
  const jwt = require("jsonwebtoken");
  return jwt.sign({ username }, process.env.SECRET);
};

const extractCookieToken = (res) => {
  const setCookie = res.headers["set-cookie"];
  if (!setCookie) return null;
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = cookieStr.match(/token=([^;]+)/);
  return match ? match[1] : null;
};

describe("API routes", () => {
  describe("GET /api/v1/stories", () => {
    it("returns stories as JSON", async () => {
      seedStory({ id: 1, score: 200 });
      seedStory({ id: 2, score: 100 });

      const res = await request(app).get("/api/v1/stories");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].score).toBe(200);
    });

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

    it("respects limit parameter", async () => {
      seedStory({ id: 1 });
      seedStory({ id: 2 });
      seedStory({ id: 3 });

      const res = await request(app).get("/api/v1/stories?limit=2");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("respects skip parameter", async () => {
      seedStory({ id: 1, score: 300 });
      seedStory({ id: 2, score: 200 });
      seedStory({ id: 3, score: 100 });

      const res = await request(app).get("/api/v1/stories?skip=1&limit=2");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].score).toBe(200);
    });

    it("defaults negative limit to config.limitResults", async () => {
      seedStory({ id: 1 });
      seedStory({ id: 2 });

      const res = await request(app).get("/api/v1/stories?limit=-1");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("defaults zero limit to config.limitResults", async () => {
      seedStory({ id: 1 });
      seedStory({ id: 2 });

      const res = await request(app).get("/api/v1/stories?limit=0");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("defaults invalid timespan to All", async () => {
      seedStory({ id: 1 });

      const res = await request(app).get("/api/v1/stories?timespan=Invalid");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("returns 500 when storyService throws", async () => {
      const storyService = require("../../services/storyService");
      const original = storyService.getStories;
      storyService.getStories = jest.fn().mockRejectedValue(new Error("db failure"));

      const res = await request(app).get("/api/v1/stories");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal server error");
      storyService.getStories = original;
    });

    it("excludes hidden stories when authenticated", async () => {
      seedStory({ id: 1, score: 300 });
      seedStory({ id: 2, score: 200 });
      seedStory({ id: 3, score: 100 });

      const { getDb } = require("../../services/database");
      const d = getDb();
      d.prepare("INSERT INTO users (username) VALUES (?)").run("testuser");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("testuser", 2);

      const token = createToken("testuser");
      const res = await request(app)
        .get("/api/v1/stories")
        .set("Cookie", `token=${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map(s => s.id)).not.toContain(2);
    });

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
    it("returns hidden list for authenticated user", async () => {
      const { getDb } = require("../../services/database");
      const d = getDb();
      d.prepare("INSERT INTO users (username) VALUES (?)").run("testuser");
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("testuser", 123);
      d.prepare("INSERT INTO hidden (username, story_id) VALUES (?, ?)").run("testuser", 456);
      const token = createToken("testuser");

      const res = await request(app)
        .get("/api/v1/hidden")
        .set("Cookie", `token=${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sort()).toEqual([123, 456]);
    });

    it("returns 401 without token", async () => {
      const res = await request(app).get("/api/v1/hidden");

      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid token", async () => {
      const res = await request(app)
        .get("/api/v1/hidden")
        .set("Cookie", "token=invalid-token");

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/hidden", () => {
    it("adds hidden ID for authenticated user", async () => {
      const { getDb } = require("../../services/database");
      getDb().prepare("INSERT INTO users (username) VALUES (?)").run("testuser");
      const token = createToken("testuser");

      const res = await request(app)
        .post("/api/v1/hidden")
        .set("Cookie", `token=${token}`)
        .send({ hidden: 789 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hidden: 789 });
    });

    it("returns 400 for non-integer hidden id", async () => {
      const token = createToken("testuser");

      const res = await request(app)
        .post("/api/v1/hidden")
        .set("Cookie", `token=${token}`)
        .send({ hidden: "abc" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid story id");
    });

    it("returns 400 for negative hidden id", async () => {
      const token = createToken("testuser");

      const res = await request(app)
        .post("/api/v1/hidden")
        .set("Cookie", `token=${token}`)
        .send({ hidden: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid story id");
    });

    it("returns 400 for missing hidden id", async () => {
      const token = createToken("testuser");

      const res = await request(app)
        .post("/api/v1/hidden")
        .set("Cookie", `token=${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid story id");
    });

    it("returns 401 without token", async () => {
      const res = await request(app)
        .post("/api/v1/hidden")
        .send({ hidden: 789 });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/login", () => {
    it("returns username and sets cookie on successful login", async () => {
      hackernews.login.mockResolvedValue(true);

      const res = await request(app)
        .post("/api/v1/login")
        .send({ goto: "news", acct: "validuser", pw: "validpass" });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe("validuser");
      expect(res.body.token).toBeUndefined();
      const cookieToken = extractCookieToken(res);
      expect(cookieToken).toBeTruthy();
    });

    it("returns 401 on failed login", async () => {
      hackernews.login.mockResolvedValue(false);

      const res = await request(app)
        .post("/api/v1/login")
        .send({ goto: "news", acct: "user", pw: "wrongpass" });

      expect(res.status).toBe(401);
    });

    it("returns 400 when fields are missing", async () => {
      const res = await request(app)
        .post("/api/v1/login")
        .send({ goto: "news" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("missing fields");
    });

    it("returns 400 for unsanitary username", async () => {
      const res = await request(app)
        .post("/api/v1/login")
        .send({ goto: "news", acct: "user<script>", pw: "pass" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("missing fields");
    });

    it("signs JWT with 24h expiration", async () => {
      hackernews.login.mockResolvedValue(true);

      const res = await request(app)
        .post("/api/v1/login")
        .send({ goto: "news", acct: "expiryuser", pw: "validpass" });

      expect(res.status).toBe(200);
      const cookieToken = extractCookieToken(res);
      const tokenData = mockTokens[cookieToken];
      expect(tokenData.options).toEqual({ expiresIn: '24h' });
    });

    it("creates user in DB on successful login", async () => {
      hackernews.login.mockResolvedValue(true);

      await request(app)
        .post("/api/v1/login")
        .send({ goto: "news", acct: "newuser", pw: "validpass" });

      const { getDb } = require("../../services/database");
      const user = getDb().prepare("SELECT * FROM users WHERE username = ?").get("newuser");
      expect(user).toBeDefined();
    });

    it("returns 500 on internal error during login", async () => {
      hackernews.login.mockRejectedValue(new Error("network failure"));

      const res = await request(app)
        .post("/api/v1/login")
        .send({ goto: "news", acct: "user", pw: "pass" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal server error");
    });

    it("returns 400 for username exceeding max length", async () => {
      const res = await request(app)
        .post("/api/v1/login")
        .send({ goto: "news", acct: "a".repeat(33), pw: "pass" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("missing fields");
    });

    // Must be last: exhausts the rate limiter's 10-request quota for the process
    it("returns 429 when rate limited", async () => {
      hackernews.login.mockResolvedValue(false);

      let got429 = false;
      for (let i = 0; i < 11; i++) {
        const res = await request(app)
          .post("/api/v1/login")
          .send({ goto: "news", acct: "user", pw: "pass" });
        if (res.status === 429) {
          got429 = true;
          break;
        }
      }
      expect(got429).toBe(true);
    });
  });

  describe("POST /api/v1/logout", () => {
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
    it("returns username for authenticated user", async () => {
      const token = createToken("testuser");

      const res = await request(app)
        .get("/api/v1/me")
        .set("Cookie", `token=${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ username: "testuser" });
    });

    it("returns 401 without token", async () => {
      const res = await request(app).get("/api/v1/me");

      expect(res.status).toBe(401);
    });
  });

  describe("Unknown endpoint", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await request(app).get("/api/v1/nonexistent");

      expect(res.status).toBe(404);
    });
  });
});
