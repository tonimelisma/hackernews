const config = require("./util/config");

const express = require("express");
const cors = require("cors");

const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");

const apiRouter = require("./routes/api");
const middleware = require("./util/middleware");

const app = express();

app.use(logger("dev"));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// STATIC
app.use(express.static(path.join(__dirname, "hackernews-frontend/build")));

// ROUTES
app.use("/api/v1", apiRouter);

// ERRORS
app.use(middleware.unknownEndpoint);
app.use(middleware.errorHandler);

module.exports = app;
