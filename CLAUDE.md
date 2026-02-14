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

You own this repo. You are the maintainer. There is no "someone else" — if there are uncommitted changes, failing tests, or stale docs, that's YOUR unfinished work from a previous session. You clean it up. Every iteration of work must end with the repo in a clean, working, documented state. No excuses.

### Before finishing any unit of work:

1. **All tests pass.** Run both suites, fix anything that breaks:
   ```bash
   npm test && cd hackernews-frontend && npm test && cd ..
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
7. **Dependencies are up to date.** Run `ncu` in both root and `hackernews-frontend/`. If anything is outdated, update it (`ncu -u && npm install`), run tests, and commit. No stale versions.

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

5. **No input validation on API**: The `/stories` endpoint doesn't validate timespan beyond a switch/default. The `/login` endpoint has `isValidUsername()` validation.

6. **`getHidden` returns empty array for missing users**: If username doesn't exist in Firestore, `getHidden` returns `[]` (no hidden stories).

7. **Node.js 25+ crashes the app**: `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` accesses `SlowBuffer.prototype` at require time. `SlowBuffer` was removed in Node 25. No upstream fix available. **Use Node.js 18 or 20.**

8. **Query optimization for stories**: "All" timespan uses `orderBy('score', 'desc').limit(500)` — Firestore sorts directly. Time-filtered timespans use `where('time', '>').orderBy('time', 'desc').limit(500)` then sort by score client-side. Both cap at `MAX_QUERY_DOCS=500` to stay within Firestore free tier quotas.

9. **Disk-persisted TTL cache with Day-merge**: `storyService.js` caches Firestore query results per timespan with tiered TTLs: Day=30min, Week=2d, Month=1w, Year=1mo, All=1mo. Cache is persisted to `.cache/stories.json` (gitignored) and restored on app restart. Non-Day timespans merge in fresh Day stories on every request, so new high-scoring stories appear in Week/Month/Year/All without waiting for full cache expiry. Disk persistence disabled in tests (`NODE_ENV=test`). `clearCache()` exported for tests.

10. **Hidden stories use subcollection**: `{prefix}-users/{username}/hidden/{storyId}` — avoids Firestore's 1MB doc limit (one user had 117K hidden IDs = 1.2MB).

11. **Zero-padded story doc IDs**: Stories use `padId()` (10-digit zero-padded string) as doc ID for lexicographic ordering that matches numeric order.

12. **Worker via App Engine Cron**: `cron.yaml` fires `GET /_ah/worker` every 15 minutes on the production service. The endpoint checks `X-Appengine-Cron: true` header (App Engine strips this from external requests). Calls `syncOnce()` from `worker.js`. Staleness thresholds: daily=1h, weekly=6h, monthly=48h. Each query capped at `WORKER_BATCH_LIMIT=200`.

13. **Dark mode via system preference**: Bootstrap 5.3's `data-bs-theme` attribute on `<html>`. A synchronous `<script>` in `index.html` sets the attribute before first paint (no flash). `useTheme` hook listens for live OS changes. Navbar stays `navbar-dark bg-dark` in both modes. Story cards use `bg-body-secondary` (theme-aware). No manual toggle — system detection only.

14. **`getHidden` skips user doc check**: Reads subcollection directly — empty snapshot = no hidden stories. Saves 1 Firestore read per authenticated request.

15. **App Engine deployment**: Production (`app.yaml`) and staging (`staging.yaml`) services. `env_variables.yaml` (gitignored) holds the JWT `SECRET`. `gcp-build` script in `package.json` builds the frontend during deploy. Staging uses `BOOTSTRAP_ON_START=true` for fire-and-forget initial sync on startup.

16. **CI/CD pipeline**: GitHub Actions deploys to staging on every push to master (after tests pass), then to production after manual approval via GitHub environment protection rules. Uses Workload Identity Federation for keyless GCP auth.

## Documentation

All of these must be kept current with every change:

- [Architecture](docs/ARCHITECTURE.md) — system overview, directory structure, data flow, environment variables
- [API Reference](docs/API.md) — REST endpoints, request/response formats
- [Database Schemas](docs/DATABASE.md) — Firestore collections, subcollections, indexes, query patterns
- [Testing Guide](docs/TESTING.md) — test architecture, mocks, running tests, technical details

## Test Counts

| Suite | Tests |
|-------|-------|
| Backend unit (middleware, config, hackernews, firestore) | 30 |
| Backend integration (storyService, api, worker) | 60 |
| Frontend component (App, StoryList, Story) | 23 |
| Frontend hook (useTheme) | 4 |
| Frontend service (storyService, loginService) | 8 |
| **Total (mock-based)** | **125** |
| Firestore smoke (real dev- data, standalone) | 8 |

## Project Health

**Overall: B+** — Working application with solid test coverage, good documentation, and automated cloud deployment.

| Category | Grade | Summary |
|----------|-------|---------|
| Functionality | B | Core features work; hntoplinks scraper is brittle (regex) |
| Security | A- | Helmet, CORS, rate limiting, JWT in HTTP-only cookie, SECRET validation |
| Testing | A- | 125 tests, in-memory mock, ~1s backend runs |
| Code Quality | A- | Modernized boilerplate, a11y fixes, bug fixes, dead code removed |
| Architecture | B | Firestore migration, lazy singleton, env-prefixed collections |
| Documentation | B+ | CLAUDE.md + 4 reference docs, proper README |
| DevOps / CI | A- | App Engine Standard, GitHub Actions CI/CD with staging auto-deploy + prod approval gate, WIF auth, npm audit, ESLint, pre-commit hooks |
| Performance | C+ | Client-side sort for Firestore constraint; no virtualization |
| Dependencies | A- | 0 vulnerabilities in both backend and frontend |

### Open Issues

- **Node.js 25+ crash** — `jsonwebtoken` chain uses removed `SlowBuffer`; no upstream fix

### Vulnerability Status

- Backend: **0 vulnerabilities** — `npm audit` enforced in CI at `moderate` level
- Frontend: **0 vulnerabilities** — `npm audit` enforced in CI at `moderate` level (Vite replaced CRA)

## Backlog

### Frontend
- Replace FontAwesome 5 packages with lighter alternative
- Add virtualization for large story lists
- Bug: hiding stories requires login — non-logged-in users lose hidden state on refresh
- Bug: hidden stories flash briefly on page refresh before being filtered out (stories render before hidden IDs are fetched)
- Bug: story timestamps show "a month ago" — API returns Firestore Timestamp objects (`{_seconds, _nanoseconds}`) instead of Date/ISO strings; dayjs can't parse them
- Bug: `authenticateToken` logs noisy stack traces for expected 401s (no cookie on `GET /me`) — should check for missing token before calling `jwt.verify()`

### Testing & Quality
- Add end-to-end tests (Playwright or Cypress)

### Documentation & Governance
- Add JSDoc to exported functions
- Add CONTRIBUTING.md
- Add LICENSE file

## Key Learnings

- **Firestore query constraint**: Can't `where()` on one field and `orderBy()` on another. For "All" timespan, use `orderBy('score').limit(500)` directly. For time-filtered, use `where('time').orderBy('time').limit(500)` then sort by score client-side. Composite indexes required for multi-inequality worker queries.
- **Firestore free tier optimization**: Spark plan allows 50K reads/20K writes per day. Key levers: `.limit()` on all queries (500 for API, 200 for worker), 1h in-memory TTL cache for story queries, 30-min worker cycle with relaxed staleness thresholds (1h/6h/48h). Removed unbounded 14d-old query.
- **In-memory MockFirestore**: `moduleNameMapper` in `jest.config.js` redirects `@google-cloud/firestore` to an in-memory mock. Storage: flat `Map<collectionPath, Map<docId, data>>`. MockTimestamp wraps Date objects on `.set()`/`.update()`. Backend tests run in ~1 second with no credentials or network.
- **Node.js 25+ incompatibility**: `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` accesses `SlowBuffer.prototype` at require time. Must mock `jsonwebtoken` in tests; use Node.js 18/20 in production.
- **Vitest mock differences**: `vi.mock()` factory must return an object with `default` key for default exports. No `__esModule: true` needed. Axios mock: `vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }))`.
- **Node.js 22 localStorage conflict**: Node.js 22's built-in `localStorage` (experimental) conflicts with jsdom in Vitest. Must stub localStorage with `vi.stubGlobal("localStorage", mockImpl)` in tests that use it.
- **Rate limiter state persists across tests** — rate-limit test must be last in its describe block.
- **`bin/www` for startup checks**: SECRET validation lives in `bin/www` (not `app.js`) so tests can `require('../../app')` without triggering exit.
- **jsdom lacks `window.matchMedia`**: Must stub in `setupTests.js` (global) for any component using `useTheme`. Tests that need specific matchMedia behavior reassign `window.matchMedia` in `beforeEach`.
- **Logging convention**: `console.error` for errors (catch blocks), `console.log` for operational info (startup, sync progress). `tests/setup.js` suppresses both globally.
- **Pre-commit hooks**: husky + lint-staged run `eslint --fix` on staged `.js` files. Backend ESLint config ignores `hackernews-frontend/`.
- **Bootstrap 5 data attributes**: Use `data-bs-toggle`/`data-bs-dismiss` (not `data-toggle`/`data-dismiss`). Class `dropdown-menu-right` was renamed to `dropdown-menu-end`.
- **`errorHandler` must not call `next()`**: Calling `next(error)` after `res.status().json()` triggers "headers already sent" errors if another error handler exists downstream.
- **Vite build output**: `build.outDir` set to `"build"` in `vite.config.js` to match Express static path in `app.js`. `build/` is gitignored.
- **App Engine `gcp-build`**: `package.json` script runs `cd hackernews-frontend && npm ci && npm run build` during deploy. App Engine runs this automatically after `npm install`.
- **App Engine Cron + `X-Appengine-Cron`**: App Engine strips the `X-Appengine-Cron` header from external requests. The `/_ah/worker` endpoint checks for this header to ensure only App Engine Cron can trigger syncs.
- **Workload Identity Federation for CI/CD**: GitHub Actions authenticates to GCP via OIDC tokens (no service account keys). Requires WIF pool + provider + attribute condition restricting to the specific repo.
- **`env_variables.yaml` for App Engine secrets**: Gitignored file included by `app.yaml`/`staging.yaml`. In CI/CD, written from `secrets.APP_SECRET` during the deploy step. Must NOT be in `.gcloudignore` (needs to be deployed).
