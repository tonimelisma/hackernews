# Known Issues

## Security Issues

| Severity | Location | Description |
|----------|----------|-------------|
| HIGH | `routes/api.js:104` | Passwords logged to console: `console.log("logging in: ", goto, pw, acct)` |
| HIGH | `routes/api.js:112` | JWT has no expiration — tokens are valid forever |
| HIGH | `routes/api.js:112` | `process.env.SECRET` is undefined without .env — JWT signing fails or uses weak default |
| MEDIUM | `hackernews-frontend/src/services/storyService.js:4` | Production API URL hardcoded to `tonidemo.herokuapp.com` |
| MEDIUM | `services/hackernews.js:16-21` | hntoplinks URLs use HTTP (not HTTPS) — data in transit is unencrypted |
| LOW | `routes/api.js:9-12` | `sanitary()` regex rejects valid HN usernames containing `.` or `@` |

## Compatibility Issues

| Severity | Location | Description |
|----------|----------|-------------|
| CRITICAL | `node_modules/buffer-equal-constant-time/index.js:37` | App crashes on startup with Node.js 25+. `SlowBuffer` was removed from the `buffer` module in Node 25. The `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` dependency chain accesses `SlowBuffer.prototype` at require time, causing `TypeError: Cannot read properties of undefined (reading 'prototype')`. No fix available upstream — `buffer-equal-constant-time` has no newer version (last release: 1.0.1). **Workaround: use Node.js 18 or 20.** |

## Bugs

| Location | Description | Test Coverage |
|----------|-------------|---------------|
| `services/storyService.js:4-9` | `getHidden` crashes with `TypeError: Cannot read properties of null` when username doesn't exist in DB. The Firestore doc doesn't exist, so `obj` is set to `null`, then `null.hidden` throws. (Preserved from original MongoDB code for backwards compatibility.) | `tests/integration/storyService.test.js` — "throws when user does not exist" |
| `routes/api.js:92` | `upsertHidden()` called without `await` — errors are silently lost, response sent before write completes. | Observed in `tests/integration/api.test.js` |
| `routes/api.js:114` | `upsertUser()` called without `await` — same fire-and-forget issue. | `tests/integration/api.test.js` — "creates user in DB" uses setTimeout workaround |
| `routes/api.js:48-50` | GET `/get` catches DB errors but doesn't send a response — request hangs until client timeout. | Not tested (hard to simulate) |
| `routes/api.js:75` | Error response `{ error: e }` serializes the full Error object instead of `e.message`. | Observed behavior |

## Code Quality Issues

| Location | Description |
|----------|-------------|
| `hackernews-frontend/src/index.js:14` | Uses deprecated `ReactDOM.render` API (React 16) instead of `createRoot` (React 18) |
| `hackernews-frontend/src/App.js:6` | Imports `bootstrap.bundle.min` for JS side effects |
| `services/hackernews.js:77` | `// TODO deduplicate ids` — acknowledged but unfixed |
| Dependencies | `react-scripts@5.0.1` (CRA) is unmaintained; `popper.js@1.x` is deprecated |
