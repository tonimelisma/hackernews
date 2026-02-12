# API Reference

Base URL: `/api/v1`

## Endpoints

### GET /stories

Fetch stories sorted by score descending.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `timespan` | string | `"All"` | Filter: `Day`, `Week`, `Month`, `Year`, `All` |
| `limit` | number | 500 | Max results (capped at `config.limitResults` = 500) |
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

**Headers:** `Authorization: bearer <JWT>`

**Response:** `200 OK`
```json
[12345, 67890]
```

**Error responses:**
- `401` — missing/invalid token: `{ "error": "invalid token" }`
- `500` — internal error: `{ "error": "internal error" }`

Returns `[]` if the user has no hidden stories or doesn't exist in the database.

---

### POST /hidden

Add a story ID to authenticated user's hidden list.

**Headers:** `Authorization: bearer <JWT>`

**Request body:**
```json
{ "hidden": 12345 }
```

**Response:** `200 OK`
```json
{ "hidden": 12345 }
```

**Error responses:**
- `401` — missing/invalid token: `{ "error": "invalid token" }`
- `500` — internal error: `{ "error": "internal error" }`

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
```json
{ "token": "eyJhbGciOiJIUzI1NiJ9..." }
```

JWT expires after **24 hours**. Signed with `process.env.SECRET` (validated on server startup).

**Response (failure):** `401`
```json
{ "error": "False username or password" }
```

**Response (bad request):** `400`
```json
{ "error": "missing fields" }
```

## Security

- All endpoints served behind `helmet()` middleware (CSP, HSTS, X-Frame-Options, etc.)
- CORS restricted to `localhost:3000` in development, same-origin in production
- Passwords are never stored — only proxied to HN for authentication
- Protected routes use `authenticateToken` middleware for JWT verification
