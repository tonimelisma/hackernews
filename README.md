# HackerNews Aggregator

A Hacker News aggregator that filters stories by score across time periods (day/week/month/year/all-time). Users log in with local accounts (username + password, managed by an administrator) and hide stories. A background worker syncs stories from the HN API every 15 minutes.

## Features

- Top stories filtered by time period (day, week, month, year, all-time)
- Score-based ranking with pagination
- Local username/password accounts (scrypt hashes, JWT cookie); no signup, accounts are created by an administrator
- Per-user story hiding for logged-in users
- Background worker with tiered update strategy (15-minute cycle)
- Dark mode via system preference detection
- Responsive Bootstrap 5 UI with virtualized story list

## Tech Stack

- **Backend:** Node.js 24, Express 5
- **Frontend:** React 19 (Vite)
- **Database:** SQLite (better-sqlite3, WAL mode)
- **Worker:** Integrated setInterval (15-minute cycle)
- **Release:** every green `main` commit publishes a signed (cosign keyless), multi-arch (amd64 + arm64) image `ghcr.io/tonimelisma/hackernews:latest` and `:<sha>`, with provenance and an SBOM. Hosts pull it however they like; this repo knows nothing about them. The image runs as uid 1000 on a read-only root and writes only to `/data` and `/tmp` ([releases and runtime contract](docs/release.md))
- **CI:** GitHub Actions (actionlint, lint, tests, image build + runtime-contract smoke test on every PR; no deploy step, no deployment credentials)

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

Backend tests run in a few seconds using in-memory SQLite. `script/verify` runs everything CI checks.

## Documentation

- [CLAUDE.md](CLAUDE.md) — how work is done here: process, invariants, commands, Definition of Done
- [docs/index.md](docs/index.md) — map of the docs: requirements, architecture, decisions (ADRs), design notes, lessons
- [docs/release.md](docs/release.md) — releases (tags, signatures, provenance) and the runtime contract for hosts
