# Testing Guide

## Running Tests

```bash
# Backend tests only (from repo root — no credentials or network needed)
npm test

# Frontend tests only
cd hackernews-frontend && npm test

# Both (from repo root)
npm test && cd hackernews-frontend && npm test && cd ..
```

## Test Architecture

### Backend (Jest + In-Memory SQLite + supertest)

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `tests/unit/middleware.test.js` | Unit | 3 | `unknownEndpoint` (404), `errorHandler` (500 + next) |
| `tests/unit/config.test.js` | Unit | 1 | `limitResults` constant |
| `tests/unit/hackernewsService.test.js` | Unit+DB | 19 | HN API functions (axios mocked), SQLite operations, ctx tracking, updateStories return value, undefined score filtering, getAllStoryIds dedup |
| `tests/unit/database.test.js` | Unit | 4 | getDb/setDb, initSchema creates tables/indexes/schema_migrations, idempotent schema init |
| `tests/unit/dbLogger.test.js` | Unit | 13 | createDbContext: counters, read/write, L1/MISS cache, per-table breakdown, query inline logging |
| `tests/unit/migrator.test.js` | Unit | 15 | ensureMigrationsTable, runMigrations (order, skip, auto-create, tables, timestamps), migration 002 ANALYZE/sqlite_stat1 + Day-query plan uses idx_stories_time, migration 003 adds password columns while preserving existing users/hidden and rolls back cleanly, rollback, status |
| `tests/unit/dockerfile.test.js` | Unit | 4 | Runtime image copies migrations/ (migration system) and scripts/users.js (account admin CLI) but not all of scripts/ (keeps data exports out), plus bin/routes/services/util |
| `tests/unit/compose.test.js` | Unit | 6 | Production compose never builds, runs the GHCR image pinned by `IMAGE_TAG`, health-check timeout ≥ 10 s, caps container logs; CI builds/pushes the image and the deploy job only pulls |
| `tests/unit/auth.test.js` | Unit | 26 | scrypt hash format/default params, verify correct/wrong/tampered/malformed, per-hash salt, username and new-password validation |
| `tests/integration/storyService.test.js` | Integration | 26 | storyService queries, getHidden dedup, upsertHidden never creates users, query caps, hiddenIds mutation guard, INDEXED BY regression |
| `tests/integration/api.test.js` | Integration | 49 | Full HTTP request/response via supertest: local-password login (success, wrong password, unknown user, no-password user, 400 validation incl. old HN payload, no credential logging, per-IP rate limit), sessions (pre-migration cookie stays valid, cookie upgraded to `tv`, simultaneous sessions, revoke-sessions, deleted user) |
| `tests/integration/users.test.js` | Integration | 24 | userService, `auth.verifyCredentials`, and the `scripts/users.js` CLI (`list`, `add`, `set-password` keeps sessions + history, `revoke-sessions`, validation and usage errors) via its exported `run()` |
| `tests/integration/worker.test.js` | Integration | 14 | syncOnce() direct tests, compound staleness queries, batch limits, ANALYZE stats refresh per cycle, utility functions, empty getAllStoryIds |
| **Total** | | **204** | |

### Frontend (Vitest + React Testing Library)

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `src/App.test.jsx` | Component | 25 | App rendering, timespan, auth-first loading, login payload `{ username, password }`, per-status login errors (401/429/other), invite-only copy, login button disable, re-fetch on login, hide button visibility, timespan persistence |
| `src/components/StoryList.test.jsx` | Component | 2 | List rendering (react-virtuoso mocked) |
| `src/components/Story.test.jsx` | Component | 12 | Story card: title, author, score, time, favicon, hide, URL safety, hide button conditional |
| `src/hooks/useTheme.test.js` | Hook | 4 | Theme detection, live changes, cleanup |
| `src/services/storyService.test.js` | Unit | 3 | Axios calls for stories/addHidden |
| `src/services/loginService.test.js` | Unit | 4 | Axios calls for login, logout, getMe |
| **Total** | | **50** | |

## Key Technical Details

### In-Memory SQLite for Tests

Backend tests use `better-sqlite3` with `:memory:` databases instead of disk-based SQLite files. The test setup creates a fresh in-memory database before tests and cleans it between tests:

```js
// tests/setup.js
const Database = require("better-sqlite3");
const { setDb, initSchema } = require("../services/database");

const connect = async () => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  const db = new Database(":memory:");
  setDb(db);
  initSchema(db);
};

const clearDatabase = async () => {
  const { getDb } = require("../services/database");
  const db = getDb();
  db.exec("DELETE FROM hidden; DELETE FROM users; DELETE FROM stories;");
};
```

This means:
- **No credentials needed** — pure in-memory database
- **No network needed** — tests run offline
- **Fast** — tests complete in ~3 seconds
- **Isolated** — each test starts with a clean database

### Test Setup

`tests/setup.js` provides:
- `connect()` — suppresses console output, creates in-memory SQLite database
- `clearDatabase()` — truncates all tables between tests
- `closeDatabase()` — restores console output

Each test file imports setup and uses:
```js
beforeAll(async () => await db.connect());
afterEach(async () => {
  await db.clearDatabase();
});
afterAll(async () => await db.closeDatabase());
```

### JWT Signing in API Tests

