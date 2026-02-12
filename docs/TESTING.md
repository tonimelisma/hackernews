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
| `tests/unit/firestore.test.js` | Unit | 10 | getCollectionPrefix, padId, storiesCollection, usersCollection, getDb/setDb |
| `tests/integration/storyService.test.js` | Integration | 16 | All storyService CRUD against MockFirestore |
| `tests/integration/api.test.js` | Integration | 23 | Full HTTP request/response via supertest |
| `tests/integration/worker.test.js` | Integration | 10 | syncOnce() direct tests, staleness queries, utility functions |
| **Total** | | **78** | |

### Frontend (Vitest + React Testing Library)

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `src/App.test.jsx` | Component | 8 | App rendering, timespan, loading, auth |
| `src/components/StoryList.test.jsx` | Component | 4 | List rendering, hidden filtering |
| `src/components/Story.test.jsx` | Component | 11 | Story card: title, author, score, time, favicon, hide, URL safety |
| `src/services/storyService.test.js` | Unit | 4 | Axios calls for stories/hidden |
| `src/services/loginService.test.js` | Unit | 4 | Axios calls for login, logout, getMe |
| **Total** | | **31** | |

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
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());
```

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
| `console.log` | `jest.spyOn` | Suppress noise from production code |

### Frontend

| Module | Mock Type | Reason |
|--------|-----------|--------|
| `axios` | `vi.mock("axios")` | Avoid real HTTP calls |
| `dayjs` | `vi.mock("dayjs")` | Consistent time output |
| `./services/storyService` | `vi.mock()` | Isolate App component from API |
| `./services/loginService` | `vi.mock()` | Isolate App component from API (login, logout, getMe) |
| `./Story` | `vi.mock()` | Isolate StoryList from Story rendering |

## Regression Tests for Fixed Bugs

| Test File | Test Name | Original Bug |
|-----------|-----------|--------------|
| `storyService.test.js` | "returns empty array when user does not exist" | `getHidden` null pointer crash (fixed Phase 15) |
| `api.test.js` | "returns 400 for unsanitary username" | Overly restrictive username validation (fixed Phase 12, renamed to `isValidUsername()`) |
