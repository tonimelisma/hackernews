# Known Issues

## Security Issues

| Severity | Location | Description | Status |
|----------|----------|-------------|--------|
| ~~HIGH~~ | ~~`routes/api.js:104`~~ | ~~Passwords logged to console~~ | **RESOLVED** (Phase 10) — now logs username only |
| ~~HIGH~~ | ~~`routes/api.js:112`~~ | ~~JWT has no expiration — tokens valid forever~~ | **RESOLVED** (Phase 10) — 24h expiration added |
| ~~HIGH~~ | ~~`routes/api.js:121`~~ | ~~`process.env.SECRET` is undefined without .env — JWT signing fails or uses weak default~~ | **RESOLVED** (Phase 13) — `bin/www` validates SECRET on startup, exits if missing |
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
| ~~`services/storyService.js:4-9`~~ | ~~`getHidden` crashes with `TypeError: Cannot read properties of null` when username doesn't exist in DB.~~ | `tests/integration/storyService.test.js` — "returns empty array when user does not exist" | **RESOLVED** (Phase 15) — returns `[]` instead of crashing |
| ~~`routes/api.js:101`~~ | ~~`upsertHidden()` called without `await` — errors are silently lost, response sent before write completes.~~ | `tests/integration/api.test.js` | **RESOLVED** (Phase 12) — added `await` |
| ~~`routes/api.js:123`~~ | ~~`upsertUser()` called without `await` — same fire-and-forget issue.~~ | `tests/integration/api.test.js` — "creates user in DB" (setTimeout workaround removed) | **RESOLVED** (Phase 12) — added `await`, reordered before response |
| ~~`routes/api.js:48-50`~~ | ~~GET `/get` catches DB errors but doesn't send a response — request hangs until client timeout.~~ | `tests/integration/api.test.js` — "returns 500 when storyService throws" | **RESOLVED** (Phase 10) — now returns 500 |
| ~~`routes/api.js:75`~~ | ~~Error response `{ error: e }` serializes the full Error object~~ | Existing 401 tests | **RESOLVED** (Phase 10) — returns generic string |

## Code Quality Issues

| Location | Description | Status |
|----------|-------------|--------|
| ~~`hackernews-frontend/src/index.js:14`~~ | ~~Uses deprecated `ReactDOM.render` API (React 16) instead of `createRoot` (React 18)~~ | **RESOLVED** (Phase 13) — migrated to `createRoot` |
| `hackernews-frontend/src/App.js:6` | Imports `bootstrap.bundle.min` for JS side effects | Open |
| ~~Backend `console.log` in catch blocks~~ | ~~Error catch blocks in `hackernews.js`, `worker.js`, `api.js` used `console.log` instead of `console.error`~~ | **RESOLVED** (Phase 15) — all error logging uses `console.error` |
| ~~Debug logging in production code~~ | ~~`hackernews.js` and `api.js` had debug/request logging (`console.log`) mixed with error logging~~ | **RESOLVED** (Phase 15) — debug logs removed |
| ~~`services/hackernews.js:77`~~ | ~~`// TODO deduplicate ids` — acknowledged but unfixed~~ | **RESOLVED** (Phase 14) — `[...new Set(ids)]` deduplication added |
| Dependencies | `react-scripts@5.0.1` (CRA) is unmaintained | Open |
| ~~Dependencies~~ | ~~Dead frontend deps: `jquery`, `popper.js`, `react-icons`, `typescript`~~ | **RESOLVED** (Phase 10) — removed |
| ~~`hackernews-frontend/src/services/loginService.js`~~ | ~~Commented-out try-catch error handling~~ | **RESOLVED** (Phase 14) — removed dead comments |
| ~~`util/middleware.js:6`~~ | ~~Informal error logging (`console.log("error! ")`)~~ | **RESOLVED** (Phase 14) — changed to `console.error` with descriptive message |
| ~~`services/hackernews.js:71`~~ | ~~`var` usage instead of `const`~~ | **RESOLVED** (Phase 14) — changed to `const` |
| ~~`hackernews-frontend/src/components/Story.js:27`~~ | ~~`var` usage instead of `let`~~ | **RESOLVED** (Phase 14) — changed to `let` |
| ~~`hackernews-frontend/src/serviceWorker.js`~~ | ~~Unused CRA boilerplate (135 lines, only called as `unregister()` no-op)~~ | **RESOLVED** (Phase 14) — file deleted, import removed |
| ~~`hackernews-frontend/src/App.js`~~ | ~~7 debug `console.log` statements in production code~~ | **RESOLVED** (Phase 14) — all removed |
| ~~`hackernews-frontend/src/App.js:87-88`~~ | ~~Dead jQuery toggle code (commented out)~~ | **RESOLVED** (Phase 14) — removed |
| ~~`util/middleware.js:8`~~ | ~~Commented-out MongoDB error check~~ | **RESOLVED** (Phase 14) — removed |
| ~~`topdump.js`~~ | ~~Stale one-off database population script~~ | **RESOLVED** (Phase 14) — file deleted |
| ~~`scripts/`~~ | ~~Stale migration scripts and data (12MB)~~ | **RESOLVED** (Phase 14) — directory deleted |

## Dependency Vulnerabilities

| Scope | Status | Details |
|-------|--------|---------|
| Backend | 0 vulnerabilities | Clean after `npm audit fix` (Phase 14). `npm audit` enforced in CI at `moderate` level. |
| Frontend | 9 vulnerabilities (unfixable) | All locked behind `react-scripts@5.0.1`: `nth-check`, `postcss` (resolve-url-loader), `webpack-dev-server`. `npm audit` enforced in CI at `critical` level. Requires CRA replacement to fix. |