Auth uses `jose` (pure-JS, works on all modern Node versions), so the API tests sign and verify real HS256 JWTs — no mocking needed. `createToken(username, claims)` in `tests/integration/api.test.js` builds a `SignJWT` with the test `SECRET`; with no claims it mints the pre-migration shape (`{ username }`, no `tv`) so the session-continuity tests exercise exactly what old browsers hold. Authenticated routes also require the user row, so tests seed one with `seedLegacyUser()` (no password) or `seedUser()` (password), and the "365d expiration" test decodes the cookie token with `jwtVerify` to assert `exp - iat === 365 * 24 * 60 * 60`. Auth tokens are sent via `Cookie` header (`.set("Cookie", "token=...")`) matching the HTTP-only cookie auth flow.

### Passwords and Rate Limiting in Tests

- Seeded users are hashed with low-cost scrypt parameters (`{ N: 1024, r: 8, p: 1 }`); `verifyPassword` reads the parameters back out of the stored hash, so these verify exactly like production hashes while keeping the suite fast.
- The login rate limiter is keyed per client IP and the app trusts one proxy hop, so the `login()` helper sends a unique `X-Forwarded-For` per call. The rate-limit test pins one IP to hit 429 and checks a different IP is unaffected — it no longer has to run last.
- The `scripts/users.js` CLI is tested through its exported `run(args, { readPassword, log, error })` with scripted password answers; `main()` is guarded by `require.main === module`.

### Worker Testing Strategy

`worker.js` exports `syncOnce()` (a single sync cycle) and guards `main()` with `require.main === module`. Tests import `syncOnce()` directly and mock `services/hackernews` to verify bootstrap, incremental sync, and score update logic. Stale-story detection tests seed the SQLite database directly and verify that queries return the correct results.

## Mock Strategy

### Backend

| Module | Mock Type | Reason |
|--------|-----------|--------|
| `better-sqlite3` | In-memory `:memory:` via `setDb()` | Fast, isolated test database |
| `axios` | `jest.mock("axios")` | Avoid real HTTP calls to HN API |
| `services/hackernews` | `jest.mock()` | Isolate worker tests from HN service |
| `console.log` | `jest.spyOn` | Suppress noise from production code |

### Frontend

| Module | Mock Type | Reason |
|--------|-----------|--------|
| `axios` | `vi.mock("axios")` | Avoid real HTTP calls |
| `dayjs` | `vi.mock("dayjs")` | Consistent time output |
| `./services/storyService` | `vi.mock()` | Isolate App component from API |
| `./services/loginService` | `vi.mock()` | Isolate App component from API (login, logout, getMe) |
| `react-virtuoso` | `vi.mock()` | Render all items synchronously in tests (jsdom lacks DOM measurements) |
| `./Story` | `vi.mock()` | Isolate StoryList from Story rendering |
| `window.matchMedia` | `Object.defineProperty` in `setupTests.js` | jsdom lacks matchMedia; needed for `useTheme` hook |
| `localStorage` | `vi.stubGlobal()` in `setupTests.js` | Node.js 22+ experimental localStorage conflicts with jsdom |

## Code Coverage

Coverage is collected via Jest (backend) and Vitest + v8 (frontend).

```bash
# Backend coverage
npm run test:coverage

# Frontend coverage
cd hackernews-frontend && npm run test:coverage
```

Both generate `text`, `text-summary`, and `lcov` reports. The `coverage/` directories are gitignored.

CI uploads coverage artifacts (14-day retention) via `actions/upload-artifact@v4`.

## Regression Tests for Fixed Bugs

| Test File | Test Name | Original Bug |
|-----------|-----------|--------------|
| `storyService.test.js` | "does not mutate hiddenIds array" | `getStories` mutated caller's hiddenIds via `.sort()` |
| `storyService.test.js` | "returns empty array when user does not exist" | `getHidden` null pointer crash |
| `api.test.js` | "returns 400 for overlong username" | No length limit on username |
| `api.test.js` | "returns 400 for unsanitary username" | Overly restrictive username validation |
| `storyService.test.js` | "deduplicates concurrent getHidden calls for same user" | Race condition: simultaneous requests doubled reads |
| `App.test.jsx` | "disables login button while login is in flight" | Double login POST from rapid button clicks |
| `App.test.jsx` | "re-fetches stories after login" | Stories not reflecting server-side hidden filtering after login |
| `App.test.jsx` | "waits for login state before fetching stories" | Articles loading before `/me` resolves and showing the wrong logged-out state |
| `api.test.js` | "keeps a pre-migration cookie (no tv claim) valid everywhere" | Replacing HN-proxied login must not log out existing sessions or lose hidden history |
| `users.test.js` | "sets a first password on a legacy account, keeping sessions and history" | Same, for the production rollout step |
| `migrator.test.js` | "preserves pre-existing users and hidden history" | Migration 003 must not alter existing account rows |
| `api.test.js` | "returns 401 for an existing user who has no password yet" | Password-less pre-migration rows must not be loggable-into |
| `dockerfile.test.js` | "copies the account admin CLI into the runtime image" | Admin CLI missing from runtime image (same class of bug as the migrations/ COPY) |
| `compose.test.js` | "never builds on the VPS" / "deploys by pulling, not building, on the VPS" | On-box build saturated the VPS disk and died with its SSH session (2026-09-29) |
| `compose.test.js` | "gives the health check at least 10 s before timing out" | Healthy app marked unhealthy: 3 × 5 s timeouts under disk contention (2026-09-29) |
| `compose.test.js` | "caps container log size" | Unbounded json-file container logs (42 MB after four weeks) |
| `hackernewsService.test.js` | "skips stories with undefined score in return value" | Worker `updateStories` returning undefined scores for deleted/flagged stories |
