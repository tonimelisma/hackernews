# Architecture

## System Overview

HackerNews aggregator with a single Node.js process and a SQLite database, deployed via Docker behind the host-level shared Caddy reverse proxy.

| Component | Runtime | Entry Point | Purpose |
|-----------|---------|-------------|---------|
| Web Server | Node.js/Express | `bin/www` → `app.js` | REST API + static frontend |
| Background Worker | Integrated (setInterval) | `worker.js:syncOnce()` | Sync stories from HN, update scores |
| Frontend | React (Vite) | `hackernews-frontend/src/index.jsx` | SPA served as static files |
| Database | SQLite (better-sqlite3) | `services/database.js` | Stories, users, hidden |

## Deployment & Operations

### Infrastructure

| What | Details |
|------|---------|
| **VPS** | GCP e2-micro (0.25 vCPU, 1GB RAM, 30GB disk), Ubuntu 24.04 |
| **Instance** | `vps-1`, zone `us-central1-a`, project `melisma-services` |
| **Internal hostname** | `vps-1.us-central1-a.c.melisma-services.internal` |
| **External IP** | `34.45.72.52` (static) |
| **Domain** | `hackernews.melisma.net` (Cloudflare DNS, A record, DNS-only/gray cloud) |
| **Docker** | Docker 29.4 + Compose 5.1 |
| **App path on VPS** | `/opt/hackernews` |
| **Shared reverse proxy path** | `/opt/reverse-proxy` (`caddy` container, shared by all public services on the host) |
| **Shared Docker network** | `reverse_proxy` (external Docker bridge network) |
| **Secrets on VPS** | `/opt/hackernews/.env` (contains `SECRET=...`) |
| **Backup bucket** | `gs://hackernews-melisma-backup/` (us-central1, Always Free tier) |
| **Backup cron** | `0 3 * * *` — daily at 3:00 AM UTC |

### SSH into VPS

```bash
# Interactive shell
gcloud compute ssh vps-1 --zone=us-central1-a

# Run a single command
gcloud compute ssh vps-1 --zone=us-central1-a --command="<cmd>"

# Copy files to VPS
gcloud compute scp <local-path> vps-1:<remote-path> --zone=us-central1-a
```

### Docker Commands (run on VPS)

```bash
cd /opt/hackernews

# HackerNews app status
docker compose ps

# App logs (live tail)
docker compose logs -f app

# App logs (last 100 lines)
docker compose logs --tail 100 app

# Restart app (no rebuild)
docker compose restart app

# Rebuild and redeploy app
docker compose up --build -d

# Stop HackerNews app
docker compose down

# Shell into running app container
docker exec -it hackernews-app-1 sh

# Run a command inside the app container
docker exec hackernews-app-1 <cmd>
```

### Shared Reverse Proxy Commands (run on VPS)

```bash
cd /opt/reverse-proxy

# Reverse proxy status
docker compose ps

# Caddy logs
docker compose logs --tail 50 caddy

# Reload Caddy config after editing Caddyfile
docker compose restart caddy
```

The Caddy container is named `caddy`, not `hackernews-caddy-1`. It owns host ports 80/443 and routes public hostnames to containers on the external `reverse_proxy` Docker network.

### Remote Debugging

```bash
# Test API from inside container (bypasses Caddy)
gcloud compute ssh vps-1 --zone=us-central1-a --command="docker exec hackernews-app-1 wget -qO- 'http://localhost:3000/api/v1/stories?timespan=Day&limit=1'"

# Test API via public HTTPS
curl -s "https://hackernews.melisma.net/api/v1/stories?timespan=Day&limit=1"

# Check container health status
gcloud compute ssh vps-1 --zone=us-central1-a --command="docker inspect --format='{{.State.Health.Status}}' hackernews-app-1"

# Check worker sync logs (last sync cycle)
gcloud compute ssh vps-1 --zone=us-central1-a --command="cd /opt/hackernews && docker compose logs app 2>&1 | grep -E '(sync|WORKER|fetched|adding)' | tail -20"

# Check memory usage
gcloud compute ssh vps-1 --zone=us-central1-a --command="docker stats --no-stream"

# Check disk usage
gcloud compute ssh vps-1 --zone=us-central1-a --command="df -h / && du -sh /opt/hackernews"

# Query SQLite directly inside container
gcloud compute ssh vps-1 --zone=us-central1-a --command="docker exec hackernews-app-1 sqlite3 /data/hackernews.db 'SELECT COUNT(*) FROM stories;'"

# Check SQLite DB size
gcloud compute ssh vps-1 --zone=us-central1-a --command="docker exec hackernews-app-1 ls -lh /data/hackernews.db"
```

### CI/CD Pipeline

Push to `master` triggers: **backend tests → frontend tests → SSH deploy → health check → auto-rollback on failure**.

```
ci.yml flow:
  backend-tests (lint + jest + npm audit --omit=dev)
  frontend-tests (vitest + build + npm audit)
       ↓ both pass
  deploy (only on push to master, not PRs)
       ↓
  SSH into VPS → git pull → docker compose up --build -d
       ↓
  Poll health check for 90s
       ↓
  ✓ healthy → done
  ✗ unhealthy → rollback to previous Docker image, exit 1
```

**GitHub secrets** (repo-level, not environment):
- `VPS_USER` — SSH username (`tonimelisma`)
- `VPS_SSH_KEY` — ed25519 private key (public key in `~/.ssh/authorized_keys` on VPS)

### Manual Deploy (bypassing CI)

```bash
gcloud compute ssh vps-1 --zone=us-central1-a --command="cd /opt/hackernews && git pull origin master && docker compose up --build -d"
```

