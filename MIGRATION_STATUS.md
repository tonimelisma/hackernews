# MongoDB → Firestore Data Migration Status

## Migration Complete (Feb 13, 2026)

All data has been successfully migrated from MongoDB to Firestore.

| What | Count | Status |
|------|-------|--------|
| Stories in prod Firestore | 19,996 | Complete |
| Users in prod Firestore | 1 | Complete |
| Hidden story records | 3,559 | Complete |

### Verification

Audit confirmed exact match between exported data and Firestore:
- Stories: 19,996/19,996
- Users: 1/1
- Hidden: 3,559/3,559
- Smoke tests: 8/8 passed

### Quota Usage (Day 4)

| Operation | Reads | Writes |
|-----------|-------|--------|
| Import users + hidden (`--users-only`) | 0 | 3,560 |
| Import stories (`--stories-only --no-dedup`) | 0 | 596 |
| Audit (`count()` aggregation) | ~25 | 0 |
| Smoke tests | 5 | 4 |
| **Total** | **~30** | **~4,160** |

## Migration Timeline

### Day 1 (Feb 10, 2026)
- Imported 19,400 of 19,996 stories before hitting 20K write limit
- Zero users or hidden records imported

### Day 2 (Feb 11, 2026)
- Enhanced import script with budget controls (`--dry-run`, `--max-writes`, `--users-only`, `--stories-only`, progress tracking)
- Imported 1 user and 2,900 of 3,559 hidden records
- Burned both read and write quotas

### Day 3 (Feb 12, 2026)
- Added `--limit` flag, tested 100-story import against dev
- Created `npm run test:firestore` smoke tests (50 read/50 write cap)
- Fixed Bootstrap 5 UI regressions
- Added query optimization with `.limit(500)` and tiered TTL cache
- Read quota exhausted from unoptimized browsing

### Day 4 (Feb 13, 2026)
- Added `--no-dedup` flag (eliminates 19K reads from `getExistingDocIds`)
- Replaced audit `countCollection()` with `count()` aggregation (~25 reads vs ~23K)
- Improved retry handler (catches INTERNAL/UNAVAILABLE gRPC errors)
- Completed migration: 3,560 user writes + 596 story writes = 4,156 total
- Audit verified 100% data match
- Smoke tests passed 8/8

## Key Lessons Learned

1. **`getExistingDocIds` was the hidden quota killer** — reading every doc ID for dedup cost 19,400+ reads per run, making even dry-runs expensive
2. **`count()` aggregation** bills 1 read per 1,000 docs (vs 1 read per doc with `.select().get()`)
3. **`batch.set()` is idempotent** — dedup is unnecessary when overwriting is acceptable
4. **Query optimization is critical** — unoptimized `getStories()` read ALL 19,996 docs per API call; adding `.limit(500)` + TTL cache made the app viable on the free tier
5. **Retry handlers must cover transient gRPC errors** — not just RESOURCE_EXHAUSTED (code 4), but also INTERNAL (code 13) and UNAVAILABLE (code 14)

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/export-from-mongodb.js` | Export MongoDB → local JSON |
| `scripts/import-to-firestore.js` | Import JSON → Firestore (`--dry-run`, `--max-writes`, `--users-only`, `--stories-only`, `--limit`, `--no-dedup`) |
| `scripts/audit-firestore.js` | Read-only audit using `count()` aggregation |
