# 0003. Local password accounts instead of Hacker News logins

- Status: accepted
- Date: 2026-11-27 (recorded; decided when proxied logins stopped working)

## Context and problem

Login used to POST the user's credentials to `news.ycombinator.com/login` and read success from
the final redirect path. Hacker News began answering every login from a datacenter IP with a
"Validation required" reCAPTCHA page that also lands on `/login`, so every login failed as a wrong
password while the same credentials worked in a browser. The app also handled third-party
credentials it had no business seeing (HN-015 to HN-028).

## Decision drivers

- Logins must work from any host.
- No third-party credentials pass through the app.
- Existing usernames, hidden history and cookies must survive the change.

## Considered options

### Keep proxying, detect the challenge

- Good: no account administration.
- Bad: still a bot-walled third-party form; still handles HN passwords.
- Failure modes: the next anti-bot change breaks logins again, silently.

### Local accounts managed by a CLI

- Good: no third party; scrypt hashes; sessions revocable.
- Bad: accounts are created and reset by hand; no signup or reset flow.
- Failure modes: a lost password needs an administrator with container access.

## Decision

Local accounts: `POST /login` checks an scrypt hash (`scrypt$N$r$p$salt$key`, N=2^14, r=8, p=5)
in `users.password_hash`; `scripts/users.js` (`list`, `add`, `set-password`, `revoke-sessions`)
runs inside the container and is part of the runtime contract. The JWT carries `tv` =
`users.token_version`; every authenticated request requires the user row and a matching `tv`; a
token without `tv` counts as 0, so cookies issued before the change stay valid. Login never creates
users. Unknown users and users without a password are hashed against a dummy for uniform timing.
N=2^17 was rejected: 128 MiB per hash pushed a 1 GB machine into swap at 3.4 s per hash.

## Consequences

Usernames carried over, so hidden history did too. `set-password` keeps `token_version` (no
logout); `revoke-sessions` bumps it (logs out every browser). Removing the `tv`-defaults-to-0 rule
would log out every pre-change session. The Dockerfile must copy `scripts/users.js`.

## Confirmation

`tests/integration/api.test.js` (login, sessions), `tests/integration/users.test.js` (CLI and
`userService`), `tests/unit/auth.test.js` (hashing), `tests/unit/migrator.test.js` (migration
003), `tests/unit/dockerfile.test.js` (CLI in the image).

## Retirement proof

A trusted identity provider that works from datacenter IPs and needs no credential handling here.

## Reversal plan

Add an OAuth/OIDC login next to the local one, map identities to existing usernames, then retire
`password_hash`. A migration plus new routes.
