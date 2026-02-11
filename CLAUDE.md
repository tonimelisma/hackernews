# CLAUDE.md — Project Governance & Definition of Done

## Project Summary

HackerNews aggregator: a Node.js/Express backend with a React frontend. The backend scrapes Hacker News stories, stores them in Google Cloud Firestore, and serves them via a REST API. A background worker (`worker.js`) periodically syncs new stories and updates scores. The frontend displays top stories with filtering by timespan and user-hidden stories.

## Quick Reference Commands

```bash
# IMPORTANT: Use Node.js 20 (Node 25+ crashes due to SlowBuffer removal)
# If using Homebrew: PATH="/opt/homebrew/opt/node@20/bin:$PATH"

# Backend tests (uses in-memory mock — no credentials or network needed)
npm test

# Frontend tests
cd hackernews-frontend && npm test -- --watchAll=false

# Run both
npm test && cd hackernews-frontend && npm test -- --watchAll=false && cd ..

# Backend dev server (requires Firestore ADC)
npm run watch

# Frontend dev server
cd hackernews-frontend && npm start

# Worker
npm run worker
```

## Definition of Done

You own this repo. You are the maintainer. There is no "someone else" — if there are uncommitted changes, failing tests, or stale docs, that's YOUR unfinished work from a previous session. You clean it up. Every iteration of work must end with the repo in a clean, working, documented state. No excuses.

### Before finishing any unit of work:

1. **All tests pass.** Run both suites, fix anything that breaks:
   ```bash
   npm test && cd hackernews-frontend && npm test -- --watchAll=false && cd ..
   ```
2. **Repo is clean.** `git status` shows no uncommitted changes. You test, commit, and push. Always.
3. **Bugs get regression tests first.** When you find a bug, write a failing test that reproduces it *before* writing the fix. The test proves the bug exists and proves the fix works.
4. **All docs are updated.** Every iteration, review and update all documentation to reflect the current state of the code:
   - This file (`CLAUDE.md`) — architecture, gotchas, test counts, learnings
   - All files under `docs/` (see Documentation section below)
   - `docs/KNOWN_ISSUES.md` if new issues were found or old ones resolved
5. **No broken windows.** If you encounter a test failure, a stale doc, uncommitted changes, warnings, code smells, or inconsistent state — you fix it. It's your repo. There is no "someone else's problem." Never dismiss anything as "pre-existing noise" or "expected warnings." If it's in the output, you own it. Fix it or document exactly why it can't be fixed yet.
6. **Repo health checked.** Before finishing, check:
   - `gh pr list --state open` — review open PRs, close stale ones
   - `gh run list --limit 5` — CI must be green on master
   - `git branch -r` — delete stale remote branches
   If CI is failing on master, that's YOUR broken build. Fix it first.
7. **Dependencies are up to date.** Run `ncu` in both root and `hackernews-frontend/`. If anything is outdated, update it (`ncu -u && npm install`), run tests, and commit. No stale versions. Use `--legacy-peer-deps` for the frontend install.

## Architecture Overview

```
hackernews/
├── app.js                  # Express app setup (middleware, routes, static files)
├── worker.js               # Background sync worker (throng, infinite loop)
├── routes/api.js           # REST API routes (/get, /hidden, /login)
├── services/
│   ├── firestore.js        # Firestore client singleton, collection refs, padId()
│   ├── storyService.js     # Firestore CRUD for stories/users
│   └── hackernews.js       # HN API client + hntoplinks scraper
├── util/
│   ├── config.js           # Environment config (limitResults)
│   └── middleware.js        # Express error handlers
├── hackernews-frontend/    # React CRA frontend
│   └── src/
│       ├── App.js          # Main component (stories, auth, filtering)
│       ├── components/
│       │   ├── Story.js    # Single story card
│       │   └── StoryList.js # Story list with hidden filtering
│       └── services/
│           ├── storyService.js  # API client for stories/hidden
│           └── loginService.js  # API client for login
├── scripts/
│   └── migrate-to-firestore.js  # One-time MongoDB → Firestore migration
└── docs/                   # LLM-geared documentation
```

## Key Architectural Constraints & Gotchas

