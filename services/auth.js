const crypto = require("crypto");
const { promisify } = require("util");
const userService = require("./userService");

const scrypt = promisify(crypto.scrypt);

// OWASP's scrypt option N=2^14, r=8, p=5: the same work factor as the
// N=2^17/p=1 option but only 16 MiB of memory per hash instead of 128 MiB.
// On the 1 GB e2-micro, N=2^17 pushed the box into swap (3.4 s per hash).
// Parameters are stored in each hash, so they can be raised later without a
// migration; old hashes keep verifying with the parameters they were made with.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 5 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 1024;

const isValidUsername = (input) =>
  typeof input === "string" && input.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(input);

const isValidNewPassword = (input) =>
  typeof input === "string" &&
  input.length >= MIN_PASSWORD_LENGTH &&
  input.length <= MAX_PASSWORD_LENGTH;

const derive = (password, salt, keyLength, { N, r, p }) =>
  scrypt(password, salt, keyLength, { N, r, p, maxmem: MAX_MEMORY });

// Format: scrypt$N$r$p$<salt base64>$<key base64>
const hashPassword = async (password, params = SCRYPT_PARAMS) => {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_LENGTH, params);
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64"), key.toString("base64")].join("$");
};

const verifyPassword = async (password, stored) => {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger)) return false;
  try {
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (expected.length === 0) return false;
    const actual = await derive(password, salt, expected.length, { N, r, p });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

// Unknown users and users without a password still pay for one hash, so the
// response time does not reveal which usernames exist.
let dummyHash;
const getDummyHash = () => {
  dummyHash ??= hashPassword(crypto.randomBytes(32).toString("hex"));
  return dummyHash;
};

const verifyCredentials = async (username, password) => {
  const user = userService.getUser(username);
  if (!user || !user.password_hash) {
    await verifyPassword(password, await getDummyHash());
    return null;
  }
  return (await verifyPassword(password, user.password_hash)) ? user : null;
};

module.exports = {
  SCRYPT_PARAMS,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  isValidUsername,
  isValidNewPassword,
  hashPassword,
  verifyPassword,
  verifyCredentials,
};
