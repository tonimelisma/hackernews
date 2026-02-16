# Database — Google Cloud Firestore

## Overview

The app uses Google Cloud Firestore (project: `melisma-hackernews`, default database) with environment-prefixed collections to separate dev/ci/prod data in a single database.

| `NODE_ENV` | Prefix | Collections |
|---|---|---|
| `production` | `prod-` | `prod-stories`, `prod-users`, `prod-cache` |
| `staging` | `staging-` | `staging-stories`, `staging-users`, `staging-cache` |
| `ci` | `ci-` | `ci-stories`, `ci-users`, `ci-cache` |
| anything else | `dev-` | `dev-stories`, `dev-users`, `dev-cache` |

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

## Cache (`{prefix}-cache`)

Document ID: timespan name (`Day`, `Week`, `Month`, `Year`, `All`)

| Field | Type | Description |
|-------|------|-------------|
| `stories` | array of objects | Cached story data (up to 2000 stories) |
| `stories[].by` | string | Author username |
| `stories[].descendants` | number | Comment count |
| `stories[].id` | number | HN story ID |
| `stories[].score` | number | HN score |
| `stories[].time` | number | Story timestamp as epoch millis (not Firestore Timestamp) |
| `stories[].title` | string | Story title |
| `stories[].url` | string | Link URL |
| `cachedAt` | number | Cache write timestamp (epoch millis) |

**Why epoch millis for `time`:** Avoids Firestore Timestamp round-trip conversion. Stories are converted back to Date objects when read from cache.

**Size:** ~400-800KB per doc (up to 2000 stories x ~400 bytes), within Firestore's 1MB doc limit.

**Purpose:** L2 cache layer. When App Engine scales to zero, the in-memory L1 cache is lost. L2 prevents cold-start Year requests from costing 20K+ Firestore reads (1 read instead). `clearCache()` batch-deletes all 5 cache docs.

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
gcloud firestore indexes composite create --project=melisma-hackernews \
  --collection-group={prefix}-stories --field-config=field-path=time,order=ASCENDING --field-config=field-path=updated,order=ASCENDING
```

## Query Patterns

### `getStories(timespan, limit, skip)` — `storyService.js`

Two query paths, final output capped at `MAX_QUERY_DOCS=2000`:

- **"All" timespan**: `orderBy('score', 'desc').limit(2000)` — Firestore sorts directly, no client-side sort needed.
- **Time-filtered** (Day/Week/Month/Year): `where('time', '>', X).orderBy('time', 'desc')` (no limit) — fetches all stories in the time range, sorts by score client-side, keeps top 2000. No `limit()` because Firestore requires the first `orderBy` to match the inequality field — limiting by time would miss high-scoring older stories.

The 2000 buffer ensures power users with many hidden stories still see a full page after server-side hidden filtering (sliced to `limitResults=500`).

Results are cached in a two-tier system: L1 (in-memory Map) and L2 (Firestore `{prefix}-cache/{timespan}` docs) with per-timespan TTLs: Day=30min, Week=2d, Month=1w, Year=1mo, All=1mo. Non-Day timespans always merge in fresh Day stories, so new high-scoring stories appear quickly without full cache refresh. `clearCache()` is async and clears both L1 and L2.

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
