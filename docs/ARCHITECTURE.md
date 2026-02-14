# Architecture

## System Overview

HackerNews aggregator with three runtime processes and a Firestore database.

| Component | Runtime | Entry Point | Purpose |
|-----------|---------|-------------|---------|
| Web Server | Node.js/Express | `bin/www` → `app.js` | REST API + static frontend |
| Background Worker | Node.js | `worker.js` | Sync stories from HN, update scores |
| Frontend | React (Vite) | `hackernews-frontend/src/index.jsx` | SPA served as static files |
| Database | Google Cloud Firestore | — | Stories, users (project: `melisma-hackernews`, default db) |

## Deployment

Hosted on **Google App Engine Standard** (project: `melisma-hackernews`, region: `europe-west1`).

| Service | Config | URL |
|---------|--------|-----|
| Production (default) | `app.yaml` | `melisma-hackernews.appspot.com` |
| Staging | `staging.yaml` | `staging-dot-melisma-hackernews.appspot.com` |

- **Cron**: `cron.yaml` fires `GET /_ah/worker` every 15 minutes on the default (production) service
- **Staging bootstrap**: `BOOTSTRAP_ON_START=true` triggers a one-time sync on startup (no cron worker in staging)
- **CI/CD**: GitHub Actions deploys to staging on push to master, then to production after manual approval. CI service account needs `roles/cloudscheduler.admin` for `cron.yaml` deployment
- **Bootstrap**: App Engine requires the `default` service to exist before deploying named services (like `staging`). For new projects, run `gcloud app deploy app.yaml cron.yaml --project melisma-hackernews` once manually before CI can deploy staging

## Process Diagram

```
┌──────────────┐     ┌───────────────┐     ┌───────────┐
│   Frontend   │────▶│  Express API  │────▶│ Firestore │
│  (React SPA) │     │  /api/v1/*    │     │           │
└──────────────┘     └───────────────┘     └───────────┘
                            ▲                     ▲
                     ┌──────┴────────┐           │
                     │ App Engine    │           │
                     │ Cron → /_ah/  │───────────┘
                     │   worker      │──────▶ HN API + hntoplinks
                     └───────────────┘
```

## Directory Structure

```
hackernews/
├── app.js                          # Express app (middleware, routes, static)
├── bin/www                         # HTTP server bootstrap + SECRET validation
├── worker.js                       # Background sync worker (throng, 30m loop)
├── package.json                    # Backend dependencies + scripts
│
├── routes/
│   └── api.js                      # All API endpoints (/stories, /hidden, /login)
│
├── services/
│   ├── firestore.js                # Firestore client singleton, collection refs, padId()
│   ├── storyService.js             # Firestore CRUD (stories, users/hidden subcollection)
│   └── hackernews.js               # HN Firebase API + hntoplinks scraper
│
├── util/
│   ├── config.js                   # dotenv config (limitResults)
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
│       ├── App.jsx                 # Main component: stories, auth, timespan filtering
│       ├── App.css                 # Styles
│       ├── hooks/
│       │   └── useTheme.js        # System dark/light mode detection (prefers-color-scheme)
│       ├── components/
│       │   ├── Story.jsx           # Single story card (favicon, title, author, score, time, hide)
│       │   └── StoryList.jsx       # Story list with hidden filtering
│       └── services/
│           ├── storyService.js     # Axios client for /stories, /hidden
│           └── loginService.js     # Axios client for /login, /logout, /me
│
├── tests/                          # Backend test suites
│   ├── setup.js                    # Console suppression + MockFirestore cleanup helpers
│   ├── mocks/
│   │   ├── firestore-mock.js       # In-memory Firestore implementation
│   │   └── firestore-sdk-shim.js   # 2-line shim for moduleNameMapper
│   ├── unit/                       # Pure unit tests
│   └── integration/                # Tests with MockFirestore + supertest
│       └── firestore-smoke.test.js # Standalone smoke tests against real Firestore (not Jest)
│
├── scripts/                        # Migration scripts (data export/import/audit)
│   ├── data/                       # Exported JSON data (gitignored)
│   ├── import-to-firestore.js      # Import JSON → Firestore (--dry-run, --limit, --max-writes)
│   ├── audit-firestore.js          # Read-only audit of cloud Firestore data
│   └── export-from-mongodb.js      # Export MongoDB → local JSON
│
├── docs/                           # LLM-geared documentation
│
├── app.yaml                       # App Engine production config (default service)
├── staging.yaml                   # App Engine staging config (staging service)
├── cron.yaml                      # App Engine cron (15-min worker sync)
├── env_variables.yaml             # App Engine secrets (gitignored)
├── .gcloudignore                  # Files excluded from App Engine deploy
├── .github/workflows/ci.yml      # GitHub Actions CI + deploy pipeline
├── .husky/pre-commit              # Pre-commit hook (lint-staged → ESLint)
├── eslint.config.js               # ESLint flat config (backend)
├── CLAUDE.md                       # Governance document + Definition of Done
└── jest.config.js                  # Backend Jest configuration
```

## Data Flow

### Story Fetch (Frontend → Backend → Firestore)
1. Frontend calls `GET /api/v1/stories?timespan=Day`
2. `routes/api.js` parses timespan, limit, skip
3. `storyService.getStories()` checks 1h TTL cache; on miss, queries Firestore (limit 500), sorts by score
4. Response: JSON array of stories

### Background Worker (Cron → Express → HN API → Firestore)
1. App Engine Cron fires `GET /_ah/worker` every 15 minutes (production only)
2. Endpoint validates `X-Appengine-Cron: true` header (App Engine strips from external requests)
3. Calls `syncOnce()` from `worker.js`:
   - Fetch new story IDs from HN Firebase API
   - Add missing stories to Firestore (doc ID = zero-padded HN ID)
   - Update scores for stale stories (tiered by age: 1h/6h/48h, batch limit 200)
4. No pruning — Firestore free tier (1GB) handles ~27 years of growth at ~37MB/year
5. For staging: `BOOTSTRAP_ON_START=true` runs a one-time sync on server startup (no cron)

### Static File Serving
Express serves the Vite build output from `hackernews-frontend/build/` with a two-tier caching strategy:
- **`/assets/*`** (hashed filenames): `Cache-Control: public, max-age=31536000, immutable` — safe to cache forever since filenames change on content change
- **`index.html`**: `Cache-Control: no-cache` — forces browser to revalidate on every visit. Required because App Engine sets all deployed file mtimes to `1980-01-01`, making Express ETags size-only (stale across deploys if file size doesn't change)

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
| `NODE_ENV` | No | `"production"` → `prod-`, `"staging"` → `staging-`, `"ci"` → `ci-`, anything else → `dev-` |
| `SECRET` | Yes | JWT signing secret. Validated on startup in `bin/www` — server exits if missing |
| `PORT` | No | HTTP listen port (default: 3000, set by App Engine in cloud) |
| `BOOTSTRAP_ON_START` | No | `"true"` runs `syncOnce()` on server startup (used in staging) |

### Firestore Authentication

| Environment | Auth Method |
|---|---|
| Local dev | Application Default Credentials via `gcloud auth application-default login` |
| App Engine (staging/prod) | Automatic via App Engine default service account |

### Config Constants (`util/config.js`)

| Constant | Value | Description |
|----------|-------|-------------|
| `limitResults` | 500 | Max stories per API response |

### Frontend (`hackernews-frontend/src/services/`)

The frontend uses relative URLs (`/api/v1/`) for all API calls. In development, Vite's proxy (`vite.config.js`) forwards `/api` requests to the backend on port 3001.
