# Known Issues

## Security Issues

| Severity | Location | Description | Status |
|----------|----------|-------------|--------|
| ~~HIGH~~ | ~~`routes/api.js:104`~~ | ~~Passwords logged to console~~ | **RESOLVED** (Phase 10) — now logs username only |
| ~~HIGH~~ | ~~`routes/api.js:112`~~ | ~~JWT has no expiration — tokens valid forever~~ | **RESOLVED** (Phase 10) — 24h expiration added |
| HIGH | `routes/api.js:121` | `process.env.SECRET` is undefined without .env — JWT signing fails or uses weak default | Open |
| ~~MEDIUM~~ | ~~`hackernews-frontend/src/services/storyService.js:4`~~ | ~~Production API URL hardcoded to `tonidemo.herokuapp.com`~~ | **RESOLVED** (Phase 10) — uses relative URLs |
| ~~MEDIUM~~ | ~~`services/hackernews.js:16-21`~~ | ~~hntoplinks URLs use HTTP (not HTTPS) — data in transit is unencrypted~~ | **RESOLVED** (Phase 12) — changed to HTTPS |
| ~~LOW~~ | ~~`routes/api.js:17-20`~~ | ~~`sanitary()` regex rejects valid HN usernames containing `.` or `@`~~ | **RESOLVED** (Phase 12) — renamed to `isValidUsername()` with proper `[a-zA-Z0-9_-]+` regex |

### Security Improvements Added (Phase 10)

| Feature | Location | Description |
|---------|----------|-------------|
| Helmet | `app.js:16` | `helmet()` middleware adds CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc. |
| CORS restriction | `app.js:19-22` | CORS restricted to `localhost:3000` in development, disabled in production (same-origin) |
| Login rate limiting | `routes/api.js:10-15,109` | `express-rate-limit`: 10 requests per 15-minute window on POST `/login` |
| Error message sanitization | `routes/api.js:84,105` | Auth error responses now return generic `"authentication error"` instead of full Error object |
| URL protocol validation | `hackernews-frontend/src/components/Story.js:17-23` | `isSafeUrl()` prevents `javascript:` and other dangerous URL protocols in story links |

## Compatibility Issues

| Severity | Location | Description |
|----------|----------|-------------|
| CRITICAL | `node_modules/buffer-equal-constant-time/index.js:37` | App crashes on startup with Node.js 25+. `SlowBuffer` was removed from the `buffer` module in Node 25. The `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` dependency chain accesses `SlowBuffer.prototype` at require time, causing `TypeError: Cannot read properties of undefined (reading 'prototype')`. No fix available upstream — `buffer-equal-constant-time` has no newer version (last release: 1.0.1). **Workaround: use Node.js 18 or 20.** |

## Bugs

| Location | Description | Test Coverage | Status |
|----------|-------------|---------------|--------|
| `services/storyService.js:4-9` | `getHidden` crashes with `TypeError: Cannot read properties of null` when username doesn't exist in DB. The Firestore doc doesn't exist, so `obj` is set to `null`, then `null.hidden` throws. (Preserved from original MongoDB code for backwards compatibility.) | `tests/integration/storyService.test.js` — "throws when user does not exist" | Open (intentional) |
| ~~`routes/api.js:101`~~ | ~~`upsertHidden()` called without `await` — errors are silently lost, response sent before write completes.~~ | `tests/integration/api.test.js` | **RESOLVED** (Phase 12) — added `await` |
| ~~`routes/api.js:123`~~ | ~~`upsertUser()` called without `await` — same fire-and-forget issue.~~ | `tests/integration/api.test.js` — "creates user in DB" (setTimeout workaround removed) | **RESOLVED** (Phase 12) — added `await`, reordered before response |
| ~~`routes/api.js:48-50`~~ | ~~GET `/get` catches DB errors but doesn't send a response — request hangs until client timeout.~~ | `tests/integration/api.test.js` — "returns 500 when storyService throws" | **RESOLVED** (Phase 10) — now returns 500 |
| ~~`routes/api.js:75`~~ | ~~Error response `{ error: e }` serializes the full Error object~~ | Existing 401 tests | **RESOLVED** (Phase 10) — returns generic string |

## Code Quality Issues

| Location | Description | Status |
|----------|-------------|--------|
| `hackernews-frontend/src/index.js:14` | Uses deprecated `ReactDOM.render` API (React 16) instead of `createRoot` (React 18) | Open |
| `hackernews-frontend/src/App.js:6` | Imports `bootstrap.bundle.min` for JS side effects | Open |
| `services/hackernews.js:77` | `// TODO deduplicate ids` — acknowledged but unfixed | Open |
| Dependencies | `react-scripts@5.0.1` (CRA) is unmaintained | Open |
| ~~Dependencies~~ | ~~Dead frontend deps: `jquery`, `popper.js`, `react-icons`, `typescript`~~ | **RESOLVED** (Phase 10) — removed |
