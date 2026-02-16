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

### Backend (Jest + In-Memory MockFirestore + supertest)

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `tests/unit/middleware.test.js` | Unit | 3 | `unknownEndpoint` (404), `errorHandler` (500 + next) |
| `tests/unit/config.test.js` | Unit | 1 | `limitResults` constant |
| `tests/unit/hackernewsService.test.js` | Unit+DB | 15 | All HN API functions (axios mocked), Firestore operations |
| `tests/unit/firestore.test.js` | Unit | 11 | getCollectionPrefix (incl. staging), padId, storiesCollection, usersCollection, getDb/setDb |
| `tests/unit/firestoreLogger.test.js` | Unit | 13 | createFirestoreContext: counters, read/write, L1/L2/MISS cache, per-collection breakdown, query inline logging |
| `tests/integration/storyService.test.js` | Integration | 27 | All storyService CRUD, L1/L2 cache, hidden cache+dedup, cache expiry, Day-merge, query caps |
| `tests/integration/api.test.js` | Integration | 26 | Full HTTP request/response via supertest (incl. `/_ah/worker` endpoint) |
| `tests/integration/worker.test.js` | Integration | 13 | syncOnce() direct tests, compound staleness queries, batch limits, utility functions |
| **Total** | | **124** | |

### Frontend (Vitest + React Testing Library)

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `src/App.test.jsx` | Component | 17 | App rendering, timespan, loading, auth, hiddenLoaded, localStorage, login button disable |
| `src/components/StoryList.test.jsx` | Component | 4 | List rendering, hidden filtering (react-virtuoso mocked) |
| `src/components/Story.test.jsx` | Component | 11 | Story card: title, author, score, time, favicon, hide, URL safety |
| `src/hooks/useTheme.test.js` | Hook | 4 | Theme detection, live changes, cleanup |
| `src/services/storyService.test.js` | Unit | 4 | Axios calls for stories/hidden |
| `src/services/loginService.test.js` | Unit | 4 | Axios calls for login, logout, getMe |
| **Total** | | **44** | |

## Key Technical Details

### In-Memory MockFirestore

Backend tests use an in-memory Firestore mock instead of the real Firestore SDK. The mock is loaded via Jest's `moduleNameMapper` in `jest.config.js`:

```js
moduleNameMapper: {
  "^@google-cloud/firestore$": "<rootDir>/tests/mocks/firestore-sdk-shim.js",
}
```

This prevents `@google-cloud/firestore` from ever loading, which means:
- **No credentials needed** — no `gcloud auth application-default login`
- **No network needed** — tests run offline
- **No `--experimental-vm-modules`** — the real SDK's dynamic `import()` in gaxios is never triggered
- **Fast** — tests complete in ~1 second instead of 30+ seconds

The mock consists of:

| File | Purpose |
|------|---------|
| `tests/mocks/firestore-mock.js` | In-memory implementation: MockFirestore, MockCollectionRef, MockDocRef, MockQuery, MockDocSnapshot, MockQuerySnapshot, MockWriteBatch, MockTimestamp |
| `tests/mocks/firestore-sdk-shim.js` | 2-line shim that exports `{ Firestore: MockFirestore }` |

**Storage model**: Flat `Map<collectionPath, Map<docId, data>>`. Subcollection paths use slash notation (e.g., `dev-users/testuser/hidden`).

**MockTimestamp**: Date objects are automatically wrapped in MockTimestamp during `.set()`/`.update()`, so `doc.data().time.toDate()` works exactly like real Firestore.

**Where operators supported**: `>`, `<`, `>=`, `<=`, `==`. Date/MockTimestamp values are unwrapped to milliseconds for comparison.

### Test Setup

`tests/setup.js` provides:
- `connect()` — suppresses `console.log` and `console.error` during tests
- `clearDatabase()` — calls `getDb()._clear()` to wipe all in-memory data
- `closeDatabase()` — restores console output

