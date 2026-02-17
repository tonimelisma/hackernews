# CLAUDE.md — Project Governance & Definition of Done

## Project Summary

HackerNews aggregator: a Node.js/Express backend with a React frontend, deployed on a GCP e2-micro VPS via Docker + Caddy. The backend scrapes Hacker News stories, stores them in SQLite, and serves them via a REST API. An integrated background worker (setInterval, 15-minute cycle) syncs new stories and updates scores. The frontend displays top stories with filtering by timespan and user-hidden stories.

## Quick Reference Commands

```bash
# IMPORTANT: Use Node.js 20 (Node 25+ crashes due to SlowBuffer removal)
# If using Homebrew: PATH="/opt/homebrew/opt/node@20/bin:$PATH"

# Backend tests (uses in-memory SQLite — no credentials or network needed)
npm test

# Frontend tests
cd hackernews-frontend && npm test

# Run both
npm test && cd hackernews-frontend && npm test && cd ..

# Backend coverage
npm run test:coverage

# Frontend coverage
cd hackernews-frontend && npm run test:coverage && cd ..

# Backend lint
npm run lint

# Backend dev server
npm run watch

# Frontend dev server
cd hackernews-frontend && npm start

# Worker (standalone)
npm run worker

# Import JSON data to SQLite
npm run import
```

## Working Style

- **One command at a time.** Never chain shell commands with `&&`, `||`, or `;`. Run each command as a separate Bash tool call. This makes output easier to read and debug.

## Definition of Done

**This is a MANDATORY exit gate. You MUST run through every item below before considering any unit of work complete. Do not skip items. Do not defer them. If any gate fails, stop and fix it before finishing.**

You own this repo. You are the maintainer. There is no "someone else" — if there are uncommitted changes, failing tests, or stale docs, that's YOUR unfinished work from a previous session. You clean it up. Every iteration of work must end with the repo in a clean, working, documented state. No excuses.

### Mandatory Exit Checklist — run ALL gates before finishing:

1. **GATE: All tests pass.** Run both suites. If anything fails, stop and fix it.
   ```bash
   npm test
   cd hackernews-frontend && npm test
   ```
2. **GATE: Repo is clean and pushed.** `git status` shows no uncommitted changes. Commit and push. Always.
3. **GATE: Bugs get regression tests first.** When you find a bug, write a failing test that reproduces it *before* writing the fix. The test proves the bug exists and proves the fix works.
4. **GATE: All docs are updated.** Every iteration, review and update all documentation to reflect the current state of the code:
   - This file (`CLAUDE.md`) — architecture, gotchas, test counts
   - All files under `docs/` (see Documentation section below)
5. **GATE: No broken windows.** If you encounter a test failure, a stale doc, uncommitted changes, warnings, code smells, or inconsistent state — you fix it. It's your repo. There is no "someone else's problem." Never dismiss anything as "pre-existing noise" or "expected warnings." If it's in the output, you own it. Fix it or document exactly why it can't be fixed yet.
6. **GATE: Repo health checked.** Before finishing, run all of these:
   - `gh pr list --state open` — review open PRs, close stale ones
   - `gh run list --limit 5` — CI must be green on master
   - `git branch -r` — delete stale remote branches
   If CI is failing on master, that's YOUR broken build. Fix it first.
7. **GATE: Dependencies are up to date.** Run `ncu` in both root and `hackernews-frontend/`. If anything is outdated, update it (`ncu -u && npm install`), run tests, and commit. No stale versions.

## Architecture Overview

