# Database — SQLite

## Overview

The app uses SQLite via `better-sqlite3` with WAL mode enabled for concurrent read/write support. The database file location is configurable via `SQLITE_PATH` environment variable (default: `./data/hackernews.db`).

Schema is initialized automatically on first use via `initSchema()` in `services/database.js`.

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

## Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_stories_score` | `score DESC` | Fast `ORDER BY score DESC` for "All" timespan |
| `idx_stories_time` | `time DESC` | Fast time-range filtering |
| `idx_stories_time_updated` | `time, updated` | Worker stale-story detection queries |
| `idx_hidden_username` | `username` | Fast hidden story lookups per user |

## Connection Management

| Component | Behavior |
|-----------|----------|
| `services/database.js` | Lazy singleton — `getDb()` opens SQLite on first call, enables WAL + foreign keys |
| `services/database.js:setDb()` | Allows tests to inject an in-memory `:memory:` database |
| `services/database.js:initSchema()` | Creates tables and indexes (idempotent, uses IF NOT EXISTS) |

## Query Patterns

### `getStories(timespan, limit, skip)` — `storyService.js`

Single SQL query handles everything:

```sql
-- Time-filtered with hidden exclusion
SELECT id, by, descendants, score, time, title, url
FROM stories
WHERE time > ?
  AND id NOT IN (SELECT story_id FROM hidden WHERE username = ?)
ORDER BY score DESC
LIMIT ? OFFSET ?

-- "All" timespan (no time filter)
SELECT id, by, descendants, score, time, title, url
FROM stories
WHERE id NOT IN (SELECT story_id FROM hidden WHERE username = ?)
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

Each query is capped at `WORKER_BATCH_LIMIT=200`.

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
