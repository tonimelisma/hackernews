# 0001. SQLite in one file, one query per story page

- Status: accepted
- Date: 2026-11-27 (recorded; the move from Firestore predates this record)

## Context and problem

The app stores Hacker News stories, users and each user's hidden stories, and serves "top stories
in a timespan, minus the hidden ones" (HN-001 to HN-006). On Firestore this needed an L2 cache,
cache patching, a Day-merge, ID padding, `undefined` stripping, batched writes of 20 and a
subcollection per user: about 200 lines of cache, merge and filter logic around a store that
could not filter, exclude and sort in one query.

## Decision drivers

- One query per page: time filter, hidden exclusion, score sort and pagination together.
- Runs on a small machine at no cost (ADR 0008); no external service or credentials.
- Tests without credentials or network.

## Considered options

### Firestore (the previous store)

- Good: managed, no disk to look after.
- Bad: no combined filter/exclude/sort, so the app carried its own caches and merges; costs and
  credentials; tests needed emulators or mocks.
- Failure modes: stale or inconsistent merged caches showed wrong pages.

### SQLite file with better-sqlite3 (WAL)

- Good: one SQL statement per page; a file in `/data`; `:memory:` databases for tests.
- Bad: synchronous driver, so a slow query blocks the process (see ADR 0005); one writer.
- Failure modes: a pathological query plan freezes every request until it finishes.

## Decision

SQLite through better-sqlite3, WAL mode and foreign keys on, opened lazily by `getDb()` in
`services/database.js`; `setDb()` injects `:memory:` databases in tests. `getStories()` is one
statement: `WHERE time > ? AND id NOT IN (...) ORDER BY score DESC LIMIT ? OFFSET ?`.

## Consequences

The caches and merge code are gone. Backups are a host's job: one file, hot-copied with
`sqlite3 .backup` inside the container (`docs/release.md`). The synchronous driver makes query
plans a correctness concern, not just speed.

## Confirmation

`tests/integration/storyService.test.js` (HN-001 to HN-006) runs the real query on in-memory
SQLite; `tests/unit/database.test.js` (HN-035) checks the schema.

## Retirement proof

A need for several writer processes or several hosts sharing data, shown by a real workload.

## Reversal plan

Introduce a storage interface over `storyService`/`userService` and a server database; migrate
the file's rows with a one-off script. Days of work, mostly tests.
