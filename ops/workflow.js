#!/usr/bin/env node

// Request parsing and log filtering for .github/workflows/ops.yml.
//
// This repo is public, so the workflow's logs are public. Everything this file
// prints goes to that log: it must never contain a request's values (user
// names, backup names, confirm text), only fixed messages and numbers. The
// values go to files under the work directory, which the workflow encrypts.
//
// Runs on a bare runner with no npm install: Node built-ins only.

const fs = require("fs");
const path = require("path");

// Where each job runs and what it needs. "vps" jobs run ops/remote.sh on vps-1
// over the IAP tunnel; "runner" jobs talk to the backup bucket directly.
const JOBS = {
  "users-list": { where: "vps" },
  "users-add": { where: "vps", username: true, password: true },
  "users-set-password": { where: "vps", username: true, password: true },
  "users-revoke-sessions": { where: "vps", username: true },
  logs: { where: "vps", lines: true },
  health: { where: "vps" },
  "db-stats": { where: "vps" },
  backup: { where: "vps" },
  restore: { where: "vps", backup: true, confirm: true },
  "backups-list": { where: "runner" },
  "backups-download": { where: "runner", backup: true },
};

// Same rule as services/auth.js isValidUsername (that module needs the
// database, which the ops runner does not install); tests keep them equal.
const USERNAME = /^[a-zA-Z0-9_-]{1,32}$/;
// Daily backups (scripts/backup-sqlite.sh) and the safety copies restore makes.
const BACKUP = /^(hackernews-\d{8}|prerestore-\d{8}T\d{6}Z)\.db\.gz$/;
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const DEFAULT_LINES = 200;
const MAX_LINES = 5000;
const SUMMARY = /^HN_OPS_SUMMARY( [a-z][a-z0-9_]{0,31}=\d{1,15}){1,20}$/;

class OpsError extends Error {}

const parseRequest = (eventName, event) => {
  let p;
  if (eventName === "repository_dispatch") p = event.client_payload || {};
  else if (eventName === "workflow_dispatch") p = event.inputs || {};
  else throw new OpsError("Unsupported event: use repository_dispatch or workflow_dispatch.");

  const job = JOBS[p.job];
  if (!job) throw new OpsError(`Unknown job. Valid jobs: ${Object.keys(JOBS).join(", ")}.`);

  const request = { job: p.job, where: job.where };

  if (p.request_id !== undefined && p.request_id !== "") {
    if (typeof p.request_id !== "string" || !REQUEST_ID.test(p.request_id)) {
      throw new OpsError("request_id must be 8-64 letters, digits or dashes.");
    }
    request.requestId = p.request_id;
  }

  if (job.username) {
    // workflow_dispatch inputs are shown in the public run page; user names
    // only travel in a repository_dispatch payload, which is not.
    if (eventName !== "repository_dispatch") {
      throw new OpsError("User jobs take the username via repository_dispatch only.");
    }
    if (typeof p.username !== "string" || !USERNAME.test(p.username)) {
      throw new OpsError("username must be 1-32 letters, digits, _ or -.");
    }
    request.username = p.username;
  }

  if (job.backup) {
    if (typeof p.backup !== "string" || !BACKUP.test(p.backup)) {
      throw new OpsError(
        "backup must name an object like hackernews-YYYYMMDD.db.gz or prerestore-YYYYMMDDTHHMMSSZ.db.gz."
      );
    }
    request.backup = p.backup;
  }

  if (job.confirm && p.confirm !== `restore ${p.backup}`) {
    throw new OpsError('restore overwrites the production database: set confirm to "restore <backup>" exactly.');
  }

  if (job.lines) {
    const raw = p.lines === undefined || p.lines === "" ? DEFAULT_LINES : p.lines;
    const lines = Number(raw);
    if (!Number.isInteger(lines) || lines < 1 || lines > MAX_LINES) {
      throw new OpsError(`lines must be a whole number from 1 to ${MAX_LINES}.`);
    }
    request.lines = lines;
  }

  request.generatePassword = Boolean(job.password);
  return request;
};

// The one log line a remote job may print publicly: "HN_OPS_SUMMARY k=1 ...".
// Anything else (a user name, an IP, a log line) fails the pattern.
const safeSummary = (text) => {
  const lines = text.split("\n").filter((l) => l.startsWith("HN_OPS_SUMMARY"));
  const last = lines.at(-1);
  return last !== undefined && SUMMARY.test(last) ? last : null;
};

const writeOutputs = (outputs) => {
  const body = Object.entries(outputs)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${body}\n`);
};

const main = (argv) => {
  const [command, arg] = argv;
  if (command === "request") {
    // arg: private work directory (not uploaded unencrypted).
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    let request;
    try {
      request = parseRequest(process.env.GITHUB_EVENT_NAME, event);
    } catch (e) {
      if (!(e instanceof OpsError)) throw e;
      console.log(`::error::${e.message}`);
      return 1;
    }
    fs.mkdirSync(arg, { recursive: true, mode: 0o700 });
    if (request.username) {
      console.log(`::add-mask::${request.username}`);
      fs.writeFileSync(path.join(arg, "username"), request.username, { mode: 0o600 });
    }
    writeOutputs({
      job: request.job,
      where: request.where,
      backup: request.backup || "",
      lines: request.lines || "",
      generate_password: request.generatePassword,
      artifact: `hn-ops-${request.requestId || process.env.GITHUB_RUN_ID}`,
    });
    console.log(`Request OK: ${request.job} (${request.where}).`);
    return 0;
  }
  if (command === "summary") {
    const text = fs.existsSync(arg) ? fs.readFileSync(arg, "utf8") : "";
    const summary = safeSummary(text);
    console.log(summary || "HN_OPS_SUMMARY unavailable (details are in the encrypted artifact)");
    if (summary && process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`${summary}\`\n`);
    }
    return summary ? 0 : 1;
  }
  console.error("Usage: node ops/workflow.js request <workdir> | summary <file>");
  return 2;
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { JOBS, USERNAME, BACKUP, parseRequest, safeSummary, OpsError, main };
