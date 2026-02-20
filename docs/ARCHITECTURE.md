# Architecture

## System Overview

HackerNews aggregator with a single Node.js process and a SQLite database, deployed via Docker.

| Component | Runtime | Entry Point | Purpose |
|-----------|---------|-------------|---------|
| Web Server | Node.js/Express | `bin/www` → `app.js` | REST API + static frontend |
| Background Worker | Integrated (setInterval) | `worker.js:syncOnce()` | Sync stories from HN, update scores |
| Frontend | React (Vite) | `hackernews-frontend/src/index.jsx` | SPA served as static files |
| Database | SQLite (better-sqlite3) | `services/database.js` | Stories, users, hidden |

## Deployment

Hosted on a **GCP e2-micro** VPS (0.25 vCPU, 1GB RAM, 30GB disk) running Docker.

| Component | Config | URL |
|-----------|--------|-----|
| App | `docker-compose.yml` | Behind Caddy reverse proxy |
| Caddy | `Caddyfile` | `hackernews.melisma.net` (auto HTTPS) |
| CI/CD | `.github/workflows/ci.yml` | SSH deploy on push to master |

- **Worker**: Integrated into the Express process via `setInterval` (15-minute cycle), started in `bin/www:onListening()`
- **CI/CD**: GitHub Actions runs tests, then deploys via SSH + `docker compose up --build -d`

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
│   ├── database.js                 # SQLite singleton (getDb, setDb, initSchema)
│   ├── storyService.js             # Story/user CRUD (SQL queries)
│   └── hackernews.js               # HN API client + story import/update
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
│       ├── App.jsx                 # Main component: stories, auth, timespan filtering, localStorage hidden
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
├── scripts/                        # Migration/utility scripts
│   ├── data/                       # Exported JSON data (gitignored)
│   ├── import-json-to-sqlite.js    # Import JSON stories/users/hidden → SQLite
│   └── backup-sqlite.sh            # Daily SQLite backup to GCS
│
├── docs/                           # LLM-geared documentation
│
├── Dockerfile                     # Multi-stage Docker build (node:20-alpine, bakes data into image)
├── docker-compose.yml             # Production: App + Caddy services, SQLite volume, health check
├── docker-compose.dev.yml         # Local dev: App only on port 3000, no Caddy
├── Caddyfile                      # Reverse proxy config (auto HTTPS)
├── .dockerignore                  # Files excluded from Docker build
├── .github/workflows/ci.yml      # GitHub Actions CI + SSH deploy pipeline
├── .husky/pre-commit              # Pre-commit hook (lint-staged → ESLint)
├── eslint.config.js               # ESLint flat config (backend)
├── CLAUDE.md                       # Governance document + Definition of Done
└── jest.config.js                  # Backend Jest configuration
```

## Data Flow

### Story Fetch (Frontend → Backend → SQLite)
1. Frontend calls `GET /api/v1/stories?timespan=Day`
2. `routes/api.js` parses timespan, limit, skip
3. `storyService.getStories()` checks L1 in-memory cache (1-minute TTL):
   - **L1 hit**: Return cached stories immediately
   - **L1 miss**: Run SQL query against SQLite, cache result in L1
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
3. All writes happen in SQLite transactions for performance
4. Graceful shutdown: SIGTERM/SIGINT clear worker interval, close server and DB

### Static File Serving
Express serves the Vite build output from `hackernews-frontend/build/` with a two-tier caching strategy:
- **`/assets/*`** (hashed filenames): `Cache-Control: public, max-age=31536000, immutable`
- **`index.html`**: `Cache-Control: no-cache`

### Authentication (Frontend → HN → Backend → JWT Cookie)
1. Frontend POSTs credentials to `/api/v1/login`
2. Backend proxies login to `news.ycombinator.com/login` (axios follows redirects)
3. If HN response body does NOT contain "Bad login" → success → issue JWT (24h expiry) as HTTP-only cookie + upsert user
4. Cookie (`token`) sent automatically with all `/api` requests (httpOnly, secure in prod, sameSite=strict)
5. On page load, frontend calls `GET /me` to check login state
6. Protected routes (`/hidden`, `/me`) verify JWT via `authenticateToken` middleware and extract username
7. Logout: `POST /logout` clears the cookie

## Environment Variables

### Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | No | `"production"` for production, `"ci"` for CI tests |
| `SECRET` | Yes | JWT signing secret. Validated on startup in `bin/www` — server exits if missing |
| `PORT` | No | HTTP listen port (default: 3000) |
| `SQLITE_PATH` | No | Path to SQLite database file (default: `./data/hackernews.db`) |

### Config Constants (`util/config.js`)

| Constant | Value | Description |
|----------|-------|-------------|
| `limitResults` | 500 | Max stories per API response |

### Frontend (`hackernews-frontend/src/services/`)

The frontend uses relative URLs (`/api/v1/`) for all API calls. In development, Vite's proxy (`vite.config.js`) forwards `/api` requests to the backend on port 3001.
