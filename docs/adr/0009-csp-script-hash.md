# 0009. CSP allows the one inline script by hash

- Status: accepted
- Date: 2026-11-27 (recorded)

## Context and problem

`index.html` has one synchronous inline script that sets `data-bs-theme` before first paint, so
dark mode does not flash (HN-047). Helmet's Content-Security-Policy must allow it without
`'unsafe-inline'` (HN-049).

## Decision drivers

- No `'unsafe-inline'` in `script-src`.
- No theme flash on load.

## Considered options

### `'unsafe-inline'`

- Good: no maintenance.
- Bad: allows any injected inline script.

### Move the script to a file

- Good: covered by `'self'`.
- Bad: an external script loads after parsing starts, so the page can paint in the wrong theme.

### Hash of the inline script

- Good: only that exact script runs.
- Bad: any change to the script, whitespace included, needs the hash recomputed in `app.js`.

## Decision

`script-src` lists `'sha256-…'` of the inline script (in `app.js`), plus `'self'`, which also
covers Vite's split chunks.

## Consequences

Changing the inline script means recomputing its hash
(`openssl dgst -sha256 -binary | openssl base64`) and updating `app.js` in the same change.

## Confirmation

unverified: no test compares the hash with the script; a wrong hash shows as a blocked script in
the browser console and a theme flash (`scripts/preview.sh` screenshots show it).

## Retirement proof

Theme detection that needs no inline script.

## Reversal plan

Remove the hash and the inline script together.
