const { getDb } = require("./database");

const getUser = (username) =>
  getDb()
    .prepare("SELECT username, password_hash, token_version, created_at FROM users WHERE username = ?")
    .get(username);

const createUser = (username, passwordHash) => {
  getDb()
    .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
    .run(username, passwordHash, Date.now());
};

// Deliberately leaves token_version alone: setting or resetting a password does
// not log out other browsers. Use revokeSessions for that.
const setPasswordHash = (username, passwordHash) =>
  getDb()
    .prepare("UPDATE users SET password_hash = ? WHERE username = ?")
    .run(passwordHash, username).changes === 1;

// Invalidates every issued session cookie for the user (they carry the old tv).
const revokeSessions = (username) =>
  getDb()
    .prepare("UPDATE users SET token_version = token_version + 1 WHERE username = ?")
    .run(username).changes === 1;

const listUsers = () =>
  getDb()
    .prepare(
      `SELECT u.username,
              u.password_hash IS NOT NULL AS has_password,
              u.token_version,
              u.created_at,
              (SELECT count(*) FROM hidden h WHERE h.username = u.username) AS hidden_count
       FROM users u
       ORDER BY u.username`
    )
    .all();

module.exports = { getUser, createUser, setPasswordHash, revokeSessions, listUsers };