1. **Firestore lazy singleton**: `services/firestore.js` creates the Firestore client on first use via `getDb()`. No module-load side effects. `setDb()` allows test injection.

2. **Environment-prefixed collections**: Collections are prefixed by `NODE_ENV`: `dev-stories`/`prod-stories`/`ci-stories`. Logic in `services/firestore.js:getCollectionPrefix()`.

3. **In-memory MockFirestore for tests**: Tests use `jest.config.js` `moduleNameMapper` to replace `@google-cloud/firestore` with an in-memory mock (`tests/mocks/firestore-mock.js`). The real SDK never loads — no credentials, no network, no `--experimental-vm-modules` needed. The mock implements the exact Firestore API surface used by this project (collection/doc/query/batch/subcollections). `_clear()` wipes all data between tests.

4. **Worker is not directly testable**: `worker.js` calls `throng(1, main)` at module scope, starting an infinite loop. Worker logic must be tested indirectly by simulating its DB queries.

5. **No input validation on API**: The `/get` endpoint doesn't validate timespan beyond a switch/default. The `/login` endpoint has `isValidUsername()` validation.

6. **`getHidden` null pointer bug**: If username doesn't exist in Firestore, the code intentionally crashes with `null.hidden` TypeError. This preserves the original MongoDB behavior and is documented with a test.

7. **Node.js 25+ crashes the app**: `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` accesses `SlowBuffer.prototype` at require time. `SlowBuffer` was removed in Node 25. No upstream fix available. **Use Node.js 18 or 20.**

8. **Client-side sorting for stories**: Firestore can't `where('time', '>').orderBy('score', 'desc')` — the first `orderBy` must match the inequality field. `getStories()` fetches all matching docs, sorts by score in JS, then slices for pagination.

9. **Hidden stories use subcollection**: `{prefix}-users/{username}/hidden/{storyId}` — avoids Firestore's 1MB doc limit (one user had 117K hidden IDs = 1.2MB).

10. **Zero-padded story doc IDs**: Stories use `padId()` (10-digit zero-padded string) as doc ID for lexicographic ordering that matches numeric order.

## Documentation

All of these must be kept current with every change:

- [Architecture](docs/ARCHITECTURE.md) — system overview, directory structure, data flow
- [API Reference](docs/API.md) — REST endpoints, request/response formats
- [Database Schemas](docs/DATABASE.md) — Firestore collections, subcollections, indexes, query patterns
- [Environment Variables](docs/ENVIRONMENT.md) — backend/frontend env vars, Firestore auth
- [Testing Guide](docs/TESTING.md) — test architecture, mocks, running tests, technical details
- [Known Issues](docs/KNOWN_ISSUES.md) — security issues, bugs, code quality issues
- [Codebase Evaluation](EVALUATION.md) — initial full-stack assessment
- [Migration Plan](MIGRATION_PLAN.md) — Heroku to VPS migration plan

## Test Counts

| Suite | Tests |
|-------|-------|
| Backend unit (middleware, config, hackernews) | 19 |
| Backend integration (storyService, api, worker) | 39 |
| Frontend component (App, StoryList, Story) | 23 |
| Frontend service (storyService, loginService) | 6 |
| **Total** | **87** |

## Learnings Log

### Phase 0
- Initial CLAUDE.md created with project structure analysis
- Identified 6 key architectural gotchas from source code review

### Phase 1 — Backend Test Infrastructure
- Jest 30 installed with mongodb-memory-server for in-memory DB testing
- `setupFiles` in jest.config.js runs before the test framework — can't use `beforeAll`/`afterAll` there
- Solution: shared `tests/setup.js` module with `connect`/`clearDatabase`/`closeDatabase` helpers, imported by each test file
- The `storyService.js` module-load connection fails silently when `DB_URI` is undefined — this is fine in tests because we connect to the in-memory server afterward

### Phase 2 — Backend Unit Tests
- `jest.resetModules()` + `process.env` manipulation needed to test config.js (it caches at require-time)
- `axios` mock must be set up before requiring `services/hackernews.js`
- `checkStoryExists` and `addStories`/`updateStories` need real DB even though they're in the "hackernews" service

