# Architecture

## System Overview

HackerNews aggregator with three runtime processes and a Firestore database.

| Component | Runtime | Entry Point | Purpose |
|-----------|---------|-------------|---------|
| Web Server | Node.js/Express | `bin/www` → `app.js` | REST API + static frontend |
| Background Worker | Node.js | `worker.js` | Sync stories from HN, update scores |
| Frontend | React (CRA) | `hackernews-frontend/src/index.js` | SPA served as static files |
| Database | Google Cloud Firestore | — | Stories, users (project: `melisma-essentials`, db: `hackernews`) |

## Process Diagram

```
┌──────────────┐     ┌───────────────┐     ┌───────────┐
│   Frontend   │────▶│  Express API  │────▶│ Firestore │
│  (React SPA) │     │  /api/v1/*    │     │           │
└──────────────┘     └───────────────┘     └───────────┘
                                                 ▲
                     ┌───────────────┐           │
                     │    Worker     │───────────┘
                     │  (throng)     │──────▶ HN API + hntoplinks
                     └───────────────┘
```

## Directory Structure

```
hackernews/
├── app.js                          # Express app (middleware, routes, static)
├── bin/www                         # HTTP server bootstrap
├── worker.js                       # Background sync worker (throng, 10m loop)
├── package.json                    # Backend dependencies + scripts
│
├── routes/
│   └── api.js                      # All API endpoints (/get, /hidden, /login)
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
├── hackernews-frontend/            # React CRA project
│   ├── package.json                # Frontend dependencies
│   ├── public/                     # Static assets
│   ├── build/                      # Production build output
│   └── src/
│       ├── index.js                # ReactDOM.render entry point (React 16 API)
│       ├── App.js                  # Main component: stories, auth, timespan filtering
│       ├── App.css                 # Styles
│       ├── components/
│       │   ├── Story.js            # Single story card (favicon, title, author, score, time, hide)
│       │   └── StoryList.js        # Story list with hidden filtering
│       ├── services/
│       │   ├── storyService.js     # Axios client for /get, /hidden
│       │   └── loginService.js     # Axios client for /login
│       └── serviceWorker.js        # CRA service worker (unregistered)
│
├── scripts/
│   └── migrate-to-firestore.js     # One-time MongoDB → Firestore migration
│
├── tests/                          # Backend test suites
│   ├── setup.js                    # Firestore connection + cleanup helpers
│   ├── unit/                       # Pure unit tests
│   └── integration/                # Tests with real Firestore + supertest
│
├── docs/                           # LLM-geared documentation
│
├── .github/workflows/ci.yml       # GitHub Actions CI pipeline
├── CLAUDE.md                       # Governance document + Definition of Done
└── jest.config.js                  # Backend Jest configuration
```

## Data Flow

### Story Fetch (Frontend → Backend → Firestore)
1. Frontend calls `GET /api/v1/get?timespan=Day`
2. `routes/api.js` parses timespan, limit, skip
3. `storyService.getStories()` queries Firestore with time filter, sorts client-side by score
4. Response: JSON array of stories

### Background Worker (Worker → HN API → Firestore)
1. `throng(1, main)` starts single worker process
2. Infinite loop every 10 minutes:
   - Fetch new story IDs from HN Firebase API
   - Add missing stories to Firestore (doc ID = zero-padded HN ID)
   - Update scores for stale stories (tiered by age: 15m/1h/24h/14d)
3. No pruning — Firestore free tier (1GB) handles ~27 years of growth at ~37MB/year

### Authentication (Frontend → HN → Backend → JWT)
1. Frontend POSTs credentials to `/api/v1/login`
2. Backend proxies login to `news.ycombinator.com/login`
3. If HN redirects to `/news` → success → issue JWT + upsert user
4. JWT stored in localStorage, sent as `Authorization: bearer <token>`
5. Protected routes (`/hidden`) verify JWT and extract username
