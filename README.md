# HackerNews Aggregator

A Hacker News aggregator that filters stories by score thresholds across time periods (day/week/month/year/all-time). Users can authenticate with their real HN credentials and hide stories. A background worker keeps the database fresh by syncing from the HN API and hntoplinks.com.

## Features

- Top stories filtered by time period (day, week, month, year, all-time)
- Score-based ranking with pagination
- User authentication via HN credentials (proxied login)
- Per-user story hiding
- Background worker with tiered update strategy
- Responsive Bootstrap 5 UI for mobile and desktop

## Tech Stack

- **Backend:** Node.js, Express 5
- **Frontend:** React 19 (CRA)
- **Database:** Google Cloud Firestore
- **Worker:** throng-managed background process
- **CI:** GitHub Actions (Node 18 + 20 matrix)

## Prerequisites

- Node.js 18 or 20 (Node 25+ is **not supported** due to `SlowBuffer` removal)
- Google Cloud Firestore project with Application Default Credentials
- A `.env` file with `SECRET` set (see `.env.example`)

## Quick Start

```bash
# Install dependencies
npm install
cd hackernews-frontend && npm install --legacy-peer-deps && cd ..

# Set environment variable
cp .env.example .env
# Edit .env and set SECRET to a secure random string

# Run backend dev server (requires Firestore ADC)
npm run watch

# Run frontend dev server (in another terminal)
cd hackernews-frontend && npm start

# Run background worker
npm run worker
```

## Testing

```bash
# Backend tests (in-memory mock, no credentials needed)
npm test

# Frontend tests
cd hackernews-frontend && npm test -- --watchAll=false

# Both
npm test && cd hackernews-frontend && npm test -- --watchAll=false && cd ..
```

87 total tests (58 backend + 29 frontend). Backend tests run in ~1 second using an in-memory Firestore mock.

## Documentation

- [CLAUDE.md](CLAUDE.md) - Project governance, architecture, gotchas, and learnings
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - System overview and data flow
- [docs/API.md](docs/API.md) - REST API reference
- [docs/DATABASE.md](docs/DATABASE.md) - Firestore schema and query patterns
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) - Environment variables
- [docs/TESTING.md](docs/TESTING.md) - Test architecture and mocks
- [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) - Known issues and resolution status
