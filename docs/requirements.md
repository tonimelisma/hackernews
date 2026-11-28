# Requirements

What the app does today. Each requirement is one EARS sentence with a stable `HN-NNN` ID, marked
`[verified]` when a test carries `Validates: HN-NNN`, or `unverified:` with the reason. Future work
lives in GitHub issues. `script/process-check` enforces the format.

## Stories

- **HN-001** When a client requests `GET /api/v1/stories` with a timespan of Day, Week, Month or
  Year, the server shall return only stories posted in the last 24 hours, 7 days, 28 days or
  365 days. [verified]
- **HN-002** If the timespan is missing or not a known value, then the server shall return stories
  of all time. [verified]
- **HN-003** The server shall return stories sorted by score, highest first, paginated by `limit`
  and `skip`. [verified]
- **HN-004** If `limit` is missing, zero or negative, then the server shall return up to the
  configured maximum of 500 stories. [verified]
- **HN-005** While a request carries a valid session cookie, the server shall leave that user's
  hidden stories out of `GET /stories`, and without one it shall return every matching story.
  [verified]
- **HN-006** When Year or All is requested, the server shall return the top-scoring stories of the
  whole window, even when the window holds more stories than the limit. [verified]
- **HN-007** The story query shall use the time index for Day, Week and Month and the score index
  for Year and All ([ADR 0005](adr/0005-query-planner-statistics-and-index-hints.md)). [verified]
- **HN-008** Each story returned shall carry its id, author, title, URL (absent for self-posts),
  score, comment count and time as a date. [verified]
- **HN-009** If handling a request throws, then the server shall respond 500 with an error message
  and log the error. [verified]
- **HN-010** When a client requests an unknown endpoint, the server shall respond 404. [verified]

## Hidden stories

- **HN-011** When an authenticated user posts a story ID to `/api/v1/hidden`, the server shall add
  it to that user's hidden list once, without creating a user row. [verified]
- **HN-012** If the posted hidden ID is missing, not an integer or negative, then the server shall
  respond 400. [verified]
- **HN-013** When an authenticated user requests `GET /api/v1/hidden`, the server shall return that
  user's hidden IDs, or an empty list when there are none. [verified]
- **HN-014** If a request to `/hidden` or `/me` has no token, an invalid token or a token without a
  username, then the server shall respond 401. [verified]

## Accounts and sessions

- **HN-015** When `POST /api/v1/login` has a valid username and its correct password, the server
  shall return the username and set an httpOnly cookie holding an HS256 JWT with the username and
  the user's token version, expiring in 365 days. [verified]
- **HN-016** If the password is wrong, the user is unknown, or the user has no password yet, then
  the server shall respond with the same 401. [verified]
- **HN-017** The server shall never create a user on login or when a story is hidden. [verified]
- **HN-018** If a login fails, then the server shall log the outcome without the username or
  password. [verified]
- **HN-019** If one client IP makes more than 10 login attempts in 15 minutes, then the server
  shall respond 429 to that IP while other IPs can still log in. [verified]
- **HN-020** If an internal error occurs during login, then the server shall respond 500.
  [verified]
- **HN-021** When `POST /api/v1/logout` is called, the server shall clear that browser's cookie
  only, leaving the user's other sessions logged in. [verified]
- **HN-022** When an authenticated client requests `GET /api/v1/me`, the server shall return the
  username and issue a fresh cookie, upgrading a cookie that has no token version. [verified]
- **HN-023** If a session's user no longer exists or its token version differs from the user's,
  then the server shall reject it; a token without a version counts as version 0. [verified]
- **HN-024** The server shall store passwords only as salted scrypt hashes (N=2^14, r=8, p=5) and
  reject a tampered or malformed hash. [verified]
- **HN-025** The server shall accept usernames of 1–32 letters, digits, `_` and `-`, and new
  passwords of 8–1024 characters. [verified]
- **HN-073** If a login body lacks a valid username or a password string of 1–1024 characters,
  then the server shall respond 400. [verified]
- **HN-026** When `scripts/users.js list` runs, it shall list every account with its password state
  and hidden-story count. [verified]
- **HN-027** When `scripts/users.js add` runs, it shall create the account with a hashed password,
  refusing an existing account, an invalid username, a too-short password or a mismatched
  confirmation. [verified]
- **HN-028** When `scripts/users.js set-password` runs, it shall set the password while keeping
  the token version and hidden history; when `revoke-sessions` runs, it shall bump the token
  version; either fails for an unknown account. [verified]
- **HN-029** If the login user is unknown or has no password, then the server shall still hash the
  given password, so the response time does not reveal which accounts exist.
  unverified: timing is not measured by any test; the code path is covered by HN-016's tests.

## Background sync

- **HN-030** When a sync cycle runs, the worker shall fetch the new, top and best story IDs from
  the Hacker News API, deduplicate them, and add the stories missing from the database. [verified]
