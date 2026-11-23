# Architecture

## System Overview

HackerNews aggregator with a single Node.js process and a SQLite database, shipped as a signed multi-arch Docker image (see [RELEASE.md](RELEASE.md)).

| Component | Runtime | Entry Point | Purpose |
|-----------|---------|-------------|---------|
| Web Server | Node.js/Express | `bin/www` → `app.js` | REST API + static frontend |
| Background Worker | Integrated (setInterval) | `worker.js:syncOnce()` | Sync stories from HN, update scores |
| Frontend | React (Vite) | `hackernews-frontend/src/index.jsx` | SPA served as static files |
| Database | SQLite (better-sqlite3) | `services/database.js` | Stories, users, hidden |

## Release & Runtime Contract

This repo knows nothing about where the app runs. A release is a signed, multi-arch image that CI publishes on every green `master` commit; hosts pull it however they like. Tags, signature verification, provenance and the runtime contract (uid 1000, read-only root, writes only to `/data` and `/tmp`, port 3000, health check, env, admin CLI, backup) are in [RELEASE.md](RELEASE.md).

```
ci.yml flow:
  workflows (actionlint)
  backend-tests (lint + jest + npm audit --omit=dev)
  frontend-tests (vitest + build + npm audit)
       ↓ all pass
  image ×2 (linux/amd64 on ubuntu-24.04, linux/arm64 on ubuntu-24.04-arm):
        PR:     build → scripts/image-smoke.sh
        master: build → push by digest (+ provenance, SBOM) → pull → scripts/image-smoke.sh
       ↓ both pass (master only)
  release: index of both digests → tags :<sha> and :latest → cosign sign (keyless) → cosign verify
```

### Local Docker Testing

```bash
# Build and run locally from source
SECRET=anysecret docker compose -f docker-compose.dev.yml up --build

# Or run the published image under the runtime contract (uid 1000, no capabilities)
# (scripts/image-smoke.sh <image> checks any image against the contract)
SECRET=anysecret docker compose up

# Test it
curl "http://localhost:3000/api/v1/stories?timespan=Day&limit=3"

# Tear down
docker compose -f docker-compose.dev.yml down
```

### Dockerfile Details

Multi-stage build:
Both stages use `node:24-alpine` pinned by digest (Dependabot proposes updates).

1. **Builder stage** (python3/make/g++ for native modules):
   - `npm pkg delete scripts.prepare` to skip husky in Docker
   - `npm ci --omit=dev` for backend deps
   - `npm ci` for frontend deps
   - Frontend build (`vite build` → `hackernews-frontend/build/`)
   - Creates an empty `/data` (the schema comes from the migrations on first start)
2. **Runtime stage** (+ wget + sqlite3):
   - Copies `node_modules`, frontend build and the empty `/data`, which belongs to `node` and the image runs as `USER node` (guarded by `tests/unit/dockerfile.test.js`)
   - Copies only the app source files needed at runtime (`bin`, `routes`, `services`, `util`, `migrations`, plus `scripts/users.js` and `scripts/migrate.js` — not all of `scripts/`, which is dev tooling; guarded by `tests/unit/dockerfile.test.js`)
   - Real data lives in a volume mounted over `/data`

## Process Diagram

```
┌──────────────┐     ┌───────────────┐     ┌──────────┐
│   Frontend   │────▶│  Express API  │────▶│  SQLite  │
│  (React SPA) │     │  /api/v1/*    │     │   (WAL)  │
└──────────────┘     └───────────────┘     └──────────┘
                            ▲                    ▲
                     ┌──────┴────────┐          │
                     │  setInterval  │          │
                     │  (15 min)     │──────────┘
                     │  syncOnce()   │──────▶ HN API
                     └───────────────┘
```

## Directory Structure