Each test file imports setup and uses:
```js
beforeAll(async () => await db.connect());
afterEach(async () => {
  await storyService.clearCache(); // clears L1 + L2 + hidden cache
  await db.clearDatabase();
});
afterAll(async () => await db.closeDatabase());
```

Tests that use `storyService` must `await clearCache()` in `afterEach` to clear both the in-memory L1 cache and Firestore L2 cache docs, preventing cache leaking between tests.

### JWT Mock in API Tests

`jsonwebtoken` depends on `buffer-equal-constant-time` which uses `SlowBuffer` — removed in Node.js 25. The API test mocks `jsonwebtoken` entirely with a simple token store to avoid this incompatibility. Auth tokens are sent via `Cookie` header (`.set("Cookie", "token=...")`) matching the HTTP-only cookie auth flow.

### Worker Testing Strategy

`worker.js` exports `syncOnce()` (a single sync cycle) and guards `throng` with `require.main === module`. Tests import `syncOnce()` directly and mock `services/hackernews` to verify bootstrap, incremental sync, and score update logic. Simulated query tests also validate staleness detection and latest-story lookup against MockFirestore.

## Mock Strategy

### Backend

| Module | Mock Type | Reason |
|--------|-----------|--------|
| `@google-cloud/firestore` | `moduleNameMapper` → in-memory mock | No credentials, no network, fast tests |
| `axios` | `jest.mock("axios")` | Avoid real HTTP calls to HN API |
| `jsonwebtoken` | `jest.mock("jsonwebtoken")` | SlowBuffer removed in Node 25 |
| `services/hackernews` | `jest.mock()` | Isolate API route tests and worker tests from HN service |
| `worker` | `jest.mock()` | Isolate `/_ah/worker` endpoint tests from actual sync logic |
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

## Firestore Smoke Tests (Real Database)

A standalone Node.js test suite (`tests/integration/firestore-smoke.test.js`) runs against real Firestore dev- data. It is **not** a Jest test — Jest's VM sandbox breaks gRPC/auth in the Firestore SDK.

```bash
npm run test:firestore
```

**Requires**: Application Default Credentials (`gcloud auth application-default login`)

**Operation limits**: Hard-capped at 50 reads + 50 writes per run via Firestore SDK prototype instrumentation (`Query.prototype.get`, `DocumentReference.prototype.get/set/update/delete`).

| Test | Reads | Writes |
|------|-------|--------|
| getStories sorted by score | 1 | 0 |
| getStories correct schema | 1 | 0 |
| getStories respects limit | 1 | 0 |
| getStories respects skip | 2 | 0 |
| getHidden returns array for existing user | 1 | 0 |
| getHidden returns empty for nonexistent user | 1 | 0 |
| upsertHidden writes and reads back | 1 | 2 |
| Cleanup test data | 0 | 2 |
| **Total** | **~10** | **~4** |

Can be run ~100 times/day and stay well within the Firestore Spark free tier (50K reads/day, 20K writes/day).

The test file is excluded from regular Jest runs via `testPathIgnorePatterns` in `jest.config.js`.

## Regression Tests for Fixed Bugs

| Test File | Test Name | Original Bug |
|-----------|-----------|--------------|
| `storyService.test.js` | "returns empty array when user does not exist" | `getHidden` null pointer crash (fixed Phase 15) |
| `api.test.js` | "returns 400 for unsanitary username" | Overly restrictive username validation (fixed Phase 12, renamed to `isValidUsername()`) |
| `storyService.test.js` | "L2 cache handles self-post stories with no url field" | L2 cache write crash on `url: undefined` for Ask HN posts |
| `storyService.test.js` | "deduplicates concurrent getHidden calls for same user" | Race condition: simultaneous requests doubled Firestore reads |
| `App.test.jsx` | "disables login button while login is in flight" | Double login POST from rapid button clicks |
