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
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a

# Run a single command
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="<cmd>"

# Copy files to VPS
gcloud compute scp --project=melisma-services <local-path> vps-1:<remote-path> --zone=us-central1-a
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

# Redeploy the CI-built image (never build on the VPS)
IMAGE_TAG=<commit-sha> docker compose pull app   # private package: docker login ghcr.io first
IMAGE_TAG=<commit-sha> docker compose up -d

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

# Reload Caddy config after editing Caddyfile (no restart)
docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

The Caddy container is named `caddy`, not `hackernews-caddy-1`. It owns host ports 80/443 and routes public hostnames to containers on the external `reverse_proxy` Docker network.

### Remote Debugging

```bash
# Test API from inside container (bypasses Caddy)
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="docker exec hackernews-app-1 wget -qO- 'http://localhost:3000/api/v1/stories?timespan=Day&limit=1'"

# Test API via public HTTPS
curl -s "https://hackernews.melisma.net/api/v1/stories?timespan=Day&limit=1"

# Check container health status
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="docker inspect --format='{{.State.Health.Status}}' hackernews-app-1"

# Check worker sync logs (last sync cycle)
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="cd /opt/hackernews && docker compose logs app 2>&1 | grep -E '(sync|WORKER|fetched|adding)' | tail -20"

# Check memory usage
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="docker stats --no-stream"

# Check disk usage
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="df -h / && du -sh /opt/hackernews"

# Query SQLite directly inside container
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="docker exec hackernews-app-1 sqlite3 /data/hackernews.db 'SELECT COUNT(*) FROM stories;'"

# Check SQLite DB size
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="docker exec hackernews-app-1 ls -lh /data/hackernews.db"
```

### CI/CD Pipeline

Push to `master` triggers: **backend tests → frontend tests → image build in CI → SSH deploy (pull only) → health check → auto-rollback on failure**. The repo is public, so standard GitHub-hosted runner minutes are free.

```
ci.yml flow:
  backend-tests (lint + jest + npm audit --omit=dev)
  frontend-tests (vitest + build + npm audit)
       ↓ both pass
  image (only on push to master): buildx linux/amd64 → push
        ghcr.io/tonimelisma/hackernews:<sha> and :latest (GHA layer cache)
       ↓
  deploy (concurrency: production-deploy)
       ↓
  SSH into VPS → git pull → docker login ghcr.io (job token) →
  IMAGE_TAG=<sha> docker compose pull → docker logout → docker compose up -d
       ↓
  Poll health check for 90s
       ↓
  ✓ healthy → prune unused images older than 7 days → done
  ✗ unhealthy → re-tag the previously running image as :rollback, start it, exit 1
```

**Nothing is built on the VPS.** On 2026-09-29 an on-box build (the old `docker compose up --build` deploy) saturated the 30 GB `pd-standard` disk (94% util, 81 ms await, 88% iowait), slowed requests to ~14 s, and then died with its SSH session when the action's 10m timeout ended it — leaving the old container running. The GHCR package is private (GitHub's default); the deploy job passes its own short-lived `GITHUB_TOKEN` (`packages: read`) to the VPS for the pull and logs out afterwards, so no long-lived registry credential lives on the box. `docker-compose.yml` has no `build:` (guarded by `tests/unit/compose.test.js`); `docker-compose.dev.yml` still builds locally.

**GitHub secrets** (repo-level, not environment):
- `VPS_USER` — SSH username (`tonimelisma`)
- `VPS_SSH_KEY` — ed25519 private key (public key in `~/.ssh/authorized_keys` on VPS)

### Manual Deploy (bypassing CI)