```
hackernews/
├── app.js                          # Express app (middleware, routes, static)
├── bin/www                         # HTTP server bootstrap + SECRET validation + worker init
├── worker.js                       # Background sync worker (syncOnce, 15m loop)
├── package.json                    # Backend dependencies + scripts
│
├── routes/
│   └── api.js                      # All API endpoints (/stories, /hidden, /login)
│
├── services/
│   ├── database.js                 # SQLite singleton (getDb, setDb, initSchema → runs migrations)
│   ├── migrator.js                 # Database migration runner (runMigrations, rollback, status)
│   ├── storyService.js             # Story + hidden-story queries
│   ├── userService.js              # users table: get/create/setPasswordHash/revokeSessions/list
│   ├── auth.js                     # scrypt password hashing + credential verification
│   └── hackernews.js               # HN API client + story import/update
│
├── migrations/
│   ├── 001-initial-schema.js       # Initial tables: stories, users, hidden + indexes
│   ├── 002-analyze-statistics.js   # ANALYZE — query-planner stats for per-timespan index choice
│   └── 003-local-passwords.js      # users.password_hash, token_version, created_at
│
├── util/
│   ├── config.js                   # dotenv config (limitResults)
│   ├── dbLogger.js                 # Per-request DB operation & cache analytics logging
│   └── middleware.js               # unknownEndpoint (404) + errorHandler (500)
│
├── hackernews-frontend/            # React Vite project
│   ├── package.json                # Frontend dependencies
│   ├── index.html                  # Vite entry HTML (project root, not public/)
│   ├── vite.config.js              # Vite + Vitest config
│   ├── public/                     # Static assets (copied to build/)
│   ├── build/                      # Production build output (gitignored)
│   └── src/
│       ├── index.jsx               # createRoot entry point (React 19)
│       ├── App.jsx                 # Main component: stories, auth, timespan filtering, optimistic hide, timespan persistence
│       ├── App.css                 # Styles
│       ├── hooks/
│       │   └── useTheme.js        # System dark/light mode detection (prefers-color-scheme)
│       ├── components/
│       │   ├── Story.jsx           # Single story card (favicon, title, author, score, time, hide)
│       │   └── StoryList.jsx       # Virtualized story list (react-virtuoso) with hidden filtering
│       └── services/
│           ├── storyService.js     # Axios client for /stories, /hidden
│           └── loginService.js     # Axios client for /login, /logout, /me
│
├── tests/                          # Backend test suites
│   ├── setup.js                    # Console suppression + in-memory SQLite setup
│   ├── unit/                       # Pure unit tests
│   └── integration/                # Tests with in-memory SQLite + supertest
│
├── scripts/                        # Utility scripts
│   ├── migrate.js                  # CLI: node scripts/migrate.js [up|rollback|status]
│   ├── users.js                    # CLI: node scripts/users.js [list|add|set-password|revoke-sessions]
│   ├── cloud-setup.sh              # SessionStart hook: Node 24 + npm ci in Claude Code cloud sessions only
│   ├── image-smoke.sh              # Check an image against the runtime contract (CI runs it on every build)
│   ├── preview.sh                  # Run the app on a seeded throwaway DB and screenshot it, then clean up
│   ├── seed-preview.js             # Seeds preview.sh's throwaway DB (sample stories + test account)
│   └── screenshot.sh / screenshot.js # Headless-Chrome screenshot over the DevTools protocol
│
├── docs/                           # LLM-geared documentation
│
├── Dockerfile                     # Multi-stage Docker build (node:24-alpine, bakes data into image)
├── docker-compose.yml             # Local only: the CI image under the runtime contract
├── docker-compose.dev.yml         # Local dev: builds from source, app on port 3000
├── .dockerignore                  # Files excluded from Docker build
├── .github/workflows/ci.yml      # CI: actionlint, tests, multi-arch image build + contract smoke test, signed release to GHCR
├── .github/dependabot.yml        # Weekly updates for action SHAs and the base-image digest
├── .husky/pre-commit              # Pre-commit hook (lint-staged → ESLint)
├── eslint.config.js               # ESLint flat config (backend)
├── CLAUDE.md                       # Governance document + Definition of Done
└── jest.config.js                  # Backend Jest configuration
```

## Data Flow

