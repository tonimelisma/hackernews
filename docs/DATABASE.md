# Database — SQLite

## Overview

The app uses SQLite via `better-sqlite3` with WAL mode enabled for concurrent read/write support. The database file location is configurable via `SQLITE_PATH` environment variable (default: `./data/hackernews.db`).

Schema is managed via numbered migration files in `migrations/`. On first database use, `services/database.js` calls `runMigrations()` from `services/migrator.js`, which runs any pending migrations and tracks them in the `schema_migrations` table. CLI: `node scripts/migrate.js [up|rollback|status]`.

## Schema

### Stories

```sql
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  by TEXT,
  descendants INTEGER,
  kids TEXT,
  score INTEGER,
  time INTEGER NOT NULL,
  title TEXT,
  url TEXT,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stories_score ON stories(score DESC);
CREATE INDEX IF NOT EXISTS idx_stories_time ON stories(time DESC);
CREATE INDEX IF NOT EXISTS idx_stories_time_updated ON stories(time, updated);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | HN story ID (natural numeric order) |
| `by` | TEXT | Author username |
| `descendants` | INTEGER | Comment count |
| `kids` | TEXT | JSON array of child comment IDs, or NULL |
| `score` | INTEGER | HN score (upvotes) |
| `time` | INTEGER NOT NULL | Story timestamp (epoch milliseconds) |
| `title` | TEXT | Story title |
| `url` | TEXT | Link URL (NULL for self-posts like Ask HN) |
| `updated` | INTEGER NOT NULL | Last sync timestamp (epoch milliseconds) |

### Users

```sql
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY
);
```

| Column | Type | Description |
|--------|------|-------------|
| `username` | TEXT PRIMARY KEY | HN username |

### Hidden

```sql
CREATE TABLE IF NOT EXISTS hidden (
  username TEXT NOT NULL,
  story_id INTEGER NOT NULL,
  added_at INTEGER DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (username, story_id)
);
CREATE INDEX IF NOT EXISTS idx_hidden_username ON hidden(username);
```

| Column | Type | Description |
|--------|------|-------------|
| `username` | TEXT NOT NULL | HN username |
| `story_id` | INTEGER NOT NULL | Hidden story ID |
| `added_at` | INTEGER | Timestamp when hidden (epoch milliseconds) |

### Schema Migrations

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

| Column | Type | Description |
|--------|------|-------------|
| `version` | INTEGER PRIMARY KEY | Migration number (e.g., 1 for 001-initial-schema) |
| `name` | TEXT NOT NULL | Migration filename without extension |
| `applied_at` | TEXT NOT NULL | ISO 8601 timestamp when migration was applied |

## Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_stories_score` | `score DESC` | Fast `ORDER BY score DESC` for the broad (Month/Year/All) timespans |
| `idx_stories_time` | `time DESC` | Fast filtering for the selective (Day/Week) timespans |
| `idx_stories_time_updated` | `time, updated` | Worker stale-story detection queries |
| `idx_hidden_username` | `username` | Fast hidden story lookups per user |

## Query-Planner Statistics (ANALYZE)

`getStories` runs `WHERE time > ? ORDER BY score DESC LIMIT 500`. There is no single
index that satisfies both the time-range filter and the score ordering, so the
planner must choose: scan `idx_stories_score` top-to-bottom and filter by time
(no sort, but reads until it collects `LIMIT` matches), **or** range-scan
`idx_stories_time` for the matching rows then sort them by score (extra sort, but
reads only matching rows). Which is cheaper depends entirely on how many rows fall
inside the window — and the planner can only know that if statistics exist.

**Read path:** `getStories` forces index choice via SQLite `INDEXED BY` hints — the
frontend is read-only and writes are rare, so we optimize for predictable latency
over planner heuristics:

- **Day / Week / Month / Year:** `INDEXED BY idx_stories_time` — range-scan recent
  rows, sort by score. Avoids pathological `idx_stories_score` scans when
  high-scored stories fall outside the window (measured **16 s** on prod for Month).
- **All:** `INDEXED BY idx_stories_score` — no time filter; score order is the query.

`ANALYZE` (migration 002, worker refresh) still keeps worker staleness queries
fast; the hints apply only to `getStories`.

## Connection Management

| Component | Behavior |
|-----------|----------|
| `services/database.js` | Lazy singleton — `getDb()` opens SQLite on first call, enables WAL + foreign keys, runs pending migrations |
| `services/database.js:setDb()` | Allows tests to inject an in-memory `:memory:` database |
| `services/database.js:initSchema()` | Wrapper around `runMigrations()` for backward compatibility with test setup |
| `services/migrator.js` | Reads `migrations/*.js`, runs pending `up()` in transactions, tracks in `schema_migrations` |
| `scripts/migrate.js` | CLI: `node scripts/migrate.js [up\|rollback\|status]` |

## Query Patterns

### `getStories(timespan, limit, skip)` — `storyService.js`

Single SQL query handles everything:

```sql
-- Time-filtered with hidden exclusion (INDEXED BY idx_stories_time)
SELECT id, by, descendants, score, time, title, url
FROM stories INDEXED BY idx_stories_time
WHERE time > ?
  AND id NOT IN (...)
ORDER BY score DESC
LIMIT ? OFFSET ?

-- "All" timespan (INDEXED BY idx_stories_score)
SELECT id, by, descendants, score, time, title, url
FROM stories INDEXED BY idx_stories_score
WHERE id NOT IN (...)
ORDER BY score DESC
LIMIT ? OFFSET ?
```

This single query replaces the previous Firestore approach which required: L1 check → L2 cache check → Firestore query → client-side sort → Day-merge → hidden filter → slice.

Results are cached in an L1 in-memory Map with a 1-minute TTL.

### Worker — stale story detection

```sql
SELECT id FROM stories WHERE time > ? AND updated < ? ORDER BY updated ASC LIMIT ?
```

Runs every 15 minutes with three staleness tiers:
- **Daily stories** (last 24h): stale after 1h
- **Weekly stories** (last 7 days): stale after 6h
- **Monthly stories** (last 28 days): stale after 48h

Each query is capped at `WORKER_BATCH_LIMIT=500`.

### Worker — find latest story

```sql
SELECT id FROM stories ORDER BY id DESC LIMIT 1
```

### `getHidden` — `storyService.js`

```sql
SELECT story_id FROM hidden WHERE username = ?
```

Results cached in a 5-minute per-user in-memory cache. `upsertHidden` invalidates the cache entry.

### `upsertHidden` — `storyService.js`

```sql
INSERT OR IGNORE INTO users (username) VALUES (?);
INSERT OR REPLACE INTO hidden (username, story_id) VALUES (?, ?);
```

Naturally idempotent — hiding the same story twice is a no-op.

### Story import/update — `hackernews.js`

```sql
-- Add new stories (in a transaction)
INSERT OR REPLACE INTO stories (id, by, descendants, kids, score, time, title, url, updated)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)

-- Update existing story scores (in a transaction)
UPDATE stories SET score = ?, descendants = ?, updated = ? WHERE id = ?
```

All bulk operations use SQLite transactions for atomicity and performance.
