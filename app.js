const config = require("./util/config");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const path = require("path");
const logger = require("morgan");

const apiRouter = require("./routes/api");
const middleware = require("./util/middleware");

const app = express();

app.use(helmet());
app.use(logger("dev"));

const corsOrigin = process.env.NODE_ENV === "development"
  ? "http://localhost:3000"
  : false;
app.use(cors({ origin: corsOrigin }));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// STATIC
app.use(express.static(path.join(__dirname, "hackernews-frontend/build")));

// ROUTES
app.use("/api/v1", apiRouter);

// ERRORS
app.use(middleware.unknownEndpoint);
app.use(middleware.errorHandler);

module.exports = app;
