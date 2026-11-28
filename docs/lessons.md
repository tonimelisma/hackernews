# Lessons

Rules learned the hard way that the code does not make obvious, and problems still open. Entries
that became an ADR or a test are removed from here.

## Rules learned

- A redirect-path heuristic cannot tell "bad password" from "bot wall": inspect the response body
  before trusting an auth outcome, and don't build auth on a third party's login form (why
  [ADR 0003](adr/0003-local-password-accounts.md) exists; diagnosed by probing from inside the
  container with a fake account — a plain GET of `/login` was not challenged, only the POST).
- Anything `services/*` loads from disk at runtime must be in the final image. Check
  `schema_migrations` after a release, not just that the app boots
  ([ADR 0006](adr/0006-versioned-migrations-on-startup.md)).
- With a time filter, a sort on another column and a LIMIT, accurate statistics matter more than
  more indexes. Profile with `process.hrtime.bigint()` around `stmt.all()` and
  `EXPLAIN QUERY PLAN`, not wall time ([ADR 0005](adr/0005-query-planner-statistics-and-index-hints.md)).
- `stories.time` is milliseconds (`hackernews.js` stores `time * 1000`). Anything that writes
  stories by hand (fixtures, `scripts/seed-preview.js`) must use ms, or the Day page is silently
  empty (HN-072).
- Slow CPUs expose React timing bugs. Waiting only for a mock to be called leaves its promise's
  `setState` outside `act` (use `act(() => mock.mock.results.at(-1).value)`), and a plain
  `fireEvent.click` leaves post-`await` updates outside it (use
  `await act(async () => fireEvent.click(...))`). Screenshots wait for network idle and no
  `.spinner-border`; a fixed sleep or network idle alone captured spinners.
- Vitest: a `vi.mock()` factory returns `{ default: ... }` for default exports; jsdom has no
  `window.matchMedia` (stubbed in `setupTests.js`); Node's experimental `localStorage` conflicts
  with jsdom, so stub it with `vi.stubGlobal`; react-virtuoso is mocked in every test file that
  renders a list.
- The login rate limiter keeps state across tests in a file: its test runs last in its block.
- `errorHandler` must not call `next()` after responding, or "headers already sent" follows.
- SECRET validation, database start and the worker live in `bin/www`, not `app.js`, so tests can
  `require('../../app')` without exiting.
- Bootstrap 5: `data-bs-toggle`/`data-bs-dismiss`, `dropdown-menu-end`, and
  `data-bs-auto-close="outside"` so the login dropdown stays open while submitting.
- npm `allowScripts` (npm 11.19+): approve dependency install scripts by unversioned name
  (`"better-sqlite3": true`); `npm install-scripts approve` writes `name@version` keys that go
  stale on every bump. Check with `npm install-scripts ls`.
- Vite: `build.outDir` is `build` (Express serves it); `codeSplitting` splits `react` and
  `vendor` to keep chunks under 500 kB and vendor code cached across app-only releases.
- Cloud sessions get Node 24 from the npm registry (`node-linux-x64@24`) because the VM ships older
  Node and may not reach nodejs.org; `scripts/cloud-setup.sh` installs it and exports its `PATH`.

## Open problems

- npm `overrides` force `minimatch` ^11.0.1 in both packages and `glob` ^14.0.2 in the backend,
  because ESLint 10 and Jest's `test-exclude` still pin vulnerable majors. Drop each once upstream
  ranges catch up (`npm ls minimatch glob --all`).
- Backend dev dependencies carry 5 low advisories with no patched release (`deepmerge` ≤ 4.3.1 via
  `jest-config`); dev-only, and it merges only Jest's own config. Production and frontend audits
  are clean and enforced in CI at `moderate`.
