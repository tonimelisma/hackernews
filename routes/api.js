const express = require("express");
const router = express.Router();
const config = require("../util/config");
const { SignJWT, jwtVerify } = require("jose");
const rateLimit = require("express-rate-limit");
const { randomUUID } = require("crypto");

const storyService = require("../services/storyService");
const userService = require("../services/userService");
const auth = require("../services/auth");
const { createDbContext } = require("../util/dbLogger");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    const requestId = randomUUID();
    res.set("X-Login-Request-Id", requestId);
    console.log(`[login] requestId=${requestId} outcome=rate-limited`);
    res.status(options.statusCode).send(options.message);
  },
});

const TOKEN_EXPIRY = "365d";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

const secretKey = () => new TextEncoder().encode(process.env.SECRET);

// `tv` is the user's token_version at signing time; revoke-sessions bumps the
// stored version, invalidating every cookie signed before it.
const signToken = (user) =>
  new SignJWT({ username: user.username, tv: user.token_version })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(secretKey());

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging",
  sameSite: "strict",
  maxAge: COOKIE_MAX_AGE,
  path: "/api",
};

// Resolves the session cookie to a current user row, or null. Cookies issued
// before local passwords (HN-proxy era) have no `tv` claim; they count as
// version 0 so those sessions survived the migration. Throws on a bad JWT.
const sessionUser = async (req) => {
  const token = req.cookies && req.cookies.token;
  if (!token) return null;
  const { payload } = await jwtVerify(token, secretKey());
  if (typeof payload.username !== "string") return null;
  const user = userService.getUser(payload.username);
  if (!user || (payload.tv ?? 0) !== user.token_version) return null;
  return { username: user.username, token_version: user.token_version };
};

const authenticateToken = async (req, res, next) => {
  try {
    const user = await sessionUser(req);
    if (!user) {
      return res.status(401).json({ error: "authentication error" });
    }
    req.user = user;
    next();
  } catch (e) {
    console.error("auth error:", e);
    res.status(401).json({ error: "authentication error" });
  }
};

const optionalAuth = async (req) => {
  try {
    return await sessionUser(req);
  } catch {
    return null;
  }
};

router.get("/stories", async (req, res) => {
  const parseTimespan = timespan => {
    if (!timespan) return "All";
    switch (timespan) {
      case "Day":
      case "Week":
      case "Month":
      case "Year":
        return timespan;
      default:
        return "All";
    }
  };

  const limit =
    !isNaN(req.query.limit) && req.query.limit > 0 && req.query.limit <= config.limitResults
      ? parseInt(req.query.limit)
      : config.limitResults;

  const timespan = parseTimespan(req.query.timespan);

  const ctx = createDbContext();
  try {
    const user = await optionalAuth(req);
    const hiddenIds = user ? await storyService.getHidden(user.username, ctx) : [];

    const skip = !isNaN(req.query.skip) && req.query.skip > 0
      ? parseInt(req.query.skip)
      : undefined;

    const stories = await storyService.getStories(timespan, limit, skip, ctx, hiddenIds);

    res.json(stories);
    ctx.log("GET /stories", { timespan, count: stories.length });
  } catch (e) {
    console.error("GET /stories error:", e);
    res.status(500).json({ error: "internal server error" });
  }
});

router.get("/hidden", authenticateToken, async (req, res) => {
  const ctx = createDbContext();
  try {
    const hidden = await storyService.getHidden(req.user.username, ctx);
    res.status(200).json(hidden);
    ctx.log("GET /hidden", { user: req.user.username });
  } catch (e) {
    console.error("GET /hidden error:", e);
    res.status(500).json({ error: "internal server error" });
  }
});

router.post("/hidden", authenticateToken, async (req, res) => {
  if (!Number.isInteger(req.body.hidden) || req.body.hidden < 0) {
    return res.status(400).json({ error: "invalid story id" });
  }
  const ctx = createDbContext();
  try {
    await storyService.upsertHidden(req.user.username, req.body.hidden, ctx);
    res.status(200).json({ hidden: req.body.hidden });
    ctx.log("POST /hidden", { user: req.user.username });
  } catch (e) {
    console.error("POST /hidden error:", e);
    res.status(500).json({ error: "internal server error" });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  const requestId = randomUUID();
  res.set("X-Login-Request-Id", requestId);
  const { username, password } = req.body ?? {};
  if (
    !auth.isValidUsername(username) ||
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > auth.MAX_PASSWORD_LENGTH
  ) {
    console.log(`[login] requestId=${requestId} outcome=bad-request`);
    return res.status(400).json({ error: "missing fields" });
  }
  try {
    const user = await auth.verifyCredentials(username, password);
    if (!user) {
      console.log(`[login] requestId=${requestId} outcome=invalid-credentials`);
      return res.status(401).json({ error: "invalid credentials" });
    }
    res.cookie("token", await signToken(user), COOKIE_OPTIONS);
    res.status(200).json({ username: user.username });
    console.log(`[login] requestId=${requestId} outcome=success`);
  } catch (e) {
    console.error(`login error requestId=${requestId}:`, e);
    res.status(500).json({ error: "internal server error" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", COOKIE_OPTIONS);
  res.status(200).json({ success: true });
});

router.get("/me", authenticateToken, async (req, res) => {
  const token = await signToken(req.user);
  res.cookie("token", token, COOKIE_OPTIONS);
  res.status(200).json({ username: req.user.username });
});

module.exports = router;
