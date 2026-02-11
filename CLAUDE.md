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
   - This file (`CLAUDE.md`) — architecture, gotchas, test counts
   - All files under `docs/` (see Documentation section below)
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
└── docs/                   # LLM-geared documentation
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for process diagrams, data flow, and environment variables.

## Key Architectural Constraints & Gotchas

1. **Firestore lazy singleton**: `services/firestore.js` creates the Firestore client on first use via `getDb()`. No module-load side effects. `setDb()` allows test injection.

2. **Environment-prefixed collections**: Collections are prefixed by `NODE_ENV`: `dev-stories`/`prod-stories`/`ci-stories`. Logic in `services/firestore.js:getCollectionPrefix()`.

3. **In-memory MockFirestore for tests**: Tests use `jest.config.js` `moduleNameMapper` to replace `@google-cloud/firestore` with an in-memory mock (`tests/mocks/firestore-mock.js`). The real SDK never loads — no credentials, no network, no `--experimental-vm-modules` needed. The mock implements the exact Firestore API surface used by this project (collection/doc/query/batch/subcollections). `_clear()` wipes all data between tests.

4. **Worker testable via `syncOnce()`**: `worker.js` exports `syncOnce()` (one full sync cycle) and guards `throng` with `require.main === module`. Tests import `syncOnce()` directly with mocked `services/hackernews`.

5. **No input validation on API**: The `/get` endpoint doesn't validate timespan beyond a switch/default. The `/login` endpoint has `isValidUsername()` validation.

6. **`getHidden` returns empty array for missing users**: If username doesn't exist in Firestore, `getHidden` returns `[]` (no hidden stories).

7. **Node.js 25+ crashes the app**: `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` accesses `SlowBuffer.prototype` at require time. `SlowBuffer` was removed in Node 25. No upstream fix available. **Use Node.js 18 or 20.**

8. **Client-side sorting for stories**: Firestore can't `where('time', '>').orderBy('score', 'desc')` — the first `orderBy` must match the inequality field. `getStories()` fetches all matching docs, sorts by score in JS, then slices for pagination.

9. **Hidden stories use subcollection**: `{prefix}-users/{username}/hidden/{storyId}` — avoids Firestore's 1MB doc limit (one user had 117K hidden IDs = 1.2MB).

10. **Zero-padded story doc IDs**: Stories use `padId()` (10-digit zero-padded string) as doc ID for lexicographic ordering that matches numeric order.

## Documentation

All of these must be kept current with every change:

- [Architecture](docs/ARCHITECTURE.md) — system overview, directory structure, data flow, environment variables
- [API Reference](docs/API.md) — REST endpoints, request/response formats
- [Database Schemas](docs/DATABASE.md) — Firestore collections, subcollections, indexes, query patterns
- [Testing Guide](docs/TESTING.md) — test architecture, mocks, running tests, technical details

## Test Counts

| Suite | Tests |
|-------|-------|
| Backend unit (middleware, config, hackernews, firestore) | 29 |
| Backend integration (storyService, api, worker) | 46 |
| Frontend component (App, StoryList, Story) | 23 |
| Frontend service (storyService, loginService) | 6 |
| **Total** | **104** |

## Project Health

**Overall: B** — Working application with solid test coverage and good documentation.

| Category | Grade | Summary |
|----------|-------|---------|
| Functionality | B | Core features work; hntoplinks scraper is brittle (regex) |
| Security | B+ | Helmet, CORS, rate limiting, JWT expiry, SECRET validation |
| Testing | A- | 104 tests, in-memory mock, ~1s backend runs |
| Code Quality | A- | Modernized boilerplate, a11y fixes, bug fixes, dead code removed |
| Architecture | B | Firestore migration, lazy singleton, env-prefixed collections |
| Documentation | B+ | CLAUDE.md + 4 reference docs, proper README |
| DevOps / CI | B | GitHub Actions Node 22, npm audit + build in CI, npm caching; no Docker/linting |
| Performance | C+ | Client-side sort for Firestore constraint; no virtualization |
| Dependencies | B | 0 backend vulns; 9 frontend vulns locked behind react-scripts |

### Open Issues

- **Node.js 25+ crash** — `jsonwebtoken` chain uses removed `SlowBuffer`; no upstream fix
- **Token in localStorage** (`App.js`) — XSS vector; should migrate to HTTP-only cookie
- **CRA unmaintained** — `react-scripts@5.0.1` has 9 unfixable transitive vulnerabilities

### Vulnerability Status

- Backend: **0 vulnerabilities** — `npm audit` enforced in CI at `moderate` level
- Frontend: **9 unfixable vulnerabilities** locked behind `react-scripts@5.0.1` — `npm audit` enforced in CI at `critical` level

## Backlog

### Security
- JWT from localStorage to HTTP-only cookie

### Build & Tooling
- CRA to Vite migration (unblocks fixing 9 frozen frontend vulnerabilities)
- Add ESLint to backend
- Add pre-commit hooks (husky + lint-staged)
- Migrate Heroku → VPS (Docker Compose + nginx + certbot)

### API & Backend
- RESTful API naming (`/get` → `/stories`)

### Frontend
- Replace FontAwesome 5 packages with lighter alternative
- Add virtualization for large story lists

### Testing & Quality
- Add end-to-end tests (Playwright or Cypress)
- Add code coverage reporting

### Documentation & Governance
- Add JSDoc to exported functions
- Add CONTRIBUTING.md
- Add LICENSE file

## Key Learnings

- **Firestore query constraint**: Can't `where()` on one field and `orderBy()` on another. Client-side sort needed for stories (time filter + score sort). Composite indexes required for multi-inequality worker queries.
- **In-memory MockFirestore**: `moduleNameMapper` in `jest.config.js` redirects `@google-cloud/firestore` to an in-memory mock. Storage: flat `Map<collectionPath, Map<docId, data>>`. MockTimestamp wraps Date objects on `.set()`/`.update()`. Backend tests run in ~1 second with no credentials or network.
- **Node.js 25+ incompatibility**: `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` accesses `SlowBuffer.prototype` at require time. Must mock `jsonwebtoken` in tests; use Node.js 18/20 in production.
- **CRA testing quirks**: `axios` (ESM) needs `transformIgnorePatterns`; `dayjs` mock needs `__esModule: true` + `default` pattern. Bootstrap JS is imported only in `index.js` (not in components).
- **Rate limiter state persists across tests** — rate-limit test must be last in its describe block.
- **`bin/www` for startup checks**: SECRET validation lives in `bin/www` (not `app.js`) so tests can `require('../../app')` without triggering exit.
- **Logging convention**: `console.error` for errors (catch blocks), `console.log` for operational info (startup, sync progress). `tests/setup.js` suppresses both globally.
- **Frontend `npm install` needs `--legacy-peer-deps`** due to react-scripts@5.0.1 peer dep conflicts.
- **Bootstrap 5 data attributes**: Use `data-bs-toggle`/`data-bs-dismiss` (not `data-toggle`/`data-dismiss`). Class `dropdown-menu-right` was renamed to `dropdown-menu-end`.
- **`errorHandler` must not call `next()`**: Calling `next(error)` after `res.status().json()` triggers "headers already sent" errors if another error handler exists downstream.
- **SCSS in `.css` files is silently ignored**: CRA compiles `.css` files as plain CSS — `@include media-breakpoint-up()` is SCSS syntax and was silently dropped. Use standard `@media` queries instead.
