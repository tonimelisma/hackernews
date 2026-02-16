# CLAUDE.md — Project Governance & Definition of Done

## Project Summary

HackerNews aggregator: a Node.js/Express backend with a React frontend, deployed on Google App Engine Standard. The backend scrapes Hacker News stories, stores them in Google Cloud Firestore, and serves them via a REST API. An App Engine Cron job triggers `/_ah/worker` every 15 minutes to sync new stories and update scores. The frontend displays top stories with filtering by timespan and user-hidden stories.

## Quick Reference Commands

```bash
# IMPORTANT: Use Node.js 20 (Node 25+ crashes due to SlowBuffer removal)
# If using Homebrew: PATH="/opt/homebrew/opt/node@20/bin:$PATH"

# Backend tests (uses in-memory mock — no credentials or network needed)
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

# Firestore smoke tests (requires ADC, hits real dev- Firestore, max 50 reads + 50 writes)
npm run test:firestore

# Backend dev server (requires Firestore ADC)
npm run watch

# Frontend dev server
cd hackernews-frontend && npm start

# Worker
npm run worker
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
├── app.js                  # Express app setup (middleware, routes, static files, /_ah/worker)
├── worker.js               # Background sync (syncOnce export, throng for local dev)
├── routes/api.js           # REST API routes (/stories, /hidden, /login, /logout, /me)
├── services/
│   ├── firestore.js        # Firestore client singleton, collection refs, padId()
│   ├── storyService.js     # Firestore CRUD for stories/users
│   └── hackernews.js       # HN API client + hntoplinks scraper
├── util/
│   ├── config.js           # Environment config (limitResults)
│   ├── firestoreLogger.js  # Per-request Firestore operation & cache analytics logging
│   └── middleware.js        # Express error handlers
├── eslint.config.js        # ESLint flat config (backend)
├── app.yaml                # App Engine production config
├── staging.yaml            # App Engine staging config
├── cron.yaml               # App Engine Cron (15-min worker sync)
├── .gcloudignore           # Files excluded from App Engine deploy
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
├── tests/integration/
│   └── firestore-smoke.test.js  # Standalone smoke tests against real Firestore (not Jest)
├── scripts/                # Migration scripts (import, audit, export)
├── .github/workflows/ci.yml # CI + deploy pipeline (staging auto, prod manual)
├── .husky/pre-commit       # Pre-commit hook (lint-staged)
└── docs/                   # LLM-geared documentation
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for process diagrams, data flow, and environment variables.

## Key Architectural Constraints & Gotchas

1. **Firestore lazy singleton**: `services/firestore.js` creates the Firestore client on first use via `getDb()`. No module-load side effects. `setDb()` allows test injection.

2. **Environment-prefixed collections**: Collections are prefixed by `NODE_ENV`: `prod-`/`staging-`/`ci-`/`dev-` (default). Logic in `services/firestore.js:getCollectionPrefix()`.

3. **In-memory MockFirestore for tests**: Tests use `jest.config.js` `moduleNameMapper` to replace `@google-cloud/firestore` with an in-memory mock (`tests/mocks/firestore-mock.js`). The real SDK never loads — no credentials, no network, no `--experimental-vm-modules` needed. The mock implements the exact Firestore API surface used by this project (collection/doc/query/batch/subcollections). `_clear()` wipes all data between tests.

4. **Worker testable via `syncOnce()`**: `worker.js` exports `syncOnce()` (one full sync cycle) and guards `throng` with `require.main === module`. Tests import `syncOnce()` directly with mocked `services/hackernews`.

5. **No input validation on API**: The `/stories` endpoint doesn't validate timespan beyond a switch/default. The `/login` endpoint has `isValidUsername()` validation. `/stories` optionally reads auth cookie for server-side hidden filtering.

6. **`getHidden` returns empty array for missing users**: If username doesn't exist in Firestore, `getHidden` returns `[]` (no hidden stories).

7. **Node.js 25+ crashes the app**: `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` accesses `SlowBuffer.prototype` at require time. `SlowBuffer` was removed in Node 25. No upstream fix available. **Use Node.js 18 or 20.**

8. **Query optimization for stories**: "All" timespan uses `orderBy('score', 'desc').limit(500)` — Firestore sorts directly. Time-filtered timespans use `where('time', '>').orderBy('time', 'desc')` (no limit) to fetch all stories in the range, then sort by score client-side and keep top `MAX_QUERY_DOCS=500`. Firestore requires the first `orderBy` to match the inequality field, so we can't sort by score server-side for time-filtered queries. Cache TTLs (30d for Year) ensure the unlimited query runs rarely. Worker staleness queries use compound inequality (`time > threshold AND updated < staleness`) — requires composite index on `(time ASC, updated ASC)`.

9. **Two-tier story cache (L1 in-memory + L2 Firestore)**: `storyService.js` caches Firestore query results per timespan with tiered TTLs: Day=30min, Week=2d, Month=1w, Year=1mo, All=1mo. L1 is an in-memory `Map`. L2 stores cached stories in `{prefix}-cache/{timespan}` Firestore docs (stories with `time` as epoch millis, plus `cachedAt` timestamp). On L1 miss, L2 is checked before running the expensive L3 stories query. L2 prevents cold-start Year requests from costing 20K+ Firestore reads. Non-Day timespans merge in fresh Day stories on every request. `clearCache()` is async and clears both L1 and L2 (batch-deletes all cache docs). Tests must `await clearCache()` in afterEach.

10. **Hidden stories use subcollection**: `{prefix}-users/{username}/hidden/{storyId}` — avoids Firestore's 1MB doc limit (one user had 117K hidden IDs = 1.2MB).

11. **Zero-padded story doc IDs**: Stories use `padId()` (10-digit zero-padded string) as doc ID for lexicographic ordering that matches numeric order.

12. **Worker via App Engine Cron**: `cron.yaml` fires `GET /_ah/worker` every 15 minutes on the production service. The endpoint checks `X-Appengine-Cron: true` header (App Engine strips this from external requests). Calls `syncOnce()` from `worker.js`. Uses compound inequality queries (`time > X AND updated < Y`) with staleness thresholds: daily=1h, weekly=6h, monthly=48h. Each query capped at `WORKER_BATCH_LIMIT=200`. Requires composite index on `(time ASC, updated ASC)` — see `docs/DATABASE.md`.

13. **react-virtuoso for story lists**: `StoryList.jsx` uses `<Virtuoso useWindowScroll>` to render only visible stories from up to 500 items. Tests mock `react-virtuoso` to render all items synchronously.

14. **Hidden stories localStorage persistence**: Anonymous users' hidden state persists via `localStorage` (`hiddenStories` key). On login, server hidden IDs are merged with localStorage. `hiddenLoaded` state gates `StoryList` rendering to prevent flash of unhidden stories.

18. **Hidden stories in-memory cache**: `getHidden()` caches per-user hidden IDs for 5 minutes (`HIDDEN_CACHE_TTL`). `upsertHidden()` invalidates the cache. Prevents a user with 3,594 hidden stories from triggering 3,594 Firestore reads on every page load.

19. **Server-side hidden story filtering**: `GET /stories` optionally reads the auth cookie via `optionalAuth()`. If authenticated, fetches hidden IDs and passes them to `getStories()` which filters them out before slicing. The story cache is shared (not per-user). Anonymous users are unaffected.

19. **`stripUndefined()` for Firestore writes**: HN API items may lack `kids`, `url`, or `text` fields (returned as `undefined`). Firestore throws `Cannot use "undefined" as a Firestore value`. `stripUndefined()` in `services/hackernews.js` filters out undefined values before `.set()` and `.update()` calls.

15. **Dark mode via system preference**: Bootstrap 5.3's `data-bs-theme` attribute on `<html>`. A synchronous `<script>` in `index.html` sets the attribute before first paint (no flash). `useTheme` hook listens for live OS changes. Navbar stays `navbar-dark bg-dark` in both modes. Story cards use `bg-body-secondary` (theme-aware). No manual toggle — system detection only.

14. **`getHidden` skips user doc check**: Reads subcollection directly — empty snapshot = no hidden stories. Saves 1 Firestore read per authenticated request.

15. **App Engine deployment**: Production (`app.yaml`) and staging (`staging.yaml`) services. `env_variables.yaml` (gitignored) holds the JWT `SECRET`. `gcp-build` script in `package.json` builds the frontend during deploy. Staging uses `BOOTSTRAP_ON_START=true` for fire-and-forget initial sync on startup.

17. **Static file caching strategy**: App Engine sets all deployed file mtimes to `1980-01-01`. Express ETags are based on `filesize + mtime`, so if `index.html` stays the same byte size between deploys (Vite hashes are same length), the ETag never changes and browsers get stale 304s. Fix: `index.html` is served with `Cache-Control: no-cache`; hashed `/assets/*` files are served with `max-age=1y, immutable`.

16. **CI/CD pipeline**: GitHub Actions deploys to staging on every push to master (after tests pass), then to production after manual approval via GitHub environment protection rules. Uses Workload Identity Federation for keyless GCP auth. CI service account requires `roles/cloudscheduler.admin` for `cron.yaml` deployment (App Engine cron uses Cloud Scheduler under the hood).

## Documentation

All of these must be kept current with every change:

- [Architecture](docs/ARCHITECTURE.md) — system overview, directory structure, data flow, environment variables
- [API Reference](docs/API.md) — REST endpoints, request/response formats
- [Database Schemas](docs/DATABASE.md) — Firestore collections, subcollections, indexes, query patterns
- [Testing Guide](docs/TESTING.md) — test architecture, mocks, running tests, technical details

## Test Counts

| Suite | Tests |
|-------|-------|
| Backend unit (middleware, config, hackernews, firestore, firestoreLogger) | 52 |
| Backend integration (storyService, api, worker) | 70 |
| Frontend component (App, StoryList, Story) | 31 |
| Frontend hook (useTheme) | 4 |
| Frontend service (storyService, loginService) | 8 |
| **Total (mock-based)** | **165** |
| Firestore smoke (real dev- data, standalone) | 8 |

## Project Health

**Overall: B+** — Working application with solid test coverage, good documentation, and automated cloud deployment.

| Category | Grade | Summary |
|----------|-------|---------|
| Functionality | B | Core features work; hntoplinks scraper is brittle (regex) |
| Security | A- | Helmet, CORS, rate limiting, JWT in HTTP-only cookie, SECRET validation |
| Testing | A- | 165 tests, in-memory mock, ~1s backend runs |
| Code Quality | A- | Modernized boilerplate, a11y fixes, bug fixes, dead code removed |
| Architecture | B | Firestore migration, lazy singleton, env-prefixed collections |
| Documentation | B+ | CLAUDE.md + 4 reference docs, proper README |
| DevOps / CI | A- | App Engine Standard, GitHub Actions CI/CD with staging auto-deploy + prod approval gate, WIF auth, npm audit, ESLint, pre-commit hooks |
| Performance | B | Two-tier cache (L1+L2), hidden cache, client-side sort for Firestore constraint, react-virtuoso |
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

## Key Learnings

- **Firestore query constraint**: Can't `where()` on one field and `orderBy()` on another (first `orderBy` must match inequality field). For "All" timespan, use `orderBy('score').limit(500)` directly. For time-filtered, use `where('time').orderBy('time')` (no limit) then sort by score and slice client-side. Using `limit(500)` on time-filtered queries is wrong — it returns the 500 most recent by time, not the 500 highest by score, causing Year to show only ~10 days of stories. Composite indexes required for multi-inequality worker queries.
- **Firestore free tier optimization**: Spark plan allows 50K reads/20K writes per day. Key levers: `.limit()` on all queries (500 for API, 200 for worker), 1h in-memory TTL cache for story queries, 30-min worker cycle with relaxed staleness thresholds (1h/6h/48h). Removed unbounded 14d-old query.
- **In-memory MockFirestore**: `moduleNameMapper` in `jest.config.js` redirects `@google-cloud/firestore` to an in-memory mock. Storage: flat `Map<collectionPath, Map<docId, data>>`. MockTimestamp wraps Date objects on `.set()`/`.update()`. Backend tests run in ~1 second with no credentials or network.
- **Node.js 25+ incompatibility**: `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` accesses `SlowBuffer.prototype` at require time. Must mock `jsonwebtoken` in tests; use Node.js 18/20 in production.
- **Vitest mock differences**: `vi.mock()` factory must return an object with `default` key for default exports. No `__esModule: true` needed. Axios mock: `vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }))`.
- **Node.js 22 localStorage conflict**: Node.js 22's built-in `localStorage` (experimental) conflicts with jsdom in Vitest. Must stub localStorage with `vi.stubGlobal("localStorage", mockImpl)` in tests that use it.
- **Rate limiter state persists across tests** — rate-limit test must be last in its describe block.
- **`bin/www` for startup checks**: SECRET validation lives in `bin/www` (not `app.js`) so tests can `require('../../app')` without triggering exit.
- **jsdom lacks `window.matchMedia`**: Must stub in `setupTests.js` (global) for any component using `useTheme`. Tests that need specific matchMedia behavior reassign `window.matchMedia` in `beforeEach`.
- **Logging convention**: `console.error` for errors (catch blocks), `console.log` for operational info (startup, sync progress). `tests/setup.js` suppresses both globally. Per-request Firestore analytics use `[firestore]`-tagged structured log lines via `util/firestoreLogger.js` — tracks per-collection reads/writes, L1/L2/MISS cache metrics, and latency. `[firestore-query]` inline logs show individual query details with doc counts and timing. `ctx` parameter is optional on all service functions (backwards-compatible).
- **Pre-commit hooks**: husky + lint-staged run `eslint --fix` on staged `.js` files. Backend ESLint config ignores `hackernews-frontend/`.
- **Bootstrap 5 data attributes**: Use `data-bs-toggle`/`data-bs-dismiss` (not `data-toggle`/`data-dismiss`). Class `dropdown-menu-right` was renamed to `dropdown-menu-end`.
- **`errorHandler` must not call `next()`**: Calling `next(error)` after `res.status().json()` triggers "headers already sent" errors if another error handler exists downstream.
- **Vite build output**: `build.outDir` set to `"build"` in `vite.config.js` to match Express static path in `app.js`. `build/` is gitignored.
- **App Engine `gcp-build`**: `package.json` script runs `cd hackernews-frontend && npm ci && npm run build` during deploy. App Engine runs this automatically after `npm install`.
- **App Engine Cron + `X-Appengine-Cron`**: App Engine strips the `X-Appengine-Cron` header from external requests. The `/_ah/worker` endpoint checks for this header to ensure only App Engine Cron can trigger syncs.
- **Workload Identity Federation for CI/CD**: GitHub Actions authenticates to GCP via OIDC tokens (no service account keys). Requires WIF pool + provider + attribute condition restricting to the specific repo.
- **`env_variables.yaml` for App Engine secrets**: Gitignored file included by `app.yaml`/`staging.yaml`. In CI/CD, written from `secrets.APP_SECRET` during the deploy step. Must NOT be in `.gcloudignore` (needs to be deployed).
- **HN login detection via redirect path**: After POSTing to HN login with `{ withCredentials: true }`, axios follows the redirect. On success, `response.request.path` is `/news`; on failure, it's `/login`. This is the proven approach that works on App Engine. Alternative approaches (checking response body for "Bad login", using `maxRedirects: 0` + Location header) were tried but broke in production.
- **App Engine cron requires Cloud Scheduler IAM**: `gcloud app deploy cron.yaml` requires `cloudscheduler.locations.list` permission. The CI service account needs `roles/cloudscheduler.admin`.
- **Bootstrap `data-bs-auto-close="outside"`**: Prevents dropdown from closing on clicks inside the menu (e.g., login form). Without it, clicking the Login button closes the dropdown before the user sees the result.
- **App Engine static file caching**: App Engine sets all deployed file mtimes to `1980-01-01`. Express weak ETags are `W/"size-mtime"`. If `index.html` stays the same byte size across deploys (Vite hashes are fixed-length), the ETag doesn't change and browsers get 304 for stale HTML referencing nonexistent JS bundles. Fix: serve `index.html` with `Cache-Control: no-cache`; serve hashed `/assets/*` with `immutable, max-age=1y`.
- **react-virtuoso for list virtualization**: `<Virtuoso useWindowScroll data={...} itemContent={...} />` renders only visible items. In tests, mock with a simple `({ data, itemContent }) => data.map(...)` to render all items synchronously. Must mock in every test file that renders a component using Virtuoso (both StoryList.test.jsx and App.test.jsx).
- **Hidden stories localStorage persistence**: Anonymous users' hidden state persists via localStorage (`hiddenStories` key). On login, server hidden IDs are merged with localStorage (deduplicated via `Set`). `hiddenLoaded` state gates StoryList rendering to prevent flash of unhidden stories on page refresh.
- **Batched Firestore operations**: All parallel Firestore reads/writes use `BATCH_SIZE=20` batching (in `services/hackernews.js`): `getItems`, `checkStoryExists`, `addStories`, `updateStories`. Prevents unbounded concurrent connections.
- **Node 22+ `--localstorage-file` warning suppression**: Override `process.emit` in `jest.config.js` (runs before any test) to filter out the experimental localStorage warning. Must be in jest.config.js, not in test setup files which load too late.
- **Firestore L2 cache for cold starts**: App Engine's read-only filesystem makes disk cache dead code. The in-memory L1 cache is lost when App Engine scales to zero. L2 Firestore cache docs (`{prefix}-cache/{timespan}`) survive cold starts — a Year request goes from 20K+ reads to 1 read on L2 hit.
- **Worker compound inequality queries**: Single `.where("updated", "<", staleness)` returns the 200 most-stale stories from the *entire* collection (years-old stories). Client-side time filtering removes them all, resulting in `updated=0`. Fix: compound queries `.where("time", ">", threshold).where("updated", "<", staleness)` — only returns actionable stories within the relevant time window. Requires composite index on `(time ASC, updated ASC)`.
- **Hidden stories in-memory cache**: A user with 3,594 hidden stories triggers 3,594 reads per `GET /stories` request. 5-minute TTL per-user cache reduces this to one read per 5 minutes. `upsertHidden` invalidates the cache entry.
- **Firestore operation logging with per-collection breakdown**: `[firestore]` summary lines now show `reads=stories:42,cache:1` instead of `reads=43`. `[firestore-query]` inline logs show each query as it happens with doc count and timing. L1/L2/MISS cache tracking distinguishes in-memory hits from Firestore cache hits.