### Story Fetch (Frontend → Backend → SQLite)
1. Frontend waits for `GET /api/v1/me` to settle, then calls `GET /api/v1/stories?timespan=Day`
2. `routes/api.js` parses timespan, limit, skip
3. `storyService.getStories()` runs SQL against SQLite with forced `INDEXED BY` hints (see DATABASE.md)
4. SQL query handles everything in one step: time filter + hidden exclusion + score sort + pagination
5. If authenticated, hidden story IDs are excluded via `WHERE id NOT IN (...)` in the SQL query
6. Response: JSON array of stories

### Background Worker (setInterval → HN API → SQLite)
1. `bin/www:onListening()` runs initial `syncOnce()` and sets `setInterval` for 15-minute recurring sync
2. `syncOnce()` from `worker.js`:
   - Fetch ~1200 unique story IDs from HN API (`newstories` + `topstories` + `beststories`)
   - Check which IDs are missing from SQLite via `checkStoryExists()`
   - Add missing stories via `INSERT OR REPLACE`
   - Update scores for stale stories, tiered by age: 1h/6h/48h, batch limit 500
   - Run `ANALYZE` to refresh query-planner statistics (keeps per-timespan index choice correct as the table grows; see DATABASE.md)
3. All writes happen in SQLite transactions for performance
4. Graceful shutdown: SIGTERM/SIGINT clear worker interval, close server and DB

### Static File Serving
Express serves the Vite build output from `hackernews-frontend/build/` with a two-tier caching strategy:
- **`/assets/*`** (hashed filenames): `Cache-Control: public, max-age=31536000, immutable`
- **`index.html`**: `Cache-Control: no-cache`

### Authentication (Frontend → Backend → JWT Cookie)
1. Frontend POSTs `{ username, password }` to `/api/v1/login` (rate limited per client IP)
2. `auth.verifyCredentials()` looks up the user and checks the password against its scrypt hash; unknown users and users without a password are hashed against a dummy so timing is uniform
3. Success → issue JWT `{ username, tv: token_version }` (365d expiry) as HTTP-only cookie; failure → `401`. Login never creates users — accounts come only from `scripts/users.js`
4. Cookie (`token`) sent automatically with all `/api` requests (httpOnly, secure in prod, sameSite=strict)
5. On page load, frontend calls `GET /me` before fetching stories to check login state — this also refreshes the JWT+cookie (rolling expiry)
6. Protected routes (`/hidden`, `/me`) and the optional auth on `/stories` verify the JWT, then require the user row to exist with `token_version` equal to the token's `tv` (missing `tv` = 0, for pre-migration cookies)
7. Logout: `POST /logout` clears this browser's cookie only; other browsers stay logged in. `scripts/users.js revoke-sessions` bumps `token_version` to log out every browser

Each `/login` response includes `X-Login-Request-Id` for browser-to-server log correlation. Login outcomes are logged as `[login] requestId=… outcome=…` lines, intentionally omitting passwords, tokens, and usernames.

**History (2026-09):** login used to be proxied to `news.ycombinator.com/login`. HN began answering logins from a datacenter IP with a "Validation required" reCAPTCHA page, which the proxy misread as invalid credentials, so every login failed. Local accounts replaced it; usernames (and therefore every hidden story) carried over unchanged.

## Environment Variables

### Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | No | `"production"` for production, `"ci"` for CI tests |
| `SECRET` | Yes | JWT signing secret. Validated on startup in `bin/www` — server exits if missing |
| `PORT` | No | HTTP listen port (default: 3000) |
| `SQLITE_PATH` | No | Path to SQLite database file (default: `./data/hackernews.db`) |
| `DISABLE_WORKER` | No | `true` skips the background HN sync in `bin/www` (used by `scripts/preview.sh`; never set in production) |

### Config Constants (`util/config.js`)

| Constant | Value | Description |
|----------|-------|-------------|
| `limitResults` | 500 | Max stories per API response |

### Frontend (`hackernews-frontend/src/services/`)

The frontend uses relative URLs (`/api/v1/`) for all API calls. In development, Vite's proxy (`vite.config.js`) forwards `/api` requests to the backend on port 3001.
