# HackerNews Aggregator

A Hacker News aggregator that filters stories by score across time periods (day/week/month/year/all-time). Users can authenticate with their real HN credentials and hide stories. A background worker syncs stories from the HN API every 15 minutes.

Live at: https://hackernews.melisma.net

## Features

- Top stories filtered by time period (day, week, month, year, all-time)
- Score-based ranking with pagination
- User authentication via HN credentials (proxied login)
- Per-user story hiding (persisted in localStorage for anonymous users, synced to server on login)
- Background worker with tiered update strategy (15-minute cycle)
- Dark mode via system preference detection
- Responsive Bootstrap 5 UI with virtualized story list

## Tech Stack

- **Backend:** Node.js 20, Express 5
- **Frontend:** React 19 (Vite)
- **Database:** SQLite (better-sqlite3, WAL mode)
- **Worker:** Integrated setInterval (15-minute cycle)
- **Deployment:** Docker + Caddy (auto HTTPS) on GCP e2-micro
- **CI:** GitHub Actions (lint, test, deploy via SSH)

## Prerequisites

- Node.js 20 (Node 25+ is **not supported** due to `SlowBuffer` removal in `jsonwebtoken` dependency chain)
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

175 total tests (126 backend + 49 frontend). Backend tests run in ~1 second using in-memory SQLite.

## Documentation

- [CLAUDE.md](CLAUDE.md) — Project governance, architecture, gotchas, health, and backlog
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System overview, data flow, and environment variables
- [docs/API.md](docs/API.md) — REST API reference
- [docs/DATABASE.md](docs/DATABASE.md) — SQLite schema, migrations, and query patterns
- [docs/TESTING.md](docs/TESTING.md) — Test architecture and mocks
