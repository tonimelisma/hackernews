const express = require("express");
const router = express.Router();
const config = require("../util/config");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const storyService = require("../services/storyService");
const hackernewsService = require("../services/hackernews");
const { createDbContext } = require("../util/dbLogger");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const isValidUsername = (input) => {
  return input.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(input);
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging",
  sameSite: "strict",
  maxAge: 24 * 60 * 60 * 1000,
  path: "/api",
};

const authenticateToken = (req, res, next) => {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: "authentication error" });
  }
  try {
    const decodedToken = jwt.verify(token, process.env.SECRET);
    if (!decodedToken.username) {
      return res.status(401).json({ error: "invalid token" });
    }
    req.user = decodedToken;
    next();
  } catch (e) {
    console.error("auth error:", e);
    res.status(401).json({ error: "authentication error" });
  }
};

const optionalAuth = (req) => {
  const token = req.cookies && req.cookies.token;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.SECRET);
    return decoded.username ? { username: decoded.username } : null;
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
    const user = optionalAuth(req);
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
  const goto = req.body.goto;
  const pw = req.body.pw;
  const acct = req.body.acct;
  if (!goto || !pw || !acct || !isValidUsername(acct)) {
    res.status(400).json({ error: "missing fields" });
  } else {
    try {
      const ctx = createDbContext();
      const loginCorrect = await hackernewsService.login(goto, acct, pw);
      if (loginCorrect) {
        const token = jwt.sign({ username: acct }, process.env.SECRET, { expiresIn: '24h' });
        await storyService.upsertUser(acct, ctx);
        res.cookie("token", token, COOKIE_OPTIONS);
        res.status(200).json({ username: acct });
        ctx.log("POST /login", { user: acct });
      } else {
        res.status(401).json({ error: "invalid credentials" });
      }
    } catch (e) {
      console.error("login error:", e);
      res.status(500).json({ error: "internal server error" });
    }
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", COOKIE_OPTIONS);
  res.status(200).json({ success: true });
});

router.get("/me", authenticateToken, (req, res) => {
  res.status(200).json({ username: req.user.username });
});

module.exports = router;
