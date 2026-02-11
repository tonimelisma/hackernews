const express = require("express");
const router = express.Router();
const config = require("../util/config");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const storyService = require("../services/storyService");
const hackernewsService = require("../services/hackernews");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const isValidUsername = (input) => {
  return /^[a-zA-Z0-9_-]+$/.test(input);
};

router.get("/get", async (req, res, next) => {
  const parseTimespan = timespan => {
    if (!timespan) return "All";
    switch (timespan) {
      case "Day":
      case "Week":
      case "Month":
      case "Year":
        return timespan;
        break;
      default:
        return "All";
        break;
    }
  };

  const limit =
    !isNaN(req.query.limit) && req.query.limit <= config.limitResults
      ? parseInt(req.query.limit)
      : config.limitResults;

  const timespan = parseTimespan(req.query.timespan);

  try {
    const stories =
      !isNaN(req.query.skip) && req.query.skip > 0
        ? await storyService.getStories(
          timespan,
          limit,
          parseInt(req.query.skip)
        )
        : await storyService.getStories(timespan, limit);

    res.json(stories);
  } catch (e) {
    console.error("GET /get error:", e);
    res.status(500).json({ error: "internal server error" });
  }
});

const getTokenFromReq = request => {
  const authorization = request.get("authorization");
  if (authorization && authorization.toLowerCase().startsWith("bearer")) {
    return authorization.substring(7);
  }
};

router.get("/hidden", async (req, res, next) => {
  const token = getTokenFromReq(req);

  try {
    const decodedToken = jwt.verify(token, process.env.SECRET);
    if (!token || !decodedToken.username) {
      return res.status(401).json({ error: "invalid token" });
    }

    console.log("getting hidden for username:", decodedToken.username);

    const hidden = await storyService.getHidden(decodedToken.username);
    res.status(200).json(hidden);
  } catch (e) {
    console.log("tokenerror: ", e);
    res.status(401).json({ error: "authentication error" });
  }
});

router.post("/hidden", async (req, res, next) => {
  const body = req.body;
  const token = getTokenFromReq(req);

  try {
    const decodedToken = jwt.verify(token, process.env.SECRET);
    if (!token || !decodedToken.username) {
      return res.status(401).json({ error: "invalid token" });
    }

    console.log("adding body.hidden:", body.hidden);
    console.log("for username:", decodedToken.username);

    await storyService.upsertHidden(decodedToken.username, body.hidden);
    res.status(200).json({ hidden: body.hidden });
  } catch (e) {
    console.log("tokenerror: ", e);
    res.status(401).json({ error: "authentication error" });
  }
});

router.post("/login", loginLimiter, async (req, res, next) => {
  const goto = req.body.goto;
  const pw = req.body.pw;
  const acct = req.body.acct;
  console.log("login attempt for:", acct);

  if (!goto || !pw || !acct || !isValidUsername(acct)) {
    res.status(400).json({ error: "missing fields" });
  } else {
    try {
      const loginCorrect = await hackernewsService.login(goto, acct, pw);
      if (loginCorrect) {
        const token = jwt.sign({ username: acct }, process.env.SECRET, { expiresIn: '24h' });
        await storyService.upsertUser(acct);
        res.status(200).json({ token });
      } else {
        res.status(401).json({ error: "False username or password" });
      }
    } catch (e) {
      console.log("login error: ", e);
      res.status(401).json({ error: "error occurred" });
    }
  }
});

module.exports = router;
