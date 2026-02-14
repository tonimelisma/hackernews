# API Reference

Base URL: `/api/v1`

## Authentication

Authentication uses HTTP-only cookies. On successful login, the server sets a `token` cookie containing a signed JWT. All subsequent requests to protected endpoints automatically include this cookie.

**Cookie properties:** `httpOnly`, `secure` (production and staging), `sameSite=strict`, `path=/api`, `maxAge=24h`

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

**Note:** Invalid `timespan` values silently default to `"All"` — no error returned.

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

Uses Firestore `set()` on a subcollection doc — naturally idempotent (hiding the same story twice is a no-op).

---

### POST /login

Authenticate via HackerNews credentials. Proxies the login request to `news.ycombinator.com`.

**Rate limited:** 10 requests per 15-minute window (via `express-rate-limit`).

**Request body:**
```json
{
  "goto": "news",
  "acct": "username",
  "pw": "password"
}
```

**Validation:** Username must match `[a-zA-Z0-9_-]+` (`isValidUsername()`). Returns `400` if invalid.

**Response (success):** `200 OK`

Sets an HTTP-only `token` cookie and returns:
```json
{ "username": "username" }
```

JWT expires after **24 hours**. Signed with `process.env.SECRET` (validated on server startup).

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

**Error responses:**
- `401` — missing/invalid token: `{ "error": "authentication error" }`

---

### GET /_ah/worker

**(Internal)** Trigger a background sync of stories from Hacker News. Protected by App Engine's `X-Appengine-Cron` header — App Engine strips this header from external requests, so only App Engine Cron can invoke it.

**Auth:** `X-Appengine-Cron: true` header (set automatically by App Engine Cron).

**Response (success):** `200 OK`
```json
{ "status": "sync complete" }
```

**Error responses:**
- `403` — missing/invalid cron header: `{ "error": "forbidden" }`
- `500` — sync failure: `{ "error": "sync failed" }`

**Note:** This endpoint is not under `/api/v1` — it lives at the root as `/_ah/worker` (App Engine convention).

## Security

- All endpoints served behind `helmet()` middleware (CSP, HSTS, X-Frame-Options, etc.)
- CORS restricted to `localhost:3000` in development, same-origin in production
- Passwords are never stored — only proxied to HN for authentication
- JWT stored in HTTP-only cookie (not accessible to JavaScript — prevents XSS token theft)
- Cookie attributes: `httpOnly`, `secure` (production and staging), `sameSite=strict`, `path=/api`
- Protected routes use `authenticateToken` middleware for JWT verification via cookie
