# API Reference

Base URL: `/api/v1`

## Authentication

Authentication uses HTTP-only cookies. On successful login, the server sets a `token` cookie containing a signed JWT. All subsequent requests to protected endpoints automatically include this cookie.

**Cookie properties:** `httpOnly`, `secure` (production), `sameSite=strict`, `path=/api`, `maxAge=365d`

**Token refresh:** `GET /me` issues a fresh JWT and cookie on each call, resetting the 1-year expiry. Since the frontend calls `getMe()` on every page load, active users are effectively never logged out.

**JWT payload:** `{ username, tv, iat, exp }`, HS256-signed with `SECRET`. `tv` is the user's `token_version` at signing time. Every authenticated request looks up the user row and rejects the cookie if the user no longer exists or `tv` ≠ the stored `token_version`. Cookies issued before local passwords (the HN-proxy era) carry no `tv` and count as version `0`, so they stayed valid across the migration.

**Sessions:** each browser holds its own independent cookie — any number of simultaneous sessions are supported, and logging out in one browser (which only clears that browser's cookie) never affects the others. The only way to end every session at once is `node scripts/users.js revoke-sessions <username>`, which bumps `token_version`.

**Accounts** are local username/password accounts, created and reset manually with `scripts/users.js` (see [ARCHITECTURE.md](ARCHITECTURE.md#account-administration)). There is no signup or reset endpoint.

Protected endpoints return `401` if no valid cookie is present.

## Endpoints

### GET /stories

Fetch stories sorted by score descending.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `timespan` | string | `"All"` | Filter: `Day`, `Week`, `Month`, `Year`, `All` |
| `limit` | number | 500 | Max results (must be > 0, capped at `config.limitResults` = 500) |
| `skip` | number | — | Pagination offset |

**Response:** `200 OK`
```json
[
  {
    "by": "author",
    "descendants": 42,
    "id": 12345,
    "score": 150,
    "time": "2024-01-01T00:00:00.000Z",
    "title": "Story Title",
    "url": "https://example.com"
  }
]
```

**Error:** `500` on internal DB error.

**Notes:**
- Invalid `timespan` values silently default to `"All"` — no error returned.
- If a valid auth cookie is present, hidden stories are filtered out server-side via SQL `WHERE id NOT IN (...)`. Anonymous requests return all stories.

---

### GET /hidden

Get hidden story IDs for authenticated user.

**Auth:** Requires `token` cookie (set by `/login`).

**Response:** `200 OK`
```json
[12345, 67890]
```

**Error responses:**
- `401` — missing/invalid token: `{ "error": "authentication error" }`
- `500` — internal error: `{ "error": "internal server error" }`

Returns `[]` if the user has no hidden stories or doesn't exist in the database.

---

### POST /hidden

Add a story ID to authenticated user's hidden list.

**Auth:** Requires `token` cookie (set by `/login`).

**Request body:**
```json
{ "hidden": 12345 }
```

**Validation:** `hidden` must be a non-negative integer. Returns `400` with `{ "error": "invalid story id" }` if invalid.

**Response:** `200 OK`
```json
{ "hidden": 12345 }
```

**Error responses:**
- `400` — invalid story id: `{ "error": "invalid story id" }`
- `401` — missing/invalid token: `{ "error": "authentication error" }`
- `500` — internal error: `{ "error": "internal server error" }`

Uses `INSERT OR REPLACE` — naturally idempotent (hiding the same story twice is a no-op).

---

### POST /login

Authenticate with a local account. The password is checked against the scrypt hash in `users.password_hash` (`services/auth.js`). Usernames are case-sensitive.

**Rate limited:** 10 requests per 15-minute window per client IP (via `express-rate-limit`; the app trusts one proxy hop, so the IP comes from Caddy's `X-Forwarded-For`).

Each `/login` response includes `X-Login-Request-Id`. The server logs `[login] requestId=… outcome=success|invalid-credentials|bad-request|rate-limited` — never usernames or passwords.

**Request body:**
```json
{
  "username": "username",
  "password": "password"
}
```

**Validation:** `username` must match `[a-zA-Z0-9_-]+` and be at most 32 characters (`auth.isValidUsername()`); `password` must be a non-empty string of at most 1024 characters. Returns `400` otherwise (including the old HN-era `{ goto, acct, pw }` payload).

**Unknown user, wrong password, or an account with no password set** all return the identical `401`, and all pay for one scrypt hash so timing does not reveal which usernames exist. Login never creates users.

**Response (success):** `200 OK`

Sets an HTTP-only `token` cookie and returns:
```json
{ "username": "username" }
```

JWT (`{ username, tv }`) expires after **365 days**. Signed with `process.env.SECRET` (validated on server startup). The token is refreshed on every `GET /me` call (see above).

**Response (failure):** `401`
```json
{ "error": "invalid credentials" }
```

**Response (bad request):** `400`
```json
{ "error": "missing fields" }
```

**Response (server error):** `500`
```json
{ "error": "internal server error" }
```

---

### POST /logout

Clear the authentication cookie.

**Response:** `200 OK`
```json
{ "success": true }
```

Clears the `token` cookie. Always succeeds (no auth required).

---

### GET /me

Get the currently authenticated user.

**Auth:** Requires `token` cookie (set by `/login`).

**Response:** `200 OK`
```json
{ "username": "username" }
```

Also sets a fresh `token` cookie with a new 365-day JWT, effectively refreshing the session on every page load. A pre-migration cookie without `tv` is re-issued with `tv: 0`.

**Error responses:**
- `401` — missing/invalid token: `{ "error": "authentication error" }`

## Security

- All endpoints served behind `helmet()` middleware (CSP, HSTS, X-Frame-Options, etc.)
- CORS restricted to `localhost:3000` in development, same-origin in production
- Passwords are stored only as salted scrypt hashes (`scrypt$N$r$p$salt$key`, OWASP parameters N=2^14, r=8, p=5), compared in constant time; HN credentials are never involved
- Unknown usernames cost the same hash as real ones (no username enumeration via timing)
- JWT stored in HTTP-only cookie (not accessible to JavaScript — prevents XSS token theft)
- Cookie attributes: `httpOnly`, `secure` (production), `sameSite=strict`, `path=/api`
- Protected routes use `authenticateToken` middleware: JWT verification via cookie, then user-exists and `token_version` checks (server-side revocation)
