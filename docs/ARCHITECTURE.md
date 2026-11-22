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
| **Domain** | `hackernews.melisma.net` (Cloudflare DNS, A record, DNS-only/gray cloud) |
| **Docker** | Docker 29.4 + Compose 5.1 |
| **App path on VPS** | `/opt/hackernews`: the server's compose file (installed from the latchkey repo), `.env`, and the backup script's copy. Not a git checkout; nothing pulls this repo there any more |
| **Shared reverse proxy path** | `/opt/reverse-proxy` (`caddy` container, shared by all public services on the host; its compose file also comes from the latchkey repo) |
| **App's Docker network** | `hackernews-front` (external; shared only with Caddy, alias `hackernews-app`) |
| **Secrets on VPS** | `/opt/hackernews/.env` (contains `SECRET=...`) |
| **Backup bucket** | `gs://hackernews-melisma-backup/` (us-central1, Always Free tier) |
| **Backup cron** | `0 3 * * *` — daily at 3:00 AM UTC |

### Running Production Jobs

Production jobs (accounts, logs, health, backups, restore, DB stats) run as the GitHub Actions workflow `.github/workflows/ops.yml`, started from a cloud session with `scripts/ops.sh <job>` and reaching vps-1 as a GCP service account through Workload Identity Federation and the IAP tunnel. Results come back age-encrypted, because this repo's logs are public. See [OPERATIONS.md](OPERATIONS.md) for every job, the public-log rules and the Owner setup.

Since 2026-11-21 SSH reaches the server only through Google's IAP tunnel; port 22 is closed to the internet. The Docker command blocks below run on the server (the ops jobs wrap them); they double as break-glass commands from Toni's workstation over `gcloud compute ssh --tunnel-through-iap --project=melisma-services vps-1 --zone=us-central1-a --command="<cmd>"` when Actions is unavailable.

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

# Check for a new image now instead of waiting for the 5-minute timer
sudo systemctl start latchkey-update-apps && journalctl -t latchkey-update-apps -n 20

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

The Caddy container is named `caddy`, not `hackernews-caddy-1`. It owns host ports 80/443 and routes public hostnames to app containers, each on its own network shared only with Caddy (`hackernews-front` for this app).

### Remote Debugging

| Question | Job (`scripts/ops.sh …`) | What runs on the server |
|----------|--------------------------|-------------------------|
| Is it up? | `health` (or `curl -s "https://hackernews.melisma.net/api/v1/stories?timespan=Day&limit=1"` from the session) | container health, `wget` of the API inside the container, `docker stats`, `free`, `df`, load, timer state, last backup |
| What did the worker do? | `logs` | `docker logs hackernews-app-1`, its `sync\|WORKER\|fetched\|adding` lines, `docker logs caddy`, `journalctl -t latchkey-update-apps`, `/var/log/hackernews-backup.log` |
| How big is the DB? | `db-stats` | `sqlite3 /data/hackernews.db` row counts, page stats, file sizes, applied migrations |

### CI/CD Pipeline and Deploys

Push to `master` triggers: **backend tests → frontend tests → image build in CI → push to GHCR**. CI never touches the server. The repo is public, so standard GitHub-hosted runner minutes are free.

```
ci.yml flow:
  workflows (actionlint over .github/workflows, shellcheck over ops scripts)
  backend-tests (lint + jest + npm audit --omit=dev)
  frontend-tests (vitest + build + npm audit)
       ↓ all pass
  image (only on push to master): buildx linux/amd64 → push
        ghcr.io/tonimelisma/hackernews:<sha> and :latest (GHA layer cache)

on the server (latchkey-update-apps, a systemd timer every 5 minutes):
  docker pull ghcr.io/tonimelisma/hackernews:latest
       ↓ image changed
  docker compose up -d → wait up to 5 minutes for the health check
  ✓ healthy → done
  ✗ unhealthy → back to the previous image; that image is skipped from then on
```

