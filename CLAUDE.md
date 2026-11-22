# CLAUDE.md — Project Governance & Definition of Done

## Project Summary

HackerNews aggregator: a Node.js/Express backend with a React frontend, deployed on a GCP e2-micro VPS via Docker behind the host-level shared Caddy reverse proxy. The backend scrapes Hacker News stories, stores them in SQLite, and serves them via a REST API. An integrated background worker (setInterval, 15-minute cycle) syncs new stories and updates scores. The frontend displays top stories with filtering by timespan and user-hidden stories. Users log in with local username/password accounts, created and reset manually via `scripts/users.js`. Development and operations are cloud-first: code changes deploy by merging to `master`, and production jobs (accounts, logs, backups, restore) run as the `ops.yml` GitHub Actions workflow started from a cloud session.

## Quick Reference Commands

```bash
# IMPORTANT: Use Node.js 24 (jose JWT library is compatible with all modern Node)
# If using Homebrew: PATH="/opt/homebrew/opt/node@24/bin:$PATH"

# Backend tests (uses in-memory SQLite — no credentials or network needed)
npm test

# Frontend tests
cd hackernews-frontend && npm test

# Run both
npm test && cd hackernews-frontend && npm test && cd ..

# Backend coverage
npm run test:coverage

# Frontend coverage
cd hackernews-frontend && npm run test:coverage && cd ..

# Backend lint
npm run lint

# Backend dev server
npm run watch

# Frontend dev server
cd hackernews-frontend && npm start

# Worker (standalone)
npm run worker

# Import JSON data to SQLite
npm run import

# Account admin on a local DB
npm run users -- list
npm run users -- set-password <username>

# Production jobs (cloud session → ops.yml → vps-1; results age-encrypted, see docs/OPERATIONS.md)
scripts/ops.sh health
scripts/ops.sh users-list
scripts/ops.sh users-set-password --user <username>   # generates the password
scripts/ops.sh logs --lines 200
scripts/ops.sh backups-list

# Database migrations
npm run migrate            # Run pending migrations
npm run migrate:rollback   # Roll back last migration
npm run migrate:status     # Show migration status
```

## Working with Toni (standing rules)

Copied from Toni's `~/.claude/CLAUDE.md`, which does not reach cloud sessions:

- When it is already clear what Toni wants, do it. Never ask whether to do it, how to do it, or which piece to do first, and never end a turn with a go-ahead question or "Yes, do it" button. Ask only for what only Toni can do (his accounts, devices, approvals) or a real product choice he hasn't made yet.
- Never end a turn while any item Toni asked for can still move forward without him. When one item is blocked (the Mac locked, something only he can do), go on to the next unblocked one; stop only when every item is done or truly blocked, and list just the Toni-only steps at the end.
- Live tests may write to Toni's real apps; every test removes what it made in its own teardown, even when it fails, and confirms the removal. Never leave test data behind.

## Working Style

- **One command at a time.** Never chain shell commands with `&&`, `||`, or `;`. Run each command as a separate Bash tool call. This makes output easier to read and debug.

## Cloud Sessions (claude.ai/code)

All development and operations happen in Claude Code cloud sessions; Toni's Mac is needed for nothing in this repo (there is no macOS-only work). Cloud sessions run on an Anthropic-hosted Ubuntu 24.04 VM (Node 20–22 preinstalled, Chrome at `$CHROME_PATH`, `age`, `jq` and `gcloud` installed; the Default environment's network is currently unrestricted). This file and `.claude/settings.json` load there; Toni's `~/.claude` does not (hence the standing rules above).

