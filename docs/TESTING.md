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
| `tests/unit/hackernewsService.test.js` | Unit+DB | 29 | All HN API functions (axios mocked), SQLite operations, ctx tracking, updateStories return value, undefined score filtering, getAllStoryIds dedup |
| `tests/unit/database.test.js` | Unit | 3 | getDb/setDb, initSchema creates tables/indexes, idempotent schema init |
| `tests/unit/dbLogger.test.js` | Unit | 12 | createDbContext: counters, read/write, L1/MISS cache, per-table breakdown, query inline logging |
| `tests/integration/storyService.test.js` | Integration | 26 | All storyService CRUD, L1 cache, hidden cache+dedup, cache expiry, query caps |
| `tests/integration/api.test.js` | Integration | 31 | Full HTTP request/response via supertest |
| `tests/integration/worker.test.js` | Integration | 15 | syncOnce() direct tests, compound staleness queries, batch limits, utility functions, empty getAllStoryIds |
| **Total** | | **120** | |

### Frontend (Vitest + React Testing Library)

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `src/App.test.jsx` | Component | 18 | App rendering, timespan, loading, auth, hiddenLoaded, localStorage, login button disable, hidden sync to server |
| `src/components/StoryList.test.jsx` | Component | 4 | List rendering, hidden filtering (react-virtuoso mocked) |
| `src/components/Story.test.jsx` | Component | 11 | Story card: title, author, score, time, favicon, hide, URL safety |
| `src/hooks/useTheme.test.js` | Hook | 4 | Theme detection, live changes, cleanup |
| `src/services/storyService.test.js` | Unit | 4 | Axios calls for stories/hidden |
| `src/services/loginService.test.js` | Unit | 4 | Axios calls for login, logout, getMe |
| **Total** | | **45** | |

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
- **Fast** — tests complete in ~1 second
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
  await storyService.clearCache(); // clears L1 + hidden in-memory caches
  await db.clearDatabase();
});
afterAll(async () => await db.closeDatabase());
```

### JWT Mock in API Tests

`jsonwebtoken` depends on `buffer-equal-constant-time` which uses `SlowBuffer` — removed in Node.js 25. The API test mocks `jsonwebtoken` entirely with a simple token store to avoid this incompatibility. Auth tokens are sent via `Cookie` header (`.set("Cookie", "token=...")`) matching the HTTP-only cookie auth flow.

### Worker Testing Strategy

`worker.js` exports `syncOnce()` (a single sync cycle) and guards `main()` with `require.main === module`. Tests import `syncOnce()` directly and mock `services/hackernews` to verify bootstrap, incremental sync, and score update logic. Stale-story detection tests seed the SQLite database directly and verify that queries return the correct results.

## Mock Strategy

### Backend

| Module | Mock Type | Reason |
|--------|-----------|--------|
| `better-sqlite3` | In-memory `:memory:` via `setDb()` | Fast, isolated test database |
| `axios` | `jest.mock("axios")` | Avoid real HTTP calls to HN API |
| `jsonwebtoken` | `jest.mock("jsonwebtoken")` | SlowBuffer removed in Node 25 |
| `services/hackernews` | `jest.mock()` | Isolate API route tests and worker tests from HN service |
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
| `storyService.test.js` | "returns empty array when user does not exist" | `getHidden` null pointer crash |
| `api.test.js` | "returns 400 for unsanitary username" | Overly restrictive username validation |
| `storyService.test.js` | "deduplicates concurrent getHidden calls for same user" | Race condition: simultaneous requests doubled reads |
| `App.test.jsx` | "disables login button while login is in flight" | Double login POST from rapid button clicks |
| `App.test.jsx` | "syncs localStorage-only hidden IDs to server on login" | Hidden stories not syncing across devices |
| `hackernewsService.test.js` | "skips stories with undefined score in return value" | Worker `updateStories` returning undefined scores for deleted/flagged stories |
