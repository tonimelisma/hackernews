# 0005. Query-planner statistics plus a forced index per timespan

- Status: accepted
- Date: 2026-11-27 (recorded; measured on a database of about 152,000 stories)

## Context and problem

`getStories` runs `WHERE time > ? ORDER BY score DESC LIMIT 500`; no single index serves both the
filter and the sort. Without `sqlite_stat1` the planner always walked `idx_stories_score` and
filtered by time, so the most selective window was the slowest: Day took about 125 ms median and
27 s at worst, and because better-sqlite3 is synchronous the whole process froze (HN-007).

## Decision drivers

- Every timespan fast on a slow disk and a small CPU (ADR 0008).
- No query may block the event loop for seconds.

## Considered options

### More or composite indexes

- Good: no statistics to maintain.
- Bad: no index satisfies a range filter on one column and a sort on another with a LIMIT.
- Failure modes: the planner still picks the wrong one.

### ANALYZE only

- Good: the planner chooses per query; every timespan dropped to 7 ms median or less.
- Bad: the choice can still flip at the edges: Month score scans reached 16 s when top scores fell
  outside the window, Year time scans 14–17 s because about 89% of rows match.

### ANALYZE plus `INDEXED BY` per timespan

- Good: predictable plans: time index for Day, Week and Month, score index for Year and All.
- Bad: the hint encodes data distribution; a very different dataset may need a different split.

## Decision

Migration 002 runs `ANALYZE`, the worker re-runs it at the end of every cycle (about 70 ms), and
`getStories` forces `INDEXED BY idx_stories_time` for Day–Month and `INDEXED BY
idx_stories_score` for Year and All.

## Consequences

Profile queries with `process.hrtime.bigint()` around `stmt.all()` and `EXPLAIN QUERY PLAN`, not
wall time. A new timespan needs its index choice decided and tested.

## Confirmation

`tests/integration/storyService.test.js` "uses correct INDEXED BY hint per timespan" and "Year
returns high-scoring old stories even with >500 stories in range" (HN-006, HN-007);
`tests/unit/migrator.test.js` (sqlite_stat1, Day plan); `tests/integration/worker.test.js`
(ANALYZE per cycle, HN-032).

## Retirement proof

Measurements on the real data size showing the unhinted planner is as fast for every timespan.

## Reversal plan

Remove the `INDEXED BY` clauses; keep ANALYZE. A one-line change per branch plus the test.
