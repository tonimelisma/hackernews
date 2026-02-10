# CLAUDE.md — Project Governance & Definition of Done

## Project Summary

HackerNews aggregator: a Node.js/Express backend with a React frontend. The backend scrapes Hacker News stories, stores them in Google Cloud Firestore, and serves them via a REST API. A background worker (`worker.js`) periodically syncs new stories and updates scores. The frontend displays top stories with filtering by timespan and user-hidden stories.

## Quick Reference Commands

```bash
# IMPORTANT: Use Node.js 20 (Node 25+ crashes due to SlowBuffer removal)
# If using Homebrew: PATH="/opt/homebrew/opt/node@20/bin:$PATH"

# Backend tests (requires Firestore ADC: gcloud auth application-default login)
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

You own this repo. You are responsible for its state. Every iteration of work must end with the repo in a clean, working, documented state. No excuses.

### Before finishing any unit of work:

1. **All tests pass.** Run both suites, fix anything that breaks:
   ```bash
   npm test && cd hackernews-frontend && npm test -- --watchAll=false && cd ..
   ```
2. **Repo is clean.** `git status` shows no uncommitted changes. You test, commit, and push.
3. **Bugs get regression tests first.** When you find a bug, write a failing test that reproduces it *before* writing the fix. The test proves the bug exists and proves the fix works.
4. **All docs are updated.** Every iteration, review and update all documentation to reflect the current state of the code:
   - This file (`CLAUDE.md`) — architecture, gotchas, test counts, learnings
   - All files under `docs/` (see Documentation section below)
   - `docs/KNOWN_ISSUES.md` if new issues were found or old ones resolved
5. **No broken windows.** If you encounter a test failure, a stale doc, or inconsistent state — you fix it. It's your repo. There is no "someone else's problem."

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

3. **`--experimental-vm-modules` required for tests**: The `@google-cloud/firestore` SDK uses `gaxios` which calls dynamic `import()`. Jest's VM sandbox blocks this unless `NODE_OPTIONS=--experimental-vm-modules` is set. Configured in `package.json` test script.

4. **Worker is not directly testable**: `worker.js` calls `throng(1, main)` at module scope, starting an infinite loop. Worker logic must be tested indirectly by simulating its DB queries.

5. **No input validation on API**: The `/get` endpoint doesn't validate timespan beyond a switch/default. The `/login` endpoint has basic `sanitary()` check but logs passwords to console.

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
| Backend integration (storyService, api, worker) | 36 |
| Frontend component (App, StoryList, Story) | 21 |
| Frontend service (storyService, loginService) | 6 |
| **Total** | **82** |

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