### Phase 3 — Backend Integration Tests
- `jsonwebtoken` breaks on Node.js 25 (SlowBuffer removed from buffer module)
- Solution: mock `jsonwebtoken` entirely in api.test.js with a simple token-store implementation
- `upsertUser` is fire-and-forget (no await) — API test needs `setTimeout` delay to verify user creation
- Confirmed `getHidden` null pointer bug with test: `Users.findOne()` returns null for nonexistent user

### Phase 4 — Frontend Test Infrastructure
- `npm install` in frontend needs `--legacy-peer-deps` due to react-scripts@5.0.1 peer dep conflicts
- CRA's Jest config doesn't transform `axios` (ESM) — added `transformIgnorePatterns` to frontend package.json
- `@testing-library/dom` is a peer dep of `@testing-library/react` that must be explicitly installed

### Phase 5 — Frontend Tests
- `moment` mock needs `__esModule: true` + `default` export pattern for CRA's Babel transform
- `getByText` uses exact matching — text inside multi-content elements (like `<small>` with icons) needs regex matchers
- Bootstrap JS must be mocked (`jest.mock("bootstrap/dist/js/bootstrap.bundle.min", () => {})`) to avoid JSDOM errors
- React 18 `act()` warnings are expected noise — the production code uses React 16's `ReactDOM.render` API

### Phase 6 — CI Pipeline
- Two parallel jobs: `backend-tests` and `frontend-tests`, each with Node 18+20 matrix
- Frontend `npm ci` needs `--legacy-peer-deps` flag in CI too

### Phase 7 — Documentation
- All docs structured for LLM consumption: tables, code blocks, explicit paths
- Documented 6 security issues, 6 bugs, and 10 code quality issues in KNOWN_ISSUES.md

### Phase 8 — Final Cleanup
- 86 total tests: 59 backend + 27 frontend, all passing
- 0 production code changes made
- All known bugs documented with corresponding test coverage

### Phase 9 — MongoDB → Firestore Migration
- Replaced MongoDB/Mongoose with Google Cloud Firestore (`@google-cloud/firestore`)
- Created `services/firestore.js` as lazy singleton with environment-prefixed collection refs
- Rewrote `services/storyService.js` — no module-load connection, uses Firestore SDK
- Rewrote `services/hackernews.js` — replaced Mongoose model ops with Firestore doc ops
- Rewrote `worker.js` — removed all pruning logic (unnecessary with 1GB Firestore free tier)
- Deleted `models/` directory (stories.js, users.js, comments.js)
- Removed `mongoose`, `mongoose-unique-validator`, `mongodb-memory-server` dependencies
- Tests use real Firestore (dev/ci prefix) instead of mongodb-memory-server
- `--experimental-vm-modules` required: gaxios uses dynamic `import()`, Jest blocks without this flag
- `orderBy("id", "desc")` instead of `orderBy("__name__", "desc")` to avoid custom index requirement
- Composite indexes needed for multi-inequality worker queries (time + updated)
- 82 total tests: 55 backend + 27 frontend (removed 4 obsolete tests, added 2 new worker tests, net -4)

### Phase 10 — Security & Functionality Fixes
- Removed password logging from login route (`console.log` of pw → username only)
- Added JWT expiration (`{ expiresIn: '24h' }`) to `jwt.sign()`
- Fixed hanging response in GET `/get` catch block — now returns 500 with generic error
- Added `helmet()` middleware for security headers (CSP, HSTS, X-Frame-Options, etc.)
- Restricted CORS: `localhost:3000` in development, `false` (same-origin) in production
- Added `express-rate-limit` on POST `/login`: 10 requests per 15-minute window
- Fixed error object leakage in `/hidden` routes — now returns `"authentication error"` string
- Added `isSafeUrl()` in Story component to prevent `javascript:` URL protocol injection
- Replaced Finnish/informal log strings (`"uppistakeikkaa"`, `"err"`, `"whoops"`) with English
- Replaced hardcoded Heroku URLs with relative paths + CRA proxy for dev
- Removed dead frontend dependencies: `jquery`, `popper.js`, `react-icons`, `typescript`
- Rate limiter state persists across test cases in same process — test needs to account for cumulative request count
- 87 total tests: 58 backend + 29 frontend (+3 backend, +2 frontend)

