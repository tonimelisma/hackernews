// Local username/password accounts, replacing login-by-proxy to Hacker News
// (HN serves a reCAPTCHA to logins from the VPS's datacenter IP, so every
// proxied login failed as "invalid credentials").
//
// Purely additive: existing rows keep their username (the key every hidden
// story hangs off) and get password_hash NULL / token_version 0. A NULL
// password cannot log in until one is set with scripts/users.js, but existing
// session cookies keep working because they carry no `tv` claim, which the
// auth middleware reads as version 0.
const up = (db) => {
  db.exec(`
    ALTER TABLE users ADD COLUMN password_hash TEXT;
    ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN created_at INTEGER;
  `);
};

const down = (db) => {
  db.exec(`
    ALTER TABLE users DROP COLUMN created_at;
    ALTER TABLE users DROP COLUMN token_version;
    ALTER TABLE users DROP COLUMN password_hash;
  `);
};

module.exports = { up, down };