```
hackernews/
├── app.js                  # Express app setup (middleware, routes, static files)
├── worker.js               # Background sync (syncOnce export, 15m loop)
├── bin/www                 # HTTP server bootstrap + SECRET validation + worker init
├── routes/api.js           # REST API routes (/stories, /hidden, /login, /logout, /me)
├── services/
│   ├── database.js         # SQLite singleton (getDb, setDb, initSchema)
│   ├── storyService.js     # Story/user CRUD (SQL queries)
│   └── hackernews.js       # HN API client + story import/update
├── util/
│   ├── config.js           # Environment config (limitResults)
│   ├── dbLogger.js         # Per-request DB operation & cache analytics logging
│   └── middleware.js        # Express error handlers
├── eslint.config.js        # ESLint flat config (backend)
├── Dockerfile              # Multi-stage Docker build (node:20-alpine)
├── docker-compose.yml      # App + Caddy services, SQLite volume
├── Caddyfile               # Reverse proxy config (auto HTTPS)
├── hackernews-frontend/    # React frontend (Vite + Vitest)
│   └── src/
│       ├── App.jsx         # Main component (stories, auth, filtering)
│       ├── hooks/
│       │   └── useTheme.js # System dark/light mode detection
│       ├── components/
│       │   ├── Story.jsx   # Single story card
│       │   └── StoryList.jsx # Story list with hidden filtering
│       └── services/
│           ├── storyService.js  # API client for stories/hidden
│           └── loginService.js  # API client for login/logout/me
├── scripts/
│   └── import-json-to-sqlite.js # Import JSON → SQLite
├── .github/workflows/ci.yml # CI + SSH deploy pipeline
├── .husky/pre-commit       # Pre-commit hook (lint-staged)
└── docs/                   # LLM-geared documentation
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for process diagrams, data flow, and environment variables.

## Key Architectural Constraints & Gotchas

1. **SQLite lazy singleton**: `services/database.js` creates the SQLite connection on first use via `getDb()`. Enables WAL mode and foreign keys. `setDb()` allows test injection of `:memory:` databases. `initSchema()` creates tables and indexes (idempotent).

2. **In-memory SQLite for tests**: Tests use `better-sqlite3` with `:memory:` databases via `setDb()` in `tests/setup.js`. No credentials, no network, no mocking of database modules. `clearDatabase()` truncates all tables between tests. Backend tests run in ~1 second.

3. **Worker testable via `syncOnce()`**: `worker.js` exports `syncOnce()` (one full sync cycle) and guards `main()` with `require.main === module`. Tests import `syncOnce()` directly with mocked `services/hackernews`. Worker is integrated into the Express process via `setInterval` in `bin/www`.

4. **Single SQL query for stories**: `getStories()` uses a single SQL query that handles time filtering, hidden story exclusion, score sorting, and pagination — all in one step. No client-side sorting, no multi-tier cache, no merge logic needed.

5. **No input validation on API**: The `/stories` endpoint doesn't validate timespan beyond a switch/default. The `/login` endpoint has `isValidUsername()` validation. `/stories` optionally reads auth cookie for server-side hidden filtering.

6. **`getHidden` returns empty array for missing users**: If username doesn't exist in the database, `getHidden` returns `[]` (no hidden stories).

7. **Node.js 25+ crashes the app**: `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` accesses `SlowBuffer.prototype` at require time. `SlowBuffer` was removed in Node 25. No upstream fix available. **Use Node.js 18 or 20.**

8. **L1 in-memory cache**: `storyService.js` caches SQL query results per timespan with a 1-minute TTL in an in-memory `Map`. `clearCache()` clears both the story cache and the per-user hidden cache. Tests must `await clearCache()` in afterEach.

9. **Hidden stories in-memory cache + deduplication**: `getHidden()` caches per-user hidden IDs for 5 minutes (`HIDDEN_CACHE_TTL`). `upsertHidden()` invalidates the cache. Concurrent requests for the same user are deduplicated via `hiddenPending` Map (returns same in-flight Promise).

10. **Server-side hidden story filtering**: `GET /stories` optionally reads the auth cookie via `optionalAuth()`. If authenticated, fetches hidden IDs and passes them to `getStories()` which excludes them via SQL `WHERE id NOT IN (...)`. The story cache is shared (not per-user). Anonymous users are unaffected.

11. **react-virtuoso for story lists**: `StoryList.jsx` uses `<Virtuoso useWindowScroll>` to render only visible stories from up to 500 items. Tests mock `react-virtuoso` to render all items synchronously.

12. **Hidden stories localStorage persistence**: Anonymous users' hidden state persists via `localStorage` (`hiddenStories` key). On login, server hidden IDs are merged with localStorage, and any localStorage-only IDs are synced back to the server (fire-and-forget). `hiddenLoaded` state gates `StoryList` rendering to prevent flash of unhidden stories.

13. **Dark mode via system preference**: Bootstrap 5.3's `data-bs-theme` attribute on `<html>`. A synchronous `<script>` in `index.html` sets the attribute before first paint (no flash). `useTheme` hook listens for live OS changes. No manual toggle — system detection only.

14. **Static file caching strategy**: `index.html` served with `Cache-Control: no-cache`; hashed `/assets/*` files served with `max-age=1y, immutable`.

15. **Docker deployment**: `Dockerfile` builds node:20-alpine image with npm ci + frontend build. `docker-compose.yml` runs app + Caddy (reverse proxy with auto HTTPS). SQLite data persisted via Docker volume. CI/CD deploys via SSH + `docker compose up --build -d`.

## Documentation

All of these must be kept current with every change:

- [Architecture](docs/ARCHITECTURE.md) — system overview, directory structure, data flow, environment variables
- [API Reference](docs/API.md) — REST endpoints, request/response formats
- [Database Schemas](docs/DATABASE.md) — SQLite tables, indexes, query patterns
- [Testing Guide](docs/TESTING.md) — test architecture, mocks, running tests, technical details

## Test Counts

| Suite | Tests |
|-------|-------|
| Backend unit (middleware, config, hackernews, database, dbLogger) | 46 |
| Backend integration (storyService, api, worker) | 71 |
| Frontend component (App, StoryList, Story) | 33 |
| Frontend hook (useTheme) | 4 |
| Frontend service (storyService, loginService) | 8 |
| **Total** | **162** |

## Project Health

**Overall: A-** — Working application with solid test coverage, good documentation, simplified architecture (SQLite), and automated Docker deployment.

| Category | Grade | Summary |
|----------|-------|---------|
| Functionality | B | Core features work; hntoplinks scraper is brittle (regex) |
| Security | A- | Helmet, CORS, rate limiting, JWT in HTTP-only cookie, SECRET validation |
| Testing | A- | 162 tests, in-memory SQLite, ~1s backend runs |
| Code Quality | A- | Clean codebase, dead code removed, SQLite simplification |
| Architecture | A- | SQLite eliminates all Firestore hacks (L2 cache, patchStoryCache, Day-merge, padId, stripUndefined) |
| Documentation | A- | CLAUDE.md + 4 reference docs, all updated |
| DevOps / CI | B+ | Docker + Caddy on VPS, GitHub Actions CI/CD with SSH deploy, npm audit, ESLint, pre-commit hooks |
| Performance | A- | Sub-ms SQL queries, L1 cache, hidden cache, react-virtuoso |
| Dependencies | A- | 0 vulnerabilities in both backend and frontend |

### Open Issues

- **Node.js 25+ crash** — `jsonwebtoken` chain uses removed `SlowBuffer`; no upstream fix

### Vulnerability Status

- Backend: **0 vulnerabilities** — `npm audit` enforced in CI at `moderate` level
- Frontend: **0 vulnerabilities** — `npm audit` enforced in CI at `moderate` level (Vite replaced CRA)

## Backlog

### Frontend
- Replace FontAwesome 5 packages with lighter alternative

### Testing & Quality
- Add end-to-end tests (Playwright or Cypress)

### Documentation & Governance
- Add JSDoc to exported functions
- Add CONTRIBUTING.md
- Add LICENSE file

### Infrastructure
- VPS provisioning (GCP e2-micro, Docker, Caddy, Cloudflare DNS)

## Key Learnings

- **SQLite eliminates Firestore architectural hacks**: Moving from Firestore to SQLite removed: L2 cache, patchStoryCache, mergeStories, Day-merge, padId, stripUndefined, MAX_QUERY_DOCS buffer, cacheDocToStories, storiesToCacheDoc, CACHE_TTLS, environment-prefixed collections, subcollection pattern for hidden stories, batched operations (BATCH_SIZE=20). A single SQL query (`WHERE time > ? AND id NOT IN (...) ORDER BY score DESC LIMIT ? OFFSET ?`) replaces ~200 lines of cache/merge/filter logic.
- **Node.js 25+ incompatibility**: `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` accesses `SlowBuffer.prototype` at require time. Must mock `jsonwebtoken` in tests; use Node.js 18/20 in production.
- **Vitest mock differences**: `vi.mock()` factory must return an object with `default` key for default exports. No `__esModule: true` needed. Axios mock: `vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }))`.
- **Node.js 22 localStorage conflict**: Node.js 22's built-in `localStorage` (experimental) conflicts with jsdom in Vitest. Must stub localStorage with `vi.stubGlobal("localStorage", mockImpl)` in tests that use it.
- **Rate limiter state persists across tests** — rate-limit test must be last in its describe block.
- **`bin/www` for startup checks**: SECRET validation lives in `bin/www` (not `app.js`) so tests can `require('../../app')` without triggering exit. Database initialization and worker startup also live in `bin/www`.
- **jsdom lacks `window.matchMedia`**: Must stub in `setupTests.js` (global) for any component using `useTheme`. Tests that need specific matchMedia behavior reassign `window.matchMedia` in `beforeEach`.
- **Logging convention**: `console.error` for errors (catch blocks), `console.log` for operational info (startup, sync progress). `tests/setup.js` suppresses both globally. Per-request DB analytics use `[db]`-tagged structured log lines via `util/dbLogger.js` — tracks per-table reads/writes, L1/MISS cache metrics, and latency. `[db-query]` inline logs show individual query details with row counts and timing.
- **Pre-commit hooks**: husky + lint-staged run `eslint --fix` on staged `.js` files. Backend ESLint config ignores `hackernews-frontend/`.
- **Bootstrap 5 data attributes**: Use `data-bs-toggle`/`data-bs-dismiss` (not `data-toggle`/`data-dismiss`). Class `dropdown-menu-right` was renamed to `dropdown-menu-end`.
- **`errorHandler` must not call `next()`**: Calling `next(error)` after `res.status().json()` triggers "headers already sent" errors if another error handler exists downstream.
- **Vite build output**: `build.outDir` set to `"build"` in `vite.config.js` to match Express static path in `app.js`. `build/` is gitignored.
- **HN login detection via redirect path**: After POSTing to HN login with `{ withCredentials: true }`, axios follows the redirect. On success, `response.request.path` is `/news`; on failure, it's `/login`.
- **Bootstrap `data-bs-auto-close="outside"`**: Prevents dropdown from closing on clicks inside the menu (e.g., login form). Without it, clicking the Login button closes the dropdown before the user sees the result.
- **react-virtuoso for list virtualization**: `<Virtuoso useWindowScroll data={...} itemContent={...} />` renders only visible items. In tests, mock with a simple `({ data, itemContent }) => data.map(...)` to render all items synchronously. Must mock in every test file that renders a component using Virtuoso (both StoryList.test.jsx and App.test.jsx).
- **Hidden stories localStorage persistence**: Anonymous users' hidden state persists via localStorage (`hiddenStories` key). On login, server hidden IDs are merged with localStorage (deduplicated via `Set`). `hiddenLoaded` state gates StoryList rendering to prevent flash of unhidden stories on page refresh.
- **Hidden stories cross-device sync**: localStorage-only hidden IDs are synced to the server on page load (fire-and-forget, best-effort).
- **SQLite WAL mode**: Enabled via `db.pragma("journal_mode = WAL")` for concurrent read/write support. Important for the integrated worker running alongside the Express server.
- **In-memory SQLite for tests**: `better-sqlite3` with `new Database(":memory:")` via `setDb()`. No moduleNameMapper needed. `clearDatabase()` runs `DELETE FROM` on all tables. Tests complete in ~1 second.
