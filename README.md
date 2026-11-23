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
- **Release:** CI pushes the image to `ghcr.io/tonimelisma/hackernews:latest` (and `:<sha>`); whatever runs it pulls it. This repo knows nothing about the host. The image runs as uid 1000 and writes only to `/data` and `/tmp` ([runtime contract](docs/ARCHITECTURE.md#runtime-contract))
- **CI:** GitHub Actions (actionlint, lint, test, build and push the image; no deploy step, no cloud credentials)

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

261 total tests (211 backend + 50 frontend). Backend tests run in a few seconds using in-memory SQLite.

## Documentation

- [CLAUDE.md](CLAUDE.md) — Project governance, architecture, gotchas, health, and backlog
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System overview, release and runtime contract, data flow, environment variables
- [docs/API.md](docs/API.md) — REST API reference
- [docs/DATABASE.md](docs/DATABASE.md) — SQLite schema, migrations, and query patterns
- [docs/TESTING.md](docs/TESTING.md) — Test architecture and mocks
