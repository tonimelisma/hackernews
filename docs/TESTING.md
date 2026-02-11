# Testing Guide

## Running Tests

```bash
# Backend tests only (from repo root — no credentials or network needed)
npm test

# Frontend tests only
cd hackernews-frontend && npm test -- --watchAll=false

# Both (from repo root)
npm test && cd hackernews-frontend && npm test -- --watchAll=false && cd ..
```

## Test Architecture

### Backend (Jest + In-Memory MockFirestore + supertest)

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `tests/unit/middleware.test.js` | Unit | 3 | `unknownEndpoint` (404), `errorHandler` (500 + next) |
| `tests/unit/config.test.js` | Unit | 1 | `limitResults` constant |
| `tests/unit/hackernewsService.test.js` | Unit+DB | 15 | All HN API functions (axios mocked), Firestore operations |
| `tests/integration/storyService.test.js` | Integration | 14 | All storyService CRUD against MockFirestore |
| `tests/integration/api.test.js` | Integration | 18 | Full HTTP request/response via supertest |
| `tests/integration/worker.test.js` | Integration | 7 | Worker staleness queries + latest story lookup |
| **Total** | | **58** | |

### Frontend (Jest + React Testing Library)

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `src/App.test.js` | Component | 15 | App rendering, timespan, loading, auth |
| `src/components/StoryList.test.js` | Component | 5 | List rendering, hidden filtering |
| `src/components/Story.test.js` | Component | 3 | Story card: title, author, score, time, favicon, hide |
| `src/services/storyService.test.js` | Unit | 4 | Axios calls for stories/hidden |
| `src/services/loginService.test.js` | Unit | 2 | Axios calls for login |
| **Total** | | **29** | |

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

`jsonwebtoken` depends on `buffer-equal-constant-time` which uses `SlowBuffer` — removed in Node.js 25. The API test mocks `jsonwebtoken` entirely with a simple token store to avoid this incompatibility.

### Worker Testing Strategy

`worker.js` starts an infinite loop via `throng(1, main)` at module scope — it cannot be `require()`'d in tests. Instead, `worker.test.js` simulates the worker's staleness detection and latest-story queries by running equivalent Firestore queries against the mock.

## Mock Strategy

### Backend

| Module | Mock Type | Reason |
|--------|-----------|--------|
| `@google-cloud/firestore` | `moduleNameMapper` → in-memory mock | No credentials, no network, fast tests |
| `axios` | `jest.mock("axios")` | Avoid real HTTP calls to HN API |
| `jsonwebtoken` | `jest.mock("jsonwebtoken")` | SlowBuffer removed in Node 25 |
| `services/hackernews` | `jest.mock()` | Isolate API route tests from HN service |
| `console.log` | `jest.spyOn` | Suppress noise from production code |

### Frontend

| Module | Mock Type | Reason |
|--------|-----------|--------|
| `axios` | `jest.mock("axios")` | Avoid real HTTP calls |
| `moment` | `jest.mock("moment")` | Consistent time output |
| `bootstrap/dist/js/bootstrap.bundle.min` | `jest.mock()` | JSDOM doesn't support bootstrap JS |
| `./services/storyService` | `jest.mock()` | Isolate App component from API |
| `./services/loginService` | `jest.mock()` | Isolate App component from API |
| `./Story` | `jest.mock()` | Isolate StoryList from Story rendering |

## Regression Tests for Fixed Bugs

| Test File | Test Name | Original Bug |
|-----------|-----------|--------------|
| `storyService.test.js` | "returns empty array when user does not exist" | `getHidden` null pointer crash (fixed Phase 15) |
| `api.test.js` | "returns 400 for unsanitary username" | Overly restrictive username validation (fixed Phase 12, renamed to `isValidUsername()`) |