### Local Docker Testing

```bash
# Build and run locally (no Caddy, just app on port 3000)
SECRET=anysecret docker compose -f docker-compose.dev.yml up --build

# Test it
curl "http://localhost:3000/api/v1/stories?timespan=Day&limit=3"
open http://localhost:3000

# Tear down
docker compose -f docker-compose.dev.yml down
```

### Dockerfile Details

Multi-stage build:
1. **Builder stage** (node:20-alpine + python3/make/g++ for native modules):
   - `npm pkg delete scripts.prepare` to skip husky in Docker
   - `npm ci --omit=dev` for backend deps
   - `npm ci` for frontend deps
   - Frontend build (`vite build` → `hackernews-frontend/build/`)
   - Import JSON data into SQLite (`/data/hackernews.db`)
2. **Runtime stage** (node:20-alpine + wget + sqlite3):
   - Copies `node_modules`, frontend build, baked SQLite DB
   - Copies only the app source files needed at runtime
   - ~160 MB final image

### Backups

```bash
# Manual backup
gcloud compute ssh vps-1 --zone=us-central1-a --command="bash /opt/hackernews/scripts/backup-sqlite.sh"

# List backups
gcloud storage ls -l gs://hackernews-melisma-backup/

# Download a backup
gcloud storage cp gs://hackernews-melisma-backup/hackernews-20260220.db.gz .

# Restore a backup
gunzip hackernews-20260220.db.gz
gcloud compute scp hackernews-20260220.db vps-1:/tmp/restore.db --zone=us-central1-a
gcloud compute ssh vps-1 --zone=us-central1-a --command="docker compose -f /opt/hackernews/docker-compose.yml cp /tmp/restore.db app:/data/hackernews.db && cd /opt/hackernews && docker compose restart app"

# Check cron is installed
gcloud compute ssh vps-1 --zone=us-central1-a --command="crontab -l"

# Check backup logs
gcloud compute ssh vps-1 --zone=us-central1-a --command="tail -20 /var/log/hackernews-backup.log"
```

Backup process: `sqlite3 .backup` inside container → `docker cp` out → `gzip` → `gcloud storage cp` to GCS. 30-day retention, ~3.3 MB per backup.

### GCP Firewall Rules

```bash
# List rules
gcloud compute firewall-rules list

# Required rules (already created):
# allow-http  — tcp:80  from 0.0.0.0/0
# allow-https — tcp:443 from 0.0.0.0/0
# allow-ssh   — tcp:22  from 0.0.0.0/0
```

### DNS (Cloudflare)

- Record: `hackernews` A `34.45.72.52`
- Proxy: **DNS-only** (gray cloud) — Caddy handles TLS via Let's Encrypt
- If you switch to orange cloud (Cloudflare proxy), Caddy's ACME challenge will fail

### Shared Caddy Reverse Proxy

Caddy runs from `/opt/reverse-proxy` as the `caddy` container and is shared by all public services on the VPS. Its `Caddyfile` currently includes:

```caddy
hackernews.melisma.net {
	reverse_proxy hackernews-app:3000
}

koskiset-api.melisma.net {
	reverse_proxy koskiset-feedback:8080
}
```

The reverse proxy uses the external Docker network `reverse_proxy`. HackerNews joins that network with the alias `hackernews-app`; unrelated services should join the same network with service-specific aliases.

Caddy auto-provisions Let's Encrypt certs. Cert data is stored in the Docker volume originally named `hackernews_caddy-data`, reused by the shared proxy to avoid certificate churn.

```bash
# Check Caddy logs for cert issues
gcloud compute ssh vps-1 --zone=us-central1-a --command="cd /opt/reverse-proxy && docker compose logs caddy | tail -20"

# Force cert renewal (rarely needed)
gcloud compute ssh vps-1 --zone=us-central1-a --command="cd /opt/reverse-proxy && docker compose restart caddy"
```

### VPS Service Account Scopes

The VM service account has `storage-rw`, `logging-write`, `monitoring-write`. If you need to change scopes, the VM must be stopped first:

```bash
gcloud compute instances stop vps-1 --zone=us-central1-a
gcloud compute instances set-service-account vps-1 --zone=us-central1-a --scopes=storage-rw,logging-write,monitoring-write
gcloud compute instances start vps-1 --zone=us-central1-a
# Docker containers auto-restart (restart: unless-stopped)
```

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
│   ├── storyService.js             # Story/user CRUD (SQL queries)
│   └── hackernews.js               # HN API client + story import/update
│
├── migrations/
│   └── 001-initial-schema.js       # Initial tables: stories, users, hidden + indexes
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
│   ├── data/                       # Exported JSON data (gitignored)
│   ├── import-json-to-sqlite.js    # Import JSON stories/users/hidden → SQLite
│   ├── migrate.js                  # CLI: node scripts/migrate.js [up|rollback|status]
│   └── backup-sqlite.sh            # Daily SQLite backup to GCS
│
├── docs/                           # LLM-geared documentation
│
├── Dockerfile                     # Multi-stage Docker build (node:20-alpine, bakes data into image)
├── docker-compose.yml             # Production: App service, SQLite volume, external reverse_proxy network
├── docker-compose.dev.yml         # Local dev: App only on port 3000, no Caddy
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
3. If HN response body does NOT contain "Bad login" → success → issue JWT (365d expiry) as HTTP-only cookie + upsert user
4. Cookie (`token`) sent automatically with all `/api` requests (httpOnly, secure in prod, sameSite=strict)
5. On page load, frontend calls `GET /me` to check login state — this also refreshes the JWT+cookie (rolling expiry)
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
