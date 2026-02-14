const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const path = require("path");
const logger = require("morgan");

const apiRouter = require("./routes/api");
const middleware = require("./util/middleware");

const app = express();

app.use(helmet());
app.use(logger(process.env.NODE_ENV === "production" ? "combined" : "dev"));

const corsOrigin = process.env.NODE_ENV === "development"
  ? "http://localhost:3000"
  : false;
app.use(cors({ origin: corsOrigin }));

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

// STATIC
app.use(express.static(path.join(__dirname, "hackernews-frontend/build")));

// ROUTES
app.use("/api/v1", apiRouter);

app.get("/_ah/worker", async (req, res) => {
  if (req.get("X-Appengine-Cron") !== "true") {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    const { syncOnce } = require("./worker");
    const { clearCache } = require("./services/storyService");
    await syncOnce();
    clearCache();
    res.status(200).json({ status: "sync complete" });
  } catch (e) {
    console.error("worker endpoint error:", e);
    res.status(500).json({ error: "sync failed" });
  }
});

// ERRORS
app.use(middleware.unknownEndpoint);
app.use(middleware.errorHandler);

module.exports = app;
