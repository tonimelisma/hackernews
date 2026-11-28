# 0004. jose for session tokens

- Status: accepted
- Date: 2026-11-27 (recorded; the swap predates this record)

## Context and problem

`jsonwebtoken` pulled in `jwa` → `buffer-equal-constant-time`, which touched the removed
`SlowBuffer.prototype` at require time and crashed the app on Node 25 and later. Session cookies
are HS256 JWTs signed with `SECRET` and had to keep verifying across the swap (HN-015, HN-022).

## Decision drivers

- Runs on every current Node major.
- Same token format and secret, so existing cookies stay valid.

## Considered options

### Stay on jsonwebtoken and pin Node below 25

- Good: no code change.
- Bad: blocks Node upgrades on an unmaintained transitive dependency.
- Failure modes: a forced Node upgrade takes the app down at startup.

### jose

- Good: maintained, no native or legacy Buffer dependencies, standard HS256.
- Bad: v6 is ESM-only; Jest needs `--experimental-vm-modules`.
- Failure modes: running `npx jest` bare fails `api.test.js` (the npm scripts set the flag).

## Decision

`jose` v6. `signToken(user)` in `routes/api.js` signs `{ username, tv }` with HS256, `iat` and a
365-day `exp`; `jwtVerify()` checks expiry. The app loads jose through Node 24's native
`require(esm)`; the `test` and `test:coverage` scripts set `NODE_OPTIONS` with
`--experimental-vm-modules` (and silence its warning).

## Consequences

API tests sign and verify real JWTs; there is no token mock. Use the npm scripts, not bare Jest.

## Confirmation

`tests/integration/api.test.js` "signs JWT with 365d expiration and the user's token version"
(HN-015) and the sessions tests (HN-023).

## Retirement proof

Jest (or its replacement) supporting ESM without flags, or a token format change.

## Reversal plan

Swap the two functions in `routes/api.js`; tokens are standard HS256, so any JWT library verifies
them.