```bash
# Re-run the CI deploy for an existing commit instead (GitHub → Actions → CI → Re-run),
# or pull a pushed image by hand (needs a token with read:packages):
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --ssh-flag=-t --command="cd /opt/hackernews && git pull --ff-only origin master && docker login ghcr.io && IMAGE_TAG=<sha> docker compose pull app && docker logout ghcr.io && IMAGE_TAG=<sha> docker compose up -d"
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
1. **Builder stage** (node:24-alpine + python3/make/g++ for native modules):
   - `npm pkg delete scripts.prepare` to skip husky in Docker
   - `npm ci --omit=dev` for backend deps
   - `npm ci` for frontend deps
   - Frontend build (`vite build` → `hackernews-frontend/build/`)
   - Import JSON data into SQLite (`/data/hackernews.db`)
2. **Runtime stage** (node:24-alpine + wget + sqlite3):
   - Copies `node_modules`, frontend build, baked SQLite DB
   - Copies only the app source files needed at runtime (`bin`, `routes`, `services`, `util`, `migrations`, plus `scripts/users.js` and `scripts/migrate.js` — not all of `scripts/`, which would ship local `scripts/data/` exports; guarded by `tests/unit/dockerfile.test.js`)
   - Built by CI, not on the VPS. CI checkouts have no `scripts/data/*.json`, so the baked DB is empty; production data lives in the `sqlite-data` volume mounted over `/data`
   - ~160 MB final image

### Backups

```bash
# Manual backup
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="bash /opt/hackernews/scripts/backup-sqlite.sh"

# List backups
gcloud storage ls -l gs://hackernews-melisma-backup/

# Download a backup
gcloud storage cp gs://hackernews-melisma-backup/hackernews-20260220.db.gz .

# Restore a backup
gunzip hackernews-20260220.db.gz
gcloud compute scp --project=melisma-services hackernews-20260220.db vps-1:/tmp/restore.db --zone=us-central1-a
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="docker compose -f /opt/hackernews/docker-compose.yml cp /tmp/restore.db app:/data/hackernews.db && cd /opt/hackernews && docker compose restart app"

# Check cron is installed
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="crontab -l"

# Check backup logs
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="tail -20 /var/log/hackernews-backup.log"
```

Backup process: `sqlite3 .backup` inside container → `docker cp` out → `gzip` → upload with `curl` to the GCS JSON API using the VM service account's token from the metadata server (no `gcloud` on the box — the snap was removed 2026-09-29). Keeps the newest 30 objects; ~32 MB per backup. Cron runs as `tonimelisma` at 03:00 UTC and appends to `/var/log/hackernews-backup.log`, which must exist and be owned by that user (the redirect is evaluated by the shell before the script runs — when the file could not be created, the job silently never ran from at least 2026-02-20 to 2026-09-29).

The `gcloud` commands above run from a workstation, not the VPS.

### Account Administration

Accounts are local username/password accounts. There is no signup or reset flow in the app — accounts are managed by hand with `scripts/users.js`, run inside the container (`-t`/`-it` give it a TTY so passwords are read without echo; they are never passed as arguments):

```bash
# Set or reset a password (browsers already logged in stay logged in)
gcloud compute ssh vps-1 --project=melisma-services --zone=us-central1-a --ssh-flag=-t --command="docker exec -it hackernews-app-1 node scripts/users.js set-password <username>"

# Create an account (prompts for the password)
gcloud compute ssh vps-1 --project=melisma-services --zone=us-central1-a --ssh-flag=-t --command="docker exec -it hackernews-app-1 node scripts/users.js add <username>"

# List accounts (password set?, session version, hidden-story count)
gcloud compute ssh vps-1 --project=melisma-services --zone=us-central1-a --command="docker exec hackernews-app-1 node scripts/users.js list"

# Log an account out of every browser (e.g. lost device, after a forced reset)
gcloud compute ssh vps-1 --project=melisma-services --zone=us-central1-a --command="docker exec hackernews-app-1 node scripts/users.js revoke-sessions <username>"
```

Piped (non-TTY) input is also accepted: one line for the password, one for the confirmation. Minimum password length is 8.

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

Caddy runs from `/opt/reverse-proxy` as the `caddy` container. As of 2026-09-29 HackerNews is the only site on the VPS (the relay demo, mcp-fakes inbox and koskiset-feedback services were removed), so the `Caddyfile` is just:

```caddy
hackernews.melisma.net {
	reverse_proxy hackernews-app:3000
}
```

The Caddyfile is bind-mounted as a single file, so edit it in place (e.g. `>` redirect), not by replacing the file (a new inode is invisible to the container). Validate and reload with `docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` and `docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.

**Host baseline (2026-09-29 cleanup):** snapd and all snaps removed and pinned out (`/etc/apt/preferences.d/no-snapd.pref`) — there is no `gcloud` on the box; multipath-tools, the `ubuntu-server` metapackage and its unused recommends (open-iscsi, open-vm-tools, landscape) purged, with the remaining `ubuntu-server` dependencies marked manual; journald capped at 200 MB (`/etc/systemd/journald.conf.d/size.conf`); Docker build cache pruned; both containers' json-file logs capped at 10 MB × 3 (app via this repo's `docker-compose.yml`, Caddy via `/opt/reverse-proxy/docker-compose.yml`); `/etc/logrotate.d/hackernews-backup` rotates the backup log monthly (`su root syslog`, re-creates it owned by `tonimelisma`); `packagekit` masked (not purged — purging would remove `software-properties-common`).

The reverse proxy uses the external Docker network `reverse_proxy`. HackerNews joins that network with the alias `hackernews-app`; unrelated services should join the same network with service-specific aliases.

Caddy auto-provisions Let's Encrypt certs. Cert data is stored in the Docker volume originally named `hackernews_caddy-data`, reused by the shared proxy to avoid certificate churn.

```bash
# Check Caddy logs for cert issues
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="cd /opt/reverse-proxy && docker compose logs caddy | tail -20"

# Force cert renewal (rarely needed)
gcloud compute ssh --project=melisma-services vps-1 --zone=us-central1-a --command="cd /opt/reverse-proxy && docker compose restart caddy"
```

### VPS Service Account Scopes

The VM service account has `storage-rw`, `logging-write`, `monitoring-write`. If you need to change scopes, the VM must be stopped first:

```bash
gcloud compute instances stop --project=melisma-services vps-1 --zone=us-central1-a
gcloud compute instances set-service-account --project=melisma-services vps-1 --zone=us-central1-a --scopes=storage-rw,logging-write,monitoring-write
gcloud compute instances start --project=melisma-services vps-1 --zone=us-central1-a
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
│   ├── data/                       # Exported JSON data (gitignored)
│   ├── import-json-to-sqlite.js    # Import JSON stories/users/hidden → SQLite
│   ├── migrate.js                  # CLI: node scripts/migrate.js [up|rollback|status]
│   ├── users.js                    # CLI: node scripts/users.js [list|add|set-password|revoke-sessions]
│   └── backup-sqlite.sh            # Daily SQLite backup to GCS
│
├── docs/                           # LLM-geared documentation
│
├── Dockerfile                     # Multi-stage Docker build (node:24-alpine, bakes data into image)
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

**History (2026-09):** login used to be proxied to `news.ycombinator.com/login`. HN began answering logins from the VPS's datacenter IP with a "Validation required" reCAPTCHA page, which the proxy misread as invalid credentials, so every login failed. Local accounts replaced it; usernames (and therefore every hidden story) carried over unchanged.

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