- **HN-031** When a sync cycle runs, the worker shall refresh the scores of stories from the last
  28 days not updated in 48 hours, the last 7 days not updated in 6 hours, and the last 24 hours
  not updated in 1 hour, at most 500 per tier. [verified]
- **HN-032** When a sync cycle ends, the worker shall run `ANALYZE`. [verified]
- **HN-033** If the Hacker News API fails, then the client shall return no IDs or items instead of
  throwing. [verified]
- **HN-034** While the server runs and `DISABLE_WORKER` is not `true`, it shall run a sync cycle at
  start and every 15 minutes in the same process.
  unverified: `bin/www` is not under test; `scripts/preview.sh` runs with the worker disabled.

## Database

- **HN-035** When the database is first used, the server shall apply pending migrations in order,
  each in a transaction, and record each in `schema_migrations`. [verified]
- **HN-036** When a migration is rolled back, the migrator shall run its `down` step and remove its
  record. [verified]
- **HN-037** When migration 003 runs, it shall keep existing users, with no password and token
  version 0, and their hidden history. [verified]
- **HN-038** The server shall log one `[db]` line per request with per-table reads, writes and
  cache counts, and `[db-query]` lines with each query's rows and time. [verified]

## Web page

- **HN-040** When the page loads, it shall wait for the login state from `GET /me` and then fetch
  the stories, Day by default. [verified]
- **HN-041** When a timespan button is clicked, the page shall fetch that timespan, highlight its
  button and save it, restoring it on the next load if it is less than 3 hours old. [verified]
- **HN-042** If fetching stories fails, then the page shall show an error alert until the timespan
  changes. [verified]
- **HN-043** While logged in, the page shall show a hide button on each story that removes it at
  once and restores it if the server rejects the hide; while logged out, it shall show none.
  [verified]
- **HN-044** When the login form is submitted, the page shall send the username and password,
  disable the button until the answer, re-fetch stories on success, and show a generic message on
  failure; the form says accounts are invite-only. [verified]
- **HN-045** The page shall show each story's title (a link only for `http` and `https` URLs),
  author, score, comment count, relative time, discussion link and the site's favicon (the Hacker
  News icon for self-posts). [verified]
- **HN-046** The page shall render the story list virtualized, showing nothing for an empty list.
  [verified]
- **HN-047** The page shall follow the system's light or dark preference, including live changes.
  [verified]
- **HN-048** The server shall serve `index.html` with `Cache-Control: no-cache` and hashed assets
  with a one-year immutable cache.
  unverified: no test requests the static files; the headers are set in `app.js`.
- **HN-049** The server shall send a Content-Security-Policy that allows the inline theme script
  only by its hash ([ADR 0009](adr/0009-csp-script-hash.md)).
  unverified: no test compares the hash with `index.html`; a mismatch shows as a blocked script in
  the preview screenshots.

## Release and image

- **HN-060** CI shall build the image natively for linux/amd64 and linux/arm64 and check each
  against the runtime contract before anything is released
  ([ADR 0002](adr/0002-signed-image-release-at-arms-length.md)). [verified]
- **HN-061** When CI passes on a push to the default branch, it shall publish one multi-arch index
  tagged `:<sha>` and `:latest` with provenance and an SBOM, signed keylessly with cosign and
  verified; it shall publish nothing for any other event. [verified]
- **HN-062** CI shall never deploy, use ssh, scp or dispatch triggers, or use a secret other than
  `GITHUB_TOKEN`, and every action shall come from `actions/`, `docker/` or `sigstore/`, pinned to
  a full commit SHA. [verified]
- **HN-063** The image shall run as the `node` user with `/data` owned by it, from base images
  pinned by digest, containing the runtime code, migrations and the account CLI but not the
  development scripts. [verified]
- **HN-064** `docker-compose.yml` shall run the published image as uid 1000 with no capabilities,
  a health check timeout of at least 10 s and capped logs. [verified]
- **HN-065** When the image runs under the runtime contract (uid 1000, no capabilities,
  read-only root, fresh `/data` volume), it shall answer the health check, own its database, apply
  every migration, run the account CLI, and exit 0 on SIGTERM. [verified]

## Development

- **HN-070** When a cloud session starts, the SessionStart hook shall run `scripts/cloud-setup.sh`
  within 600 s, and the script shall do nothing outside cloud sessions. [verified]
- **HN-071** The Node major in `.node-version`, CI and the Dockerfile shall be the same, and
  Dependabot shall never propose a Node major on its own
  ([ADR 0010](adr/0010-one-node-major.md)). [verified]
- **HN-072** `scripts/seed-preview.js` shall refuse to run without a throwaway database path, and
  shall seed stories the Day query returns plus a working test account. [verified]
