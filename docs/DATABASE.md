# Database — Google Cloud Firestore

## Overview

The app uses Google Cloud Firestore (project: `melisma-essentials`, database: `hackernews`) with environment-prefixed collections to separate dev/ci/prod data in a single database.

| `NODE_ENV` | Prefix | Collections |
|---|---|---|
| `production` | `prod-` | `prod-stories`, `prod-users` |
| `ci` | `ci-` | `ci-stories`, `ci-users` |
| anything else | `dev-` | `dev-stories`, `dev-users` |

Prefix logic lives in `services/firestore.js:getCollectionPrefix()`.

## Stories (`{prefix}-stories`)

Document ID: zero-padded HN story ID, 10 digits (e.g., `"0042345678"`)

| Field | Type | Description |
|-------|------|-------------|
| `by` | string | Author username |
| `descendants` | number | Comment count |
| `id` | number | HN story ID (also encoded in doc ID) |
| `kids` | array of number | Child comment IDs |
| `score` | number | HN score (upvotes) |
| `time` | timestamp | Story timestamp (converted from HN seconds × 1000) |
| `title` | string | Story title |
| `url` | string | Link URL |
| `updated` | timestamp | Last sync timestamp |

**Why zero-padded doc IDs:** Firestore doc IDs are strings sorted lexicographically. Zero-padding to 10 digits makes `orderBy("id", "desc")` match numeric order, needed by the worker to find the latest story.

## Users (`{prefix}-users`)

Document ID: HN username (e.g., `"dang"`)

The user document itself is empty (`{}`). Hidden story IDs are stored in a subcollection.

### Hidden Subcollection (`{prefix}-users/{username}/hidden`)

Document ID: story ID as string (e.g., `"42345678"`)

| Field | Type | Description |
|-------|------|-------------|
| `addedAt` | number | Timestamp when hidden (ms since epoch) |

**Why subcollection:** Firestore has a 1MB document limit. One user had 117K hidden story IDs (1.2MB as an array), exceeding this limit. Subcollection docs have no such constraint.

## Connection Management

| Component | Behavior |
|-----------|----------|
| `services/firestore.js` | Lazy singleton — `getDb()` creates the Firestore client on first call |
| `services/firestore.js:setDb()` | Allows tests to inject a custom Firestore instance |
| `worker.js` | No explicit connection management — Firestore handles connections automatically |

**No module-load connection side effect.** `storyService.js` imports collection refs from `firestore.js` but the client is only created when first used.

## Composite Indexes

Required for multi-inequality queries in the worker's score update logic:

| Collection | Fields | Used by |
|---|---|---|
| `{prefix}-stories` | `time ASC, updated ASC` | Worker: find stories newer than X but not updated since Y |

Create via:
```bash
gcloud firestore indexes composite create --project=melisma-essentials --database=hackernews \
  --collection-group={prefix}-stories --field-config=field-path=time,order=ASCENDING --field-config=field-path=updated,order=ASCENDING
```

## Query Patterns

### `getStories(timespan, limit, skip)` — `storyService.js`

Two query paths, both capped at `MAX_QUERY_DOCS=500`:

- **"All" timespan**: `orderBy('score', 'desc').limit(500)` — Firestore sorts directly, no client-side sort needed.
- **Time-filtered** (Day/Week/Month/Year): `where('time', '>', X).orderBy('time', 'desc').limit(500)` — fetches the 500 most recent matching stories, then sorts by score client-side.

Results are cached with per-timespan TTLs: Day=30min, Week=2d, Month=1w, Year=1mo, All=1mo. Cache is persisted to `.cache/stories.json` and restored on app restart. Non-Day timespans always merge in fresh Day stories, so new high-scoring stories appear quickly without full cache refresh. `clearCache()` resets the cache (used in tests).

### Worker — stale story detection

Uses multi-inequality: `where('time', '>').where('updated', '<').orderBy('updated', 'asc').limit(200)`. Runs every 30 minutes with three staleness tiers:
- **Daily stories**: stale after 1h
- **Weekly stories**: stale after 6h
- **Monthly stories**: stale after 48h

Each query is capped at `WORKER_BATCH_LIMIT=200` to prevent unbounded reads. The 14-day-old catch-all query has been removed (scores are stable after 2 weeks). Requires the composite index above.

### Worker — find latest story

`orderBy('id', 'desc').limit(1)` — uses the auto-created single-field index on `id`.

### `upsertHidden` — `storyService.js`

`set()` on subcollection doc `hidden/{storyId}` is naturally idempotent (replaces MongoDB's `$addToSet`).
