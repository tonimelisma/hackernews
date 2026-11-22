# HackerNews Aggregator

A Hacker News aggregator that filters stories by score across time periods (day/week/month/year/all-time). Users log in with local accounts (username + password, managed by the owner) and hide stories. A background worker syncs stories from the HN API every 15 minutes.

Live at: https://hackernews.melisma.net

## Features

- Top stories filtered by time period (day, week, month, year, all-time)
- Score-based ranking with pagination
- Local username/password accounts (scrypt hashes, JWT cookie); no signup, accounts are created by the owner
- Per-user story hiding for logged-in users
- Background worker with tiered update strategy (15-minute cycle)
- Dark mode via system preference detection
- Responsive Bootstrap 5 UI with virtualized story list

## Tech Stack

- **Backend:** Node.js 24, Express 5
- **Frontend:** React 19 (Vite)
- **Database:** SQLite (better-sqlite3, WAL mode)
- **Worker:** Integrated setInterval (15-minute cycle)
- **Deployment:** Docker app behind shared Caddy reverse proxy on GCP e2-micro. CI pushes the image to `ghcr.io/tonimelisma/hackernews:latest`; the server pulls it every 5 minutes and rolls back if it isn't healthy. The server's compose file lives in the [latchkey](https://github.com/tonimelisma/latchkey) repo; this repo's `docker-compose.yml` is for local use. The app runs there as a non-root user (uid 1000) and may write only to `/data` and `/tmp`
- **CI:** GitHub Actions (actionlint, lint, test, build and push the image; no deploy step)
- **Operations:** production jobs (accounts, logs, health, backups, restore) run as the `ops.yml` workflow, started from a Claude Code cloud session with `scripts/ops.sh`; GCP access through Workload Identity Federation, results age-encrypted because this repo's logs are public ([docs/OPERATIONS.md](docs/OPERATIONS.md))

## Prerequisites

- Node.js 24 (JWT auth uses `jose`, compatible with all modern Node versions)
- A `.env` file with `SECRET` set (see `.env.example`)

No external database credentials needed — SQLite runs locally.

## Quick Start

```bash
# Install dependencies
npm install
cd hackernews-frontend && npm install && cd ..

# Set environment variable
cp .env.example .env
# Edit .env and set SECRET to a secure random string

# Run backend dev server
npm run watch

# Run frontend dev server (in another terminal)
cd hackernews-frontend && npm start

# Import seed data (optional)
npm run import
```

## Testing

```bash
# Backend tests (in-memory SQLite, no credentials needed)
npm test

# Frontend tests
cd hackernews-frontend && npm test

# Backend coverage
npm run test:coverage

# Frontend coverage
cd hackernews-frontend && npm run test:coverage
```

287 total tests (237 backend + 50 frontend). Backend tests run in a few seconds using in-memory SQLite.

## Documentation

- [CLAUDE.md](CLAUDE.md) — Project governance, architecture, gotchas, health, and backlog
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System overview, data flow, and environment variables
- [docs/API.md](docs/API.md) — REST API reference
- [docs/DATABASE.md](docs/DATABASE.md) — SQLite schema, migrations, and query patterns
- [docs/TESTING.md](docs/TESTING.md) — Test architecture and mocks
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — Production jobs (ops workflow) and Owner setup
