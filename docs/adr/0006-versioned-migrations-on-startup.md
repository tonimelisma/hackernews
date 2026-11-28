# 0006. Versioned migrations, applied on startup

- Status: accepted
- Date: 2026-11-27 (recorded)

## Context and problem

The schema changes over time (statistics, local passwords) and the image must bring any existing
database file up to date without a separate deployment step (HN-035 to HN-037).

## Decision drivers

- A fresh volume and an old database both end at the current schema on start.
- Each change is reversible and tested.

## Considered options

### Schema created in code, changes by hand

- Good: nothing to maintain.
- Bad: no record of what a database has; manual steps on every host.

### Numbered migration files, run on first database use

- Good: `schema_migrations` records what ran; each `up`/`down` runs in a transaction.
- Bad: migration files must be in the image.
- Failure modes: without `migrations/` in the image the runner finds nothing and silently applies
  zero migrations; this happened once and went unnoticed until a migration did not apply.

## Decision

`services/migrator.js` runs pending `migrations/NNN-name.js` files in order on first `getDb()`,
each in a transaction, recording them in `schema_migrations`; `rollbackMigration()` runs `down()`
and removes the record; `scripts/migrate.js` is the CLI. The Dockerfile copies `migrations/`.

## Consequences

Schema changes are new migration files, never edits to applied ones. After a release, check that
`schema_migrations` is populated, not just that the app boots (`scripts/image-smoke.sh` does).

## Confirmation

`tests/unit/migrator.test.js`, `tests/unit/database.test.js` (HN-035 to HN-037);
`tests/unit/dockerfile.test.js` "copies the migrations directory into the runtime image";
`scripts/image-smoke.sh` requires every migration file recorded (HN-065).

## Retirement proof

A different storage engine with its own schema management (would supersede ADR 0001 too).

## Reversal plan

Not expected; migrations would be replaced together with the storage engine.
