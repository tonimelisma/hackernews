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
      "script-src": ["'self'", "'sha256-8y8P8Mwo9xa1B5mBjxyt9mk3G0AxFcNMDqIEmr6vUkQ='"],
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
app.use(express.static(buildPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));

// ROUTES
app.use("/api/v1", apiRouter);

// ERRORS
app.use(middleware.unknownEndpoint);
app.use(middleware.errorHandler);

module.exports = app;
