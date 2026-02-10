# Testing Guide

## Running Tests

```bash
# Backend tests only (from repo root)
npm test

# Frontend tests only
cd hackernews-frontend && npm test -- --watchAll=false

# Both (from repo root)
npm test && cd hackernews-frontend && npm test -- --watchAll=false && cd ..
```

## Test Architecture

### Backend (Jest + Firestore + supertest)

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `tests/unit/middleware.test.js` | Unit | 3 | `unknownEndpoint` (404), `errorHandler` (500 + next) |
| `tests/unit/config.test.js` | Unit | 1 | `limitResults` constant |
| `tests/unit/hackernewsService.test.js` | Unit+DB | 15 | All HN API functions (axios mocked), Firestore operations |
| `tests/integration/storyService.test.js` | Integration | 16 | All storyService CRUD against real Firestore (dev/ci prefix) |
| `tests/integration/api.test.js` | Integration | 17 | Full HTTP request/response via supertest |
| `tests/integration/worker.test.js` | Integration | 3 | Worker staleness queries + latest story lookup |
| **Total** | | **55** | |

### Frontend (Jest + React Testing Library)

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `src/App.test.js` | Component | 8 | App rendering, timespan, loading, auth |
| `src/components/StoryList.test.js` | Component | 4 | List rendering, hidden filtering |
| `src/components/Story.test.js` | Component | 9 | Story card: title, author, score, time, favicon, hide |
| `src/services/storyService.test.js` | Unit | 4 | Axios calls for stories/hidden |
| `src/services/loginService.test.js` | Unit | 2 | Axios calls for login |
| **Total** | | **27** | |

## Key Technical Details

### Firestore in Tests

Tests use real Firestore (not an emulator or mock). The collection prefix is determined by `NODE_ENV`:
- Local: `dev-stories`, `dev-users`
- CI: `ci-stories`, `ci-users`

`tests/setup.js` provides:
- `connect()` — health-check write to Firestore
- `clearDatabase()` — deletes all docs (including subcollections) from prefixed collections
- `closeDatabase()` — terminates the Firestore client

Each test file imports setup and uses:
```js
beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());
```

### `--experimental-vm-modules` Requirement

The `@google-cloud/firestore` SDK depends on `gaxios` which uses dynamic `import()` for fetch. Jest's VM sandbox blocks dynamic imports unless `NODE_OPTIONS=--experimental-vm-modules` is set. This is configured in `package.json`'s test script.

### JWT Mock in API Tests

`jsonwebtoken` depends on `buffer-equal-constant-time` which uses `SlowBuffer` — removed in Node.js 25. The API test mocks `jsonwebtoken` entirely with a simple token store to avoid this incompatibility.

### Worker Testing Strategy

`worker.js` starts an infinite loop via `throng(1, main)` at module scope — it cannot be `require()`'d in tests. Instead, `worker.test.js` simulates the worker's staleness detection and latest-story queries by running equivalent Firestore queries against the database.

## Mock Strategy

### Backend

| Module | Mock Type | Reason |
|--------|-----------|--------|
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

## Known Issues Documented via Tests

| Test File | Test Name | Issue |
|-----------|-----------|-------|
| `storyService.test.js` | "throws when user does not exist" | `getHidden` null pointer crash |
| `api.test.js` | "returns 400 for unsanitary username" | Overly restrictive `sanitary()` regex |