- **Setup is automatic.** The SessionStart hook in `.claude/settings.json` runs `scripts/cloud-setup.sh`, which does nothing unless `CLAUDE_CODE_REMOTE=true`. In the cloud it puts Node 24 (`.node-version`) on `PATH`, installing the official binary from the npm registry (`node-linux-x64`) when the VM lacks it, writes that `PATH` to `$CLAUDE_ENV_FILE` for later commands, and runs `npm ci` in the root and `hackernews-frontend/`, skipped when `node_modules` already matches the lockfile and Node version. Cold run ≈ 30–90 s, warm ≈ 0.1 s (measured on a real cloud VM 2026-11-22: Node v24.22.3, all backend and frontend tests pass, preview screenshots correct); the hook limit is 600 s. `$CLAUDE_ENV_FILE` is read by the harness and is not visible in later shells; check `node -v` instead. Rerun it by hand with `CLAUDE_CODE_REMOTE=true scripts/cloud-setup.sh` if `node -v` is not 24.
- **Tests, lint and build all run in the VM**: `npm test`, `npm run lint`, `cd hackernews-frontend && npm test`, `npm run lint`, `npm run build`. No credentials or network needed.
- **Run the app and look at it**: `scripts/preview.sh` builds the frontend, serves a seeded throwaway DB with a test account, and writes logged-out / logged-in / dark screenshots to `preview-shots/`, then stops the server and deletes the DB and account, even on failure. Open the PNGs with the Read tool. `PREVIEW_HOLD=1 scripts/preview.sh` keeps it running and prints the cookie; `scripts/screenshot.sh <url> <out.png> [--cookie token=…]` shoots any page. See [docs/TESTING.md](docs/TESTING.md#looking-at-the-running-app-screenshots).
- **Deploying = merging to `master`.** CI builds the image and pushes `ghcr.io/tonimelisma/hackernews:latest`; the server pulls it within ~5 minutes and rolls back if unhealthy (gotcha #14). A cloud session pushes the branch, opens a PR, and merges once CI is green. **Use `gh api` (REST), not `gh pr …`**: the cloud's GitHub proxy returns 403 for GraphQL, which `gh pr create/merge/comment` use (verified 2026-11-22). Open: `gh api repos/tonimelisma/hackernews/pulls -f title=… -f head=<branch> -f base=master -f body=…`; checks: `gh api repos/tonimelisma/hackernews/commits/<sha>/check-runs`; merge: `gh api -X PUT repos/tonimelisma/hackernews/pulls/<n>/merge -f merge_method=merge`; comment: `gh api repos/tonimelisma/hackernews/issues/<n>/comments -F body=@file`. "Automatically delete head branches" is on, so a merged branch disappears by itself. Smoke-check production after ~5 minutes with `curl -s "https://hackernews.melisma.net/api/v1/stories?timespan=Day&limit=1"` and `scripts/ops.sh health`. The proxy refuses git tags, releases, ref deletion and repo-settings writes; none are part of this repo's process.
- **Production jobs run in GitHub Actions, started from the session.** `scripts/ops.sh <job>` sends a `repository_dispatch` (`hn-ops`, which the proxy allows), `.github/workflows/ops.yml` reaches vps-1 as a GCP service account through Workload Identity Federation and the IAP tunnel (no stored keys; the proxy blocks port 22 anyway), and the results come back as an age-encrypted artifact that `scripts/ops.sh` downloads (`GET …/actions/artifacts/<id>/zip`, verified through the proxy 2026-11-22), decrypts with `HN_OPS_AGE_KEY` and deletes. Jobs: `users-list`, `users-add`, `users-set-password`, `users-revoke-sessions` (passwords generated in the workflow), `logs`, `health`, `db-stats`, `backup`, `backups-list`, `backups-download`, `restore` (needs `--confirm "restore <backup>"`). **The repo is public, so its workflow logs are too: they show only pass/fail and digits** (gotcha #20). Details: [docs/OPERATIONS.md](docs/OPERATIONS.md). Usable once the Owner setup below is done.
- **One secret in the environment: `HN_OPS_AGE_KEY`.** Cloud environment variables are readable by anyone using the environment; this one only decrypts ops results. The app itself needs no secrets for tests or previews (preview generates a random `SECRET`).

## Definition of Done

**This is a MANDATORY exit gate. You MUST run through every item below before considering any unit of work complete. Do not skip items. Do not defer them. If any gate fails, stop and fix it before finishing.**

You own this repo. You are the maintainer. There is no "someone else" — if there are uncommitted changes, failing tests, or stale docs, that's YOUR unfinished work from a previous session. You clean it up. Every iteration of work must end with the repo in a clean, working, documented state. No excuses.

### Mandatory Exit Checklist — run ALL gates before finishing:

1. **GATE: All tests pass.** Run both suites. If anything fails, stop and fix it.
   ```bash
   npm test
   cd hackernews-frontend && npm test
   ```
2. **GATE: Repo is clean and pushed.** `git status` shows no uncommitted changes. Commit and push. Always.
3. **GATE: Bugs get regression tests first.** When you find a bug, write a failing test that reproduces it *before* writing the fix. The test proves the bug exists and proves the fix works.
4. **GATE: All docs are updated.** Every iteration, review and update all documentation to reflect the current state of the code:
   - This file (`CLAUDE.md`) — architecture, gotchas, test counts
   - All files under `docs/` (see Documentation section below)
5. **GATE: No broken windows.** If you encounter a test failure, a stale doc, uncommitted changes, warnings, code smells, or inconsistent state — you fix it. It's your repo. There is no "someone else's problem." Never dismiss anything as "pre-existing noise" or "expected warnings." If it's in the output, you own it. Fix it or document exactly why it can't be fixed yet.
6. **GATE: Repo health checked.** Before finishing, run all of these (REST only: `gh pr list`/`gh run list` use GraphQL, which the cloud proxy refuses):
   - `gh api 'repos/tonimelisma/hackernews/pulls?state=open' --jq '.[] | [.number, .head.ref, .title] | @tsv'` — review open PRs; close stale ones with `gh api -X PATCH repos/tonimelisma/hackernews/pulls/<n> -f state=closed`
   - `gh api 'repos/tonimelisma/hackernews/actions/runs?branch=master&per_page=5' --jq '.workflow_runs[] | [.name, .conclusion, .head_sha[0:7]] | @tsv'` — CI must be green on master
   - `git fetch --prune origin` then `git branch -r` — merged branches delete themselves; list any other stale branch in your report (the proxy cannot delete branches)
   If CI is failing on master, that's YOUR broken build. Fix it first.
7. **GATE: Dependencies are up to date.** Run `npx npm-check-updates` in both root and `hackernews-frontend/`. If anything is outdated, update it (`npx npm-check-updates -u`, then `npm install`), run tests, and commit. No stale versions.

## Architecture Overview

```
hackernews/
├── app.js                  # Express app setup (middleware, routes, static files)
├── worker.js               # Background sync (syncOnce export, 15m loop)
├── bin/www                 # HTTP server bootstrap + SECRET validation + worker init
├── routes/api.js           # REST API routes (/stories, /hidden, /login, /logout, /me)
├── services/
│   ├── database.js         # SQLite singleton (getDb, setDb, initSchema → runs migrations)
│   ├── migrator.js         # Database migration runner (runMigrations, rollback, status)
│   ├── storyService.js     # Story + hidden-story queries
│   ├── userService.js      # users table (get/create/setPasswordHash/revokeSessions/list)
│   ├── auth.js             # scrypt password hashing + verifyCredentials
│   └── hackernews.js       # HN API client + story import/update
├── migrations/
│   ├── 001-initial-schema.js # Initial tables: stories, users, hidden + indexes
│   ├── 002-analyze-statistics.js # Runs ANALYZE so the planner picks the right index per timespan
│   └── 003-local-passwords.js # users.password_hash, token_version, created_at
├── util/
│   ├── config.js           # Environment config (limitResults)
│   ├── dbLogger.js         # Per-request DB operation & cache analytics logging
│   └── middleware.js        # Express error handlers
├── eslint.config.js        # ESLint flat config (backend)
├── Dockerfile              # Multi-stage Docker build (node:24-alpine)
├── docker-compose.yml      # Local only: CI image with the server's limits (the server's file is in the latchkey repo)
├── hackernews-frontend/    # React frontend (Vite + Vitest)
│   └── src/
│       ├── App.jsx         # Main component (stories, auth, filtering)
│       ├── hooks/
│       │   └── useTheme.js # System dark/light mode detection
│       ├── components/
│       │   ├── Story.jsx   # Single story card
│       │   └── StoryList.jsx # Story list with hidden filtering
│       └── services/
│           ├── storyService.js  # API client for stories/hidden
│           └── loginService.js  # API client for login/logout/me
├── scripts/
│   ├── import-json-to-sqlite.js # Import JSON → SQLite
│   ├── migrate.js              # CLI: node scripts/migrate.js [up|rollback|status]
│   ├── users.js                # CLI: node scripts/users.js [list|add|set-password|revoke-sessions]
│   ├── backup-sqlite.sh        # Daily SQLite backup to GCS
│   ├── ops.sh                  # Cloud session: run an ops job, download + decrypt its results
│   ├── cloud-setup.sh          # SessionStart hook: Node 24 + npm ci, cloud sessions only
│   ├── preview.sh              # Seeded throwaway app + screenshots, cleans up after itself
│   ├── seed-preview.js         # Sample stories + test account for preview.sh
│   └── screenshot.sh/.js       # Headless-Chrome screenshot (DevTools protocol)
├── .claude/settings.json   # SessionStart hook → scripts/cloud-setup.sh
├── ops/                    # Production jobs for ops.yml: workflow.js (validate, filter log), run.sh (runner), remote.sh (vps-1), age-recipient.txt
├── .github/workflows/ci.yml # CI (actionlint, tests) + image push to GHCR (the server pulls :latest itself)
├── .github/workflows/ops.yml # Production jobs on vps-1: repository_dispatch → WIF → IAP SSH, age-encrypted results
├── .husky/pre-commit       # Pre-commit hook (lint-staged)
└── docs/                   # LLM-geared documentation
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for process diagrams, data flow, and environment variables.

## Key Architectural Constraints & Gotchas

1. **SQLite lazy singleton + migrations**: `services/database.js` creates the SQLite connection on first use via `getDb()`. Enables WAL mode and foreign keys. On first use, runs pending migrations via `services/migrator.js`. `setDb()` allows test injection of `:memory:` databases. `initSchema()` is a wrapper around `runMigrations()` for backward compatibility. Schema changes go in numbered migration files (`migrations/NNN-name.js`).

2. **In-memory SQLite for tests**: Tests use `better-sqlite3` with `:memory:` databases via `setDb()` in `tests/setup.js`. No credentials, no network, no mocking of database modules. `clearDatabase()` truncates all tables between tests. Backend tests run in ~1 second.

3. **Worker testable via `syncOnce()`**: `worker.js` exports `syncOnce()` (one full sync cycle) and guards `main()` with `require.main === module`. Tests import `syncOnce()` directly with mocked `services/hackernews`. Worker is integrated into the Express process via `setInterval` in `bin/www`. Worker fetches ~1200 unique story IDs per cycle (`newstories` + `topstories` + `beststories`), batch limit 500. At the end of each cycle it runs `ANALYZE` to keep query-planner statistics fresh (see gotcha #18).

4. **Single SQL query for stories**: `getStories()` uses a single SQL query that handles time filtering, hidden story exclusion, score sorting, and pagination — all in one step. No client-side sorting, no multi-tier cache, no merge logic needed.

5. **Input validation**: The `/stories` endpoint doesn't validate timespan beyond a switch/default. The `/login` endpoint validates `{ username, password }` via `auth.isValidUsername()` (alphanumeric + `_-`, max 32 chars) and a 1–1024 char password. `/stories` optionally reads auth cookie for server-side hidden filtering.

6. **`getHidden` returns empty array for missing users**: If username doesn't exist in the database, `getHidden` returns `[]` (no hidden stories).

7. **jose replaces jsonwebtoken**: JWT auth uses `jose` (pure-JS, native CJS build, works on all modern Node versions). The old `jsonwebtoken` chain (`jwa` → `buffer-equal-constant-time`) accessed removed `SlowBuffer.prototype` and crashed on Node 25+. `jose` eliminated that constraint entirely — tokens are standard HS256 JWTs (same `SECRET`), so existing cookies keep working across the swap. `signToken(user)` in `routes/api.js` signs `{ username, tv }` with `alg: HS256`, `iat`, and 365-day `exp`; `jwtVerify()` checks expiry (see gotcha #19 for `tv`). `jose` v6 is ESM-only: the app loads it via Node 24's native `require(esm)`, but Jest needs `--experimental-vm-modules`, which the `test`/`test:coverage` npm scripts set through `NODE_OPTIONS` (bare `npx jest` fails `api.test.js`). **Use Node.js 24.**

8. **Server-side hidden story filtering**: `GET /stories` optionally reads the auth cookie via `optionalAuth()`. If authenticated, fetches hidden IDs and passes them to `getStories()` which excludes them via SQL `WHERE id NOT IN (...)`. Anonymous users are unaffected.

9. **react-virtuoso for story lists**: `StoryList.jsx` uses `<Virtuoso useWindowScroll>` to render only visible stories from up to 500 items. Tests mock `react-virtuoso` to render all items synchronously.

10. **Hidden stories are server-side only**: Hiding stories requires login. The server filters hidden stories via SQL `WHERE id NOT IN (...)` before returning results. The hide button only appears for logged-in users. When a story is hidden, it's optimistically removed from the client-side `stories` array (with rollback on POST failure). No client-side hidden filtering or localStorage persistence. Stories are re-fetched on login/logout to reflect server-side filtering changes.

11. **Timespan localStorage persistence**: Selected timespan filter persists via `localStorage` (`timespan` key) as `{ value, timestamp }`. On page load, restores the saved value if the timestamp is less than 3 hours old; otherwise defaults to "Day". Saved on every timespan change via `useEffect`.

12. **Dark mode via system preference**: Bootstrap 5.3's `data-bs-theme` attribute on `<html>`. A synchronous `<script>` in `index.html` sets the attribute before first paint (no flash). `useTheme` hook listens for live OS changes. No manual toggle — system detection only.

13. **Static file caching strategy**: `index.html` served with `Cache-Control: no-cache`; hashed `/assets/*` files served with `max-age=1y, immutable`.

14. **Docker deployment — CI builds and pushes, the server pulls**: Multi-stage `Dockerfile` (node:24-alpine). The CI `image` job builds linux/amd64 with buildx and pushes `ghcr.io/tonimelisma/hackernews:<sha>` + `:latest` (public package). There is no deploy job and no deploy secret: since 2026-11-21 the shared server (it also runs the Latchkey relay) accepts SSH only through Google's IAP tunnel, and a systemd timer there (`latchkey-update-apps`, every 5 minutes) pulls `:latest`, restarts the app when the image changed, and goes back to the previous image if the new one isn't healthy within 5 minutes. **CI must keep pushing `:latest`**, or production never updates (guarded by `tests/unit/compose.test.js`). **The server's compose file is not this repo's**: it is a fixed file in the latchkey repo (`deploy/server/host/hackernews-compose.yml`), so a push here changes the app but never the container's limits. It runs the app as **uid 1000 (`node`) with all capabilities dropped and `no-new-privileges`**, on its own Docker network `hackernews-front` (alias `hackernews-app`) shared only with Caddy. **The app must keep working as that non-root user, writing only to `/data` and `/tmp`.** The image's `/data` belongs to `node` and it runs as `USER node`: a fresh volume takes `/data`'s owner from the image, and when it was root-owned the app crashed as uid 1000 with `SQLITE_READONLY_DIRECTORY` (guarded by `tests/unit/dockerfile.test.js`). `/opt/hackernews` on the server is no longer a git checkout; the nightly backup script runs from its existing copy there. This repo's `docker-compose.yml` is for local use only: the CI image with the server's limits (`docker-compose.dev.yml` builds from source). Never build on the server: on 2026-09-29 an on-box build saturated the 30 GB `pd-standard` disk (94% util, 88% iowait). SQLite data lives in the `sqlite-data` volume (the image's baked DB is empty when built in CI). Graceful shutdown via SIGTERM/SIGINT handlers in `bin/www`.

15. **Daily SQLite backup**: `scripts/backup-sqlite.sh` runs SQLite `.backup` inside the container, compresses with gzip, and uploads to `gs://hackernews-melisma-backup/` with `curl` + the VM service account's metadata-server token (no `gcloud` on the box — the snap was removed). Cron job (user `tonimelisma`) at 3:00 AM UTC daily, appending to `/var/log/hackernews-backup.log`. **That log file must exist and be owned by `tonimelisma`**: the shell evaluates the `>>` redirect before running the script, so when the file could not be created (`/var/log` is root-writable only) the job silently never ran — no scheduled backup from at least 2026-02-20 until the 2026-09-29 fix. Keeps the newest 30 objects. ~32 MB compressed per backup, well within GCP Always Free 5 GB.

16. **CSP uses script hash (not unsafe-inline)**: The inline dark mode script in `index.html` is allowed via `'sha256-8y8P8Mwo9xa1B5mBjxyt9mk3G0AxFcNMDqIEmr6vUkQ='` in the CSP `script-src` directive. If the inline script content changes (even whitespace), the hash must be recomputed and updated in `app.js`.

17. **Database migration system**: `services/migrator.js` reads numbered `.js` files from `migrations/`, runs pending `up()` functions in transactions, and tracks applied migrations in `schema_migrations` table. `rollbackMigration()` runs `down()` and removes the record. CLI: `node scripts/migrate.js [up|rollback|status]`. New schema changes must be added as new migration files (e.g., `migrations/004-add-column.js`). **The `Dockerfile` runtime stage MUST `COPY migrations ./migrations`** — without it, `loadMigrationFiles()` finds nothing in the container and `runMigrations()` silently runs zero migrations (`schema_migrations` stays empty). This was broken in prod until 2026-06-27; guarded by `tests/unit/dockerfile.test.js`.

18. **Query-planner statistics are mandatory (ANALYZE)**: `getStories` runs `WHERE time > ? ORDER BY score DESC LIMIT 500`, which no single index satisfies. Without `sqlite_stat1` stats the planner always scans `idx_stories_score` and filters by time, which is pathological for the *selective* "Day" window (few hundred matches scattered across 150k+ rows) — measured at ~125 ms median / **27 s worst case** on production, and since `better-sqlite3` is synchronous that freezes the whole process. `migrations/002-analyze-statistics.js` runs `ANALYZE`; the worker re-runs it each cycle (~70 ms). **Read path:** `getStories` forces `INDEXED BY idx_stories_time` for Day–Month and `INDEXED BY idx_stories_score` for Year/All — Month score scans hit **16 s** when top scores fall outside the window; Year time scans hit **14–17 s** because ~89% of rows match. See [docs/DATABASE.md](docs/DATABASE.md#query-planner-statistics-analyze).

19. **Local password accounts (no HN involvement)**: `POST /login` takes `{ username, password }` and checks an scrypt hash in `users.password_hash` (`services/auth.js`; format `scrypt$N$r$p$salt$key`, OWASP N=2^14/r=8/p=5 — **not** N=2^17, which needs 128 MiB per hash and pushed the 1 GB e2-micro into swap at 3.4 s/hash). No signup/reset endpoints: accounts are managed with `scripts/users.js` (`list`, `add`, `set-password`, `revoke-sessions`) run in the container by the ops workflow (`scripts/ops.sh users-…`) — the Dockerfile must `COPY scripts` (guarded by `tests/unit/dockerfile.test.js`). Sessions: JWT carries `tv` = `users.token_version`; every authenticated request loads the user row and rejects the cookie if the user is gone or `tv` mismatches. **Cookies without `tv` (issued in the HN-proxy era) count as `tv: 0` — do not remove that default or pre-migration sessions get logged out.** Each browser has an independent cookie, so simultaneous sessions just work; `set-password` deliberately leaves `token_version` alone (no logout), `revoke-sessions` bumps it (logs out every browser). Login never creates users, and neither does `upsertHidden`. Unknown users / NULL passwords hash against a dummy for uniform timing.

20. **Ops workflow logs are public (this repo is public)**: `.github/workflows/ops.yml` may print only pass/fail and the digits-only `HN_OPS_SUMMARY k=<n> …` line, which `ops/workflow.js` filters by regex. Everything else (user list, log lines, error messages, generated passwords, backups) goes into `$WORK/out`, which `ops/run.sh` tars and encrypts with `age` to `ops/age-recipient.txt` and deletes before the upload step; the artifact keeps only `hn-ops.tar.age` for 1 day. Request values are read from `$GITHUB_EVENT_PATH`, never interpolated into `env:` or `run:` (both are printed in the log, and `${{ }}` in `run:` is script injection); usernames are `::add-mask::`ed and accepted only via `repository_dispatch` (`workflow_dispatch` inputs show on the run page). Passwords go to `users.js` on stdin, which is why `remote.sh` travels base64-encoded inside the ssh command. `repository_dispatch` runs `master`'s copy of the workflow, so ops changes take effect only after merge. All guarded by `tests/unit/ops.test.js` and `tests/unit/opsRun.test.js`; every action in every workflow is pinned to a full SHA (also tested), and CI runs actionlint + shellcheck.

## Documentation

All of these must be kept current with every change:

- [Architecture](docs/ARCHITECTURE.md) — system overview, directory structure, data flow, environment variables
- [API Reference](docs/API.md) — REST endpoints, request/response formats
- [Database Schemas](docs/DATABASE.md) — SQLite tables, indexes, query patterns
- [Testing Guide](docs/TESTING.md) — test architecture, mocks, running tests, technical details
- [Operations](docs/OPERATIONS.md) — production jobs via `ops.yml` + `scripts/ops.sh`, public-log rules, Owner setup

## Test Counts

| Suite | Tests |
|-------|-------|
| Backend unit (middleware, config, hackernews, database, dbLogger, migrator, dockerfile, compose, cloudSetup, auth, ops, opsRun) | 124 |
| Backend integration (storyService, api, worker, users) | 113 |
| Frontend component (App, StoryList, Story) | 39 |
| Frontend hook (useTheme) | 4 |
| Frontend service (storyService, loginService) | 7 |
| **Total** | **287** |

## Project Health

**Overall: A** — Working application deployed at https://hackernews.melisma.net with solid test coverage, good documentation, simplified architecture (SQLite), automated Docker deployment, daily backups to GCS.

| Category | Grade | Summary |
|----------|-------|---------|
| Functionality | A- | Core features work; dead scraper code removed |
| Security | A | Helmet (CSP with script hash), CORS, per-IP login rate limiting, local scrypt password hashes (no third-party credentials handled), JWT in HTTP-only cookie (jose) with server-side revocation (`token_version`), timing-uniform login, SECRET validation; ops jobs use keyless WIF and publish only digits, with results age-encrypted |
| Testing | A- | 287 tests, in-memory SQLite, ~3s backend runs |
| Code Quality | A- | Clean codebase, dead code removed, SQLite simplification |
| Architecture | A- | SQLite eliminates all Firestore hacks (L2 cache, patchStoryCache, Day-merge, padId, stripUndefined) |
| Documentation | A- | CLAUDE.md + 4 reference docs, all updated |
| DevOps / CI | A- | Docker app behind shared Caddy reverse proxy on VPS (live), GitHub Actions CI/CD (image built in CI → public GHCR `:latest`; the server pulls it every 5 minutes with health-check rollback), npm audit, ESLint (backend + frontend), actionlint + shellcheck, SHA-pinned actions, pre-commit hooks, daily GCS backups, production jobs as the `ops.yml` workflow (WIF, no stored keys) |
| Performance | A- | Sub-ms SQL queries, react-virtuoso |
| Dependencies | A- | All at latest (2026-11-22); 0 production or frontend vulnerabilities; 5 low dev-only (`deepmerge` via Jest, no patch exists) |

### Open Issues

- None — the `jsonwebtoken`/`SlowBuffer` Node 25+ crash was resolved by migrating to `jose` (2026-08).

### Vulnerability Status

- Backend production: **0 vulnerabilities** — `npm audit --omit=dev` enforced in CI at `moderate` level
- Backend dev: **5 low, unfixable** — `deepmerge` ≤4.3.1 (GHSA-gcqx-w48m-w2h4, no patched release exists) via `jest-config`; dev-only, and it only merges Jest's own config, never request data. `glob`/`minimatch` advisories are cleared via `overrides` (see Key Learnings)
- Frontend: **0 vulnerabilities** — `npm audit` enforced in CI at `moderate` level (Vite replaced CRA); needs the `minimatch` override

## Backlog

- None open.

## Owner Setup

Steps only Toni can do. Until 1–3 are done, `ops.yml` fails at its first GCP or encryption step and uploads nothing; everything else in the repo works without them. Details: [docs/OPERATIONS.md](docs/OPERATIONS.md#owner-setup).

1. **GCP Workload Identity Federation**: run `deploy/gcp-wif-setup.sh` in the latchkey repo. It must trust GitHub OIDC for `tonimelisma/hackernews` only and give this repo's service account IAP tunnel access + OS Login admin on vps-1, `roles/compute.viewer`, `roles/iam.serviceAccountUser` on the VM's service account, and `roles/storage.objectViewer` on `gs://hackernews-melisma-backup`.
2. **Repository variables** (Actions → Variables, not secrets): `GCP_WIF_PROVIDER` (full provider resource name) and `GCP_SA_EMAIL`. No repository secrets are needed.
3. **age key**: on the Mac, `brew install age` and `age-keygen`; put the `AGE-SECRET-KEY-1…` line in the claude.ai cloud environment as `HN_OPS_AGE_KEY`. A cloud session then runs `scripts/ops.sh recipient`, commits `ops/age-recipient.txt` and merges it.
4. **Cloud network** (only if the environment is ever limited; it is unrestricted now): allow `hackernews.melisma.net` (smoke checks) and, for local image builds, `registry-1.docker.io`, `auth.docker.io`, `production.cloudfront.docker.com`, `dl-cdn.alpinelinux.org`.

Then verify from a cloud session: `scripts/ops.sh health`, `scripts/ops.sh db-stats`, `scripts/ops.sh users-list`, `scripts/ops.sh logs --lines 50`, `scripts/ops.sh backups-list` (all read-only).

## Budget

**Hard $0/month.** Everything runs on free tiers: GCP Always Free e2-micro + 30 GB pd-standard, GCS free tier for backups, GitHub Actions (free for this public repo), public GHCR package. Never add paid infrastructure (faster disks, bigger VMs, paid services) — fix performance by reducing on-box work and footprint instead.

## Key Learnings

- **SQLite eliminates Firestore architectural hacks**: Moving from Firestore to SQLite removed: L2 cache, patchStoryCache, mergeStories, Day-merge, padId, stripUndefined, MAX_QUERY_DOCS buffer, cacheDocToStories, storiesToCacheDoc, CACHE_TTLS, environment-prefixed collections, subcollection pattern for hidden stories, batched operations (BATCH_SIZE=20). A single SQL query (`WHERE time > ? AND id NOT IN (...) ORDER BY score DESC LIMIT ? OFFSET ?`) replaces ~200 lines of cache/merge/filter logic.
- **jose replaces jsonwebtoken (the SlowBuffer fix)**: `jsonwebtoken` → `jwa` → `buffer-equal-constant-time` accessed removed `SlowBuffer.prototype` at require time, crashing Node 25+. Swapped to `jose` — same HS256 JWT standard, same `SECRET`, so deployed cookies keep verifying. Started on v5 (CJS build); upgraded to the ESM-only v6 in 2026-10. Node 24 `require()`s ESM natively, so app code is unchanged; Jest's module runtime does not, unless `--experimental-vm-modules` is on, so the backend test scripts set it (plus `--disable-warning=ExperimentalWarning` to keep the output clean). No Babel transform needed. The old test mock of `jsonwebtoken` was removed — the API tests now sign/verify real JWTs with `jose`. Use Node.js 24.
- **Vitest mock differences**: `vi.mock()` factory must return an object with `default` key for default exports. No `__esModule: true` needed. Axios mock: `vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }))`.
- **Node.js 22 localStorage conflict**: Node.js 22's built-in `localStorage` (experimental) conflicts with jsdom in Vitest. Must stub localStorage with `vi.stubGlobal("localStorage", mockImpl)` in tests that use it.
- **Rate limiter state persists across tests** — rate-limit test must be last in its describe block.
- **`bin/www` for startup checks**: SECRET validation lives in `bin/www` (not `app.js`) so tests can `require('../../app')` without triggering exit. Database initialization and worker startup also live in `bin/www`.
- **jsdom lacks `window.matchMedia`**: Must stub in `setupTests.js` (global) for any component using `useTheme`. Tests that need specific matchMedia behavior reassign `window.matchMedia` in `beforeEach`.
- **Logging convention**: `console.error` for errors (catch blocks), `console.log` for operational info (startup, sync progress). `tests/setup.js` suppresses both globally. Per-request DB analytics use `[db]`-tagged structured log lines via `util/dbLogger.js` — tracks per-table reads/writes, L1/MISS cache metrics, and latency. `[db-query]` inline logs show individual query details with row counts and timing.
- **Pre-commit hooks**: husky + lint-staged run `eslint --fix` on staged `.js` files. Backend ESLint config ignores `hackernews-frontend/`; the frontend has its own flat ESLint config (`hackernews-frontend/eslint.config.js`) run via `cd hackernews-frontend && eslint --fix`.
- **Bootstrap 5 data attributes**: Use `data-bs-toggle`/`data-bs-dismiss` (not `data-toggle`/`data-dismiss`). Class `dropdown-menu-right` was renamed to `dropdown-menu-end`.
- **`errorHandler` must not call `next()`**: Calling `next(error)` after `res.status().json()` triggers "headers already sent" errors if another error handler exists downstream.
- **Vite build output**: `build.outDir` set to `"build"` in `vite.config.js` to match Express static path in `app.js`. `build/` is gitignored. `build.rolldownOptions.output.codeSplitting` splits `react` and `vendor` (all other `node_modules`) into their own chunks — keeps every chunk under Vite's 500 kB warning (the single bundle hit 524 kB in 2026-09) and lets browsers keep vendor code cached across app-only deploys. CSP `script-src 'self'` covers the extra same-origin chunks.
- **npm `allowScripts` (npm ≥ 11.19)**: npm now flags dependency install scripts that aren't approved. Both `package.json` files list approved packages by *unversioned* name (`"better-sqlite3": true`, …) — `npm install-scripts approve` writes `name@version` keys, which go stale on every bump, so unpin them. `better-sqlite3` is the one that matters: its install script builds the native SQLite binding (locally and in the Docker image). Check with `npm install-scripts ls`.
- **JWT/cookie expiry and refresh**: JWT and cookie both expire after 365 days. `GET /me` issues a fresh JWT+cookie on each call (rolling refresh). Since the frontend calls `getMe()` before fetching stories on every page load, active users are effectively never logged out and the nav never flashes the wrong logged-out state first. Tokens survive deployments as long as the `SECRET` env var in the VPS `.env` file stays the same.
- **HN blocks proxied logins from datacenter IPs (why local accounts exist)**: Login used to POST the user's credentials to `news.ycombinator.com/login` and treat a final `/news` path as success and `/login` as bad credentials. By 2026-09 HN answered every login from the GCP VPS IP with a "Validation required" reCAPTCHA page — which also lands on `/login` — so every login failed as "wrong password" while the same credentials worked in a browser. Diagnosed by probing from inside the container with a fake account and inspecting the body (a plain GET of `/login` was *not* challenged; only the POST). Lesson: a redirect-path heuristic cannot tell "bad password" from "bot wall"; inspect the response body before trusting an auth outcome, and don't build auth on a third party's login form. Replaced with local accounts (gotcha #19); usernames — and therefore all hidden history — carried over unchanged, and existing cookies stayed valid via the `tv`-defaults-to-0 rule.
- **npm `overrides` for transitive advisories (2026-10)**: GHSA-g3hv-75wg-m249 marks all `minimatch` <11.0.1 vulnerable, but `eslint` 10 pins `^10.2.6`. That failed the frontend CI gate (`npm audit --audit-level=moderate`, dev deps included) with "No fix available". Both `package.json` files force `"minimatch": "^11.0.1"`; the backend also forces `"glob": "^14.0.2"` (GHSA-3g3m-2fjr-6pw4, via Jest's `test-exclude`). ESLint, Jest and coverage all work on the newer majors. Drop each override once upstream ranges catch up: check with `npm ls minimatch glob --all`.
- **Bootstrap `data-bs-auto-close="outside"`**: Prevents dropdown from closing on clicks inside the menu (e.g., login form). Without it, clicking the Login button closes the dropdown before the user sees the result.
- **react-virtuoso for list virtualization**: `<Virtuoso useWindowScroll data={...} itemContent={...} />` renders only visible items. In tests, mock with a simple `({ data, itemContent }) => data.map(...)` to render all items synchronously. Must mock in every test file that renders a component using Virtuoso (both StoryList.test.jsx and App.test.jsx).
- **Hidden stories are server-side only**: Hiding requires login. Server filters via SQL, client optimistically removes from `stories` array. No localStorage hidden persistence. Stories re-fetched on login/logout state change.
- **SQLite WAL mode**: Enabled via `db.pragma("journal_mode = WAL")` for concurrent read/write support. Important for the integrated worker running alongside the Express server.
- **In-memory SQLite for tests**: `better-sqlite3` with `new Database(":memory:")` via `setDb()`. No moduleNameMapper needed. `clearDatabase()` runs `DELETE FROM` on all tables. Tests complete in ~1 second.
- **CSP script hash**: `'unsafe-inline'` replaced with SHA-256 hash of the inline dark mode script in `index.html`. Hash must be recomputed if the script content changes. Use: `python3 -c "import hashlib, base64; ..."` or `openssl dgst -sha256 -binary | openssl base64`.
- **Database migration system**: `services/migrator.js` handles versioned schema migrations. Each migration file exports `up(db)` and `down(db)`. Migrations run in transactions. `initSchema()` in `database.js` is now a wrapper around `runMigrations()`. Migration tests use their own in-memory databases (not shared test setup).
- **Dockerfile must copy `migrations/`**: The runtime stage copied `bin/routes/services/util` but not `migrations/`, so `loadMigrationFiles()` found nothing in the container and `runMigrations()` ran zero migrations — `schema_migrations` stayed empty and the migration system was silently inert in prod (discovered 2026-06-27 when migration 002 didn't apply on deploy). The tables existed only because `import-json-to-sqlite.js` bakes them into the image. Fix: `COPY migrations ./migrations`. Lesson: anything `services/*` loads from disk at runtime (here, a sibling dir via `__dirname/../migrations`) must be in the final image — verify by checking `schema_migrations` is populated after deploy, not just that the app boots.
- **ANALYZE drives index choice (the inverse-latency bug)**: Profiling prod (152k rows) showed the *fewest-matches* timespan was the *slowest*: "Day" ran ~125 ms median / 27 s worst, while "All" ran ~2 ms. Cause: no `sqlite_stat1` stats existed, so the planner always scanned `idx_stories_score` top-down and filtered `time > ?` row-by-row, clawing through the whole table to find a few hundred recent rows. A one-time `ANALYZE` (migration 002) lets the planner pick `idx_stories_time` for selective windows and `idx_stories_score` for broad ones — every timespan dropped to ≤7 ms median. Refresh stats periodically (worker does it each cycle) as the table grows. Lesson: with a time-filter + different-column sort + LIMIT, accurate stats matter more than adding indexes. Profile with `process.hrtime.bigint()` around `stmt.all()` and `EXPLAIN QUERY PLAN`, not wall-time.
- **`stories.time` is milliseconds, not HN's seconds**: `hackernews.js` stores `storyData.time * 1000`, and `getStories` compares against `Date.now()`. Anything that writes stories by hand (fixtures, `scripts/seed-preview.js`) must use ms. The first preview seeder wrote seconds, so every story looked 55 years old and the "Day" page rendered empty with no error (guarded by `tests/unit/cloudSetup.test.js`).
- **Cloud sessions need Node 24 from the npm registry**: the claude.ai/code VM ships Node 20–22, and its "Limited" network allows npm and GitHub but not necessarily nodejs.org. `scripts/cloud-setup.sh` installs `node-linux-x64@24` (the official binary, republished on npm) into `~/.cache/hackernews-node24` and exports its `PATH` through `$CLAUDE_ENV_FILE`. The VM's own `npm` then runs on Node 24, because npm's shebang resolves `node` from `PATH`.
- **Slow CPUs expose timing bugs (Linux x86 emulation, 2026-11-21)**: under `docker --platform linux/amd64` on the Mac, App tests printed 14 "not wrapped in act(...)" warnings that never show on the Mac. Two causes: waiting only for a mock to be *called* leaves its promise's `setState` outside `act` (fix: `act(() => mock.mock.results.at(-1).value)`), and a plain `fireEvent.click` leaves `handleLogin`'s post-`await` updates outside it (fix: `await act(async () => fireEvent.click(...))`). The screenshot helper first used a fixed sleep and later network idle alone; both captured spinners. It now waits for network idle *and* no `.spinner-border`.
