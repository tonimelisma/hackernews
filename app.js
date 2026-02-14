const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const path = require("path");
const logger = require("morgan");

const apiRouter = require("./routes/api");
const middleware = require("./util/middleware");

const app = express();

app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "https://www.google.com", "https://*.gstatic.com"],
      "script-src": ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(logger(process.env.NODE_ENV === "production" ? "combined" : "dev"));

const corsOrigin = process.env.NODE_ENV === "development"
  ? "http://localhost:3000"
  : false;
app.use(cors({ origin: corsOrigin }));

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

// STATIC
// Hashed assets are immutable — cache forever
const buildPath = path.join(__dirname, "hackernews-frontend/build");
app.use("/assets", express.static(path.join(buildPath, "assets"), {
  maxAge: "1y",
  immutable: true,
}));
// index.html must never be cached — App Engine sets all file mtimes to
// 1980-01-01, so Express ETags (based on size+mtime) don't change between
// deploys, causing browsers to serve stale HTML referencing old JS hashes.
app.use(express.static(buildPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));

// ROUTES
app.use("/api/v1", apiRouter);

app.get("/_ah/worker", async (req, res) => {
  if (req.get("X-Appengine-Cron") !== "true") {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    const { syncOnce } = require("./worker");
    await syncOnce();
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