### Phase 11 — In-Memory MockFirestore for Tests
- Created `tests/mocks/firestore-mock.js`: ~230-line in-memory Firestore mock with MockFirestore, MockCollectionRef, MockDocRef, MockQuery, MockDocSnapshot, MockQuerySnapshot, MockWriteBatch, MockTimestamp
- Created `tests/mocks/firestore-sdk-shim.js`: 2-line shim exporting `{ Firestore: MockFirestore }` as drop-in replacement
- Added `moduleNameMapper` in `jest.config.js` to redirect `@google-cloud/firestore` → shim, preventing real SDK from loading
- Simplified `tests/setup.js`: `connect()` just suppresses console, `clearDatabase()` calls `getDb()._clear()`
- Removed `NODE_OPTIONS=--experimental-vm-modules` from `package.json` test script (no longer needed)
- MockTimestamp wraps Date objects on `.set()`/`.update()` so `doc.data().time.toDate()` works as expected
- Storage model: flat `Map<collectionPath, Map<docId, data>>` — subcollections stored as paths like `dev-users/testuser/hidden`
- Where operators: `>`, `<`, `>=`, `<=`, `==` — Date/MockTimestamp values unwrapped to milliseconds for comparison
- Reordered rate-limit test to be last in login describe block — fast mock exposed pre-existing rate limit exhaustion issue
- Backend tests now run in ~1 second (down from 30+ seconds), require no credentials or network
- 87 total tests: 58 backend + 29 frontend (unchanged)

### Phase 12 — CI Fix, Bug Fixes, Repo Cleanup
- Added `axios` as explicit frontend dependency (was hoisted from root, broke CI's isolated `npm ci`)
- Removed GCP credential setup from CI workflow (backend tests use in-memory mock since Phase 11)
- Added `await` to `upsertHidden()` and `upsertUser()` — eliminated fire-and-forget bugs
- Reordered `upsertUser()` before `res.json()` in login route — user is now created before response
- Removed `setTimeout(100ms)` workaround in api.test.js "creates user in DB" test
- Changed 5 hntoplinks URLs from `http://` to `https://`
- Renamed `sanitary()` to `isValidUsername()` with strict `[a-zA-Z0-9_-]+` regex (removed `\s`)
- Created `.env.example` documenting required `SECRET` env var
- Closed PR #72 (superseded), closed PRs #69/#70/#75 (deps not in direct dependencies)
- Deleted stale remote branches: `claude/repo-evaluation-review-kANiL`, `claude/heroku-vps-migration-plan-Z1nU8`
- Updated hntoplinks URL assertions in unit tests to match HTTPS change
- Added DOD item #6 (repo health: check PRs, CI, branches)
- 87 total tests: 58 backend + 29 frontend (unchanged)

### Phase 13 — Code Quality, Auth Middleware, README, Docs Cleanup
- Replaced 8 informal error strings (`"oops"`, `"whoops"`, `"opp"`) in `services/hackernews.js` with descriptive messages
- Extracted `authenticateToken` middleware in `routes/api.js` — JWT verification no longer duplicated across GET/POST `/hidden`
- Auth-related catch blocks in `/hidden` routes now return 500 (internal error) instead of 401 for non-auth failures
- Added `process.env.SECRET` validation in `bin/www` — server exits with FATAL message if missing
- Placed SECRET check in `bin/www` (not `app.js`) so tests can `require('../../app')` without triggering it
- Migrated `hackernews-frontend/src/index.js` from `ReactDOM.render` to `createRoot` (React 19 API)
- Wrote proper README.md with features, tech stack, prerequisites, quick start, testing, and docs links
- Fixed stale EVALUATION.md: removed MongoDB references (`$addToSet`, `findOne`, `models/comments.js`), updated dependency versions (React 19, Express 5), cleared resolved Dependabot PRs, updated recommendations
- Updated KNOWN_ISSUES.md: marked SECRET validation and ReactDOM.render as resolved
- Overall grade improved from B- to B
- 87 total tests: 58 backend + 29 frontend (unchanged)