**The server pulls; nothing pushes to it.** Since 2026-11-21 (Toni's lockdown of the shared server, which also runs the Latchkey relay) SSH is reachable only through Google's IAP tunnel, so GitHub Actions can no longer deploy over SSH. The public `:latest` image is the deploy: CI must keep pushing it (guarded by `tests/unit/compose.test.js`), and a push reaches production within about 5 minutes. There are no deploy secrets. Production *jobs* (not deploys) go through `ops.yml`, see [OPERATIONS.md](OPERATIONS.md).

**The server's compose file is not in this repo.** It is a fixed file owned by the latchkey repo (`deploy/server/host/hackernews-compose.yml` in github.com/tonimelisma/latchkey), so a push here can change the app but never the container's limits on the server. It runs the app as uid 1000 (the image's `node` user) with all capabilities dropped, `no-new-privileges`, a 384 MB memory cap, and the `sqlite-data` volume on `/data`. **The app must keep working as that non-root user, writing only to `/data` and `/tmp`.** This repo's `docker-compose.yml` is for local use only and mirrors those limits.

**Nothing is built on the VPS.** On 2026-09-29 an on-box build saturated the 30 GB `pd-standard` disk (94% util, 81 ms await, 88% iowait) and slowed requests to ~14 s.

### Local Docker Testing

```bash
# Build and run locally (no Caddy, just app on port 3000)
SECRET=anysecret docker compose -f docker-compose.dev.yml up --build

# Or run the CI-built image with the server's limits (uid 1000, no capabilities)
SECRET=anysecret docker compose up

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
   - Copies `node_modules`, frontend build, baked SQLite DB; `/data` belongs to `node` and the image runs as `USER node` (a fresh volume takes `/data`'s owner from the image; root-owned, the app crashed as uid 1000 with `SQLITE_READONLY_DIRECTORY`; guarded by `tests/unit/dockerfile.test.js`)
   - Copies only the app source files needed at runtime (`bin`, `routes`, `services`, `util`, `migrations`, plus `scripts/users.js` and `scripts/migrate.js` — not all of `scripts/`, which would ship local `scripts/data/` exports; guarded by `tests/unit/dockerfile.test.js`)
   - Built by CI, not on the VPS. CI checkouts have no `scripts/data/*.json`, so the baked DB is empty; production data lives in the `sqlite-data` volume mounted over `/data`
   - ~160 MB final image

### Backups

| Task | Job (`scripts/ops.sh …`) |
|------|--------------------------|
| Manual backup | `backup` (runs the server's `/opt/hackernews/scripts/backup-sqlite.sh`, as cron does) |
| List backups | `backups-list` |
| Download a backup | `backups-download --backup hackernews-YYYYMMDD.db.gz` (age-encrypted to the session) |
| Restore | `restore --backup hackernews-YYYYMMDD.db.gz --confirm "restore hackernews-YYYYMMDD.db.gz"` — integrity check, safety copy `prerestore-<time>.db.gz` uploaded first, sqlite3 `.restore` as the app's user, restart, wait for healthy |
| Check the cron / backup log | `logs` (backup section) and `health` (`last_backup`) |

Backup process: `sqlite3 .backup` inside container → `docker cp` out → `gzip` → upload with `curl` to the GCS JSON API using the VM service account's token from the metadata server (no `gcloud` on the box — the snap was removed 2026-09-29). Keeps the newest 30 objects; ~32 MB per backup. Cron runs as `tonimelisma` at 03:00 UTC and appends to `/var/log/hackernews-backup.log`, which must exist and be owned by that user (the redirect is evaluated by the shell before the script runs — when the file could not be created, the job silently never ran from at least 2026-02-20 to 2026-09-29).

### Account Administration

Accounts are local username/password accounts. There is no signup or reset flow in the app — accounts are managed with `scripts/users.js` inside the container, driven by the ops workflow:

```bash
scripts/ops.sh users-list                              # password set?, session version, hidden count
scripts/ops.sh users-add --user <username>             # creates it with a generated password
scripts/ops.sh users-set-password --user <username>    # new generated password; browsers stay logged in
scripts/ops.sh users-revoke-sessions --user <username> # log out every browser
```

Generated passwords exist only in the workflow and in the age-encrypted results the session decrypts; they are piped to `users.js` on stdin (one line for the password, one for the confirmation; minimum length 8), never passed as arguments. Usernames travel only in the `repository_dispatch` payload, never in the public log.

### GCP Firewall Rules

```bash
# List rules
gcloud compute firewall-rules list

# Required rules (already created):
# allow-http  — tcp:80  from 0.0.0.0/0
# allow-https — tcp:443 from 0.0.0.0/0
# allow-ssh-iap — tcp:22 from Google's IAP range only (35.235.240.0/20; set up by the latchkey repo's deploy/harden.sh)
```

### DNS (Cloudflare)

- Record: `hackernews` A → the VM's static external IP
- Proxy: **DNS-only** (gray cloud) — Caddy handles TLS via Let's Encrypt
- If you switch to orange cloud (Cloudflare proxy), Caddy's ACME challenge will fail

### Shared Caddy Reverse Proxy

Caddy runs from `/opt/reverse-proxy` as the `caddy` container. The server is shared with the Latchkey relay; its Caddyfile entry and Caddy's compose file come from the latchkey repo. HackerNews's entry in the `Caddyfile` is:

```caddy
hackernews.melisma.net {
	reverse_proxy hackernews-app:3000
}
```

The Caddyfile is bind-mounted as a single file, so edit it in place (e.g. `>` redirect), not by replacing the file (a new inode is invisible to the container). Validate and reload with `docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` and `docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.

**Host baseline (2026-09-29 cleanup):** snapd and all snaps removed and pinned out (`/etc/apt/preferences.d/no-snapd.pref`) — there is no `gcloud` on the box; multipath-tools, the `ubuntu-server` metapackage and its unused recommends (open-iscsi, open-vm-tools, landscape) purged, with the remaining `ubuntu-server` dependencies marked manual; journald capped at 200 MB (`/etc/systemd/journald.conf.d/size.conf`); Docker build cache pruned; both containers' json-file logs capped at 10 MB × 3 (both compose files now come from the latchkey repo); `/etc/logrotate.d/hackernews-backup` rotates the backup log monthly (`su root syslog`, re-creates it owned by `tonimelisma`); `packagekit` masked (not purged — purging would remove `software-properties-common`). **sshguard** (C, ~10 MB RSS; chosen over Python fail2ban for memory) blocks SSH brute-forcers in nftables: 3 failed logins in 30 min → block starting at 2 min and escalating for repeat offenders; 12 cumulative failures → permanent ban via `BLACKLIST_FILE=120:/var/lib/sshguard/enemies` in `/etc/sshguard/sshguard.conf`. Password auth was already disabled, so this cuts noise/log growth rather than closing a hole. Successful logins never count.

HackerNews joins the external Docker network `hackernews-front`, shared only with Caddy, with the alias `hackernews-app`; other services get networks of their own.

Caddy auto-provisions Let's Encrypt certs. Cert data is stored in the Docker volume originally named `hackernews_caddy-data`, reused by the shared proxy to avoid certificate churn.

Caddy's log (cert issues show there) is a section of `scripts/ops.sh logs`. Caddy belongs to the shared server, so restarting it (to force a cert renewal, rarely needed) is a latchkey-repo task, not an ops job here.

### VPS Service Account Scopes

The VM service account has `storage-rw`, `logging-write`, `monitoring-write` (backup and restore use `storage-rw` through the metadata server). Changing scopes needs the VM stopped, so it is a one-off owner task from a workstation, not an ops job:

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
│   ├── backup-sqlite.sh            # Daily SQLite backup to GCS
│   ├── ops.sh                      # Cloud session: dispatch an ops job, wait, download + decrypt results
│   ├── cloud-setup.sh              # SessionStart hook: Node 24 + npm ci in Claude Code cloud sessions only
│   ├── preview.sh                  # Run the app on a seeded throwaway DB and screenshot it, then clean up
│   ├── seed-preview.js             # Seeds preview.sh's throwaway DB (sample stories + test account)
│   └── screenshot.sh / screenshot.js # Headless-Chrome screenshot over the DevTools protocol
│
├── ops/                            # Production jobs run by .github/workflows/ops.yml
│   ├── workflow.js                 # Validates the dispatch payload; filters the public summary line
│   ├── run.sh                      # Runner side: password generation, IAP SSH / GCS, age encryption
│   ├── remote.sh                   # Runs on vps-1 as root: users, logs, health, db-stats, backup, restore
│   └── age-recipient.txt           # age public key results are encrypted to (private key: HN_OPS_AGE_KEY)
│
├── docs/                           # LLM-geared documentation
│
├── Dockerfile                     # Multi-stage Docker build (node:24-alpine, bakes data into image)
├── docker-compose.yml             # Local only: the CI image with the server's limits (server's file lives in the latchkey repo)
├── docker-compose.dev.yml         # Local dev: App only on port 3000, no Caddy
├── .dockerignore                  # Files excluded from Docker build
├── .github/workflows/ci.yml      # GitHub Actions CI + image push (the server pulls :latest)
├── .github/workflows/ops.yml     # Production jobs on vps-1 via repository_dispatch + WIF
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
| `DISABLE_WORKER` | No | `true` skips the background HN sync in `bin/www` (used by `scripts/preview.sh`; never set in production) |

### Config Constants (`util/config.js`)

| Constant | Value | Description |
|----------|-------|-------------|
| `limitResults` | 500 | Max stories per API response |

### Frontend (`hackernews-frontend/src/services/`)

The frontend uses relative URLs (`/api/v1/`) for all API calls. In development, Vite's proxy (`vite.config.js`) forwards `/api` requests to the backend on port 3001.
