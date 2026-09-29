#!/usr/bin/env node

// Manual account administration: there is no self-service signup or password
// reset. In production, run inside the app container, e.g.
//   docker exec -it hackernews-app-1 node scripts/users.js set-password <username>
// Passwords are always prompted for (hidden on a TTY, one per line when piped),
// never taken from argv, so they stay out of shell history and `ps`.

const readline = require("readline");
const auth = require("../services/auth");
const userService = require("../services/userService");

const USAGE = `Usage: node scripts/users.js <command>
  list                        List accounts
  add <username>              Create an account (prompts for a password)
  set-password <username>     Set or reset a password (other browsers stay logged in)
  revoke-sessions <username>  Log the account out of every browser`;

class CliError extends Error {}

const promptNewPassword = async (readPassword) => {
  const password = await readPassword("New password: ");
  if (!auth.isValidNewPassword(password)) {
    throw new CliError(
      `Password must be at least ${auth.MIN_PASSWORD_LENGTH} and at most ${auth.MAX_PASSWORD_LENGTH} characters.`
    );
  }
  if ((await readPassword("Repeat password: ")) !== password) {
    throw new CliError("Passwords do not match.");
  }
  return password;
};

const requireExisting = (username) => {
  if (!userService.getUser(username)) {
    throw new CliError(`No such account: ${username} (create it with "add").`);
  }
};

const commands = {
  list: async (_username, { log }) => {
    const users = userService.listUsers();
    if (users.length === 0) {
      log("No accounts.");
      return;
    }
    for (const u of users) {
      const created = u.created_at ? new Date(u.created_at).toISOString() : "-";
      log(
        `${u.username}  password=${u.has_password ? "set" : "NOT SET"}  ` +
          `session-version=${u.token_version}  hidden=${u.hidden_count}  created=${created}`
      );
    }
  },

  add: async (username, { readPassword, log }) => {
    if (!auth.isValidUsername(username)) {
      throw new CliError("Invalid username: use 1-32 letters, digits, _ or -.");
    }
    if (userService.getUser(username)) {
      throw new CliError(`Account ${username} already exists (use "set-password").`);
    }
    const password = await promptNewPassword(readPassword);
    userService.createUser(username, await auth.hashPassword(password));
    log(`Created account ${username}.`);
  },

  "set-password": async (username, { readPassword, log }) => {
    requireExisting(username);
    const password = await promptNewPassword(readPassword);
    userService.setPasswordHash(username, await auth.hashPassword(password));
    log(
      `Password set for ${username}. Browsers already logged in stay logged in; ` +
        `run "revoke-sessions ${username}" to log them all out.`
    );
  },

  "revoke-sessions": async (username, { log }) => {
    requireExisting(username);
    userService.revokeSessions(username);
    log(`Every browser session for ${username} is now logged out.`);
  },
};

const run = async ([command, username] = [], io) => {
  const { error = console.error } = io;
  const handler = commands[command];
  if (!handler || (command !== "list" && !username)) {
    error(USAGE);
    return 1;
  }
  try {
    await handler(username, { log: console.log, ...io });
    return 0;
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    error(e.message);
    return 1;
  }
};

// Hidden input on a TTY: raw mode, no echo, backspace and Ctrl-C handled.
const ttyPasswordReader = (input, output) => (prompt) =>
  new Promise((resolve, reject) => {
    let value = "";
    const finish = (fn, arg) => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      fn(arg);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish(resolve, value);
        if (ch === "\u0003") return finish(reject, new CliError("Aborted."));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    output.write(prompt);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
  });

// Piped input (non-TTY): one password per line.
const pipedPasswordReader = (input) => {
  const lines = readline.createInterface({ input })[Symbol.asyncIterator]();
  return async () => {
    const { value, done } = await lines.next();
    if (done) throw new CliError("Unexpected end of input while reading password.");
    return value;
  };
};

const main = async () => {
  require("dotenv").config({ quiet: true });
  const readPassword = process.stdin.isTTY
    ? ttyPasswordReader(process.stdin, process.stderr)
    : pipedPasswordReader(process.stdin);
  const code = await run(process.argv.slice(2), { readPassword });
  process.exit(code);
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { run };
