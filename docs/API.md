# API Reference

Base URL: `/api/v1`

## Endpoints

### GET /get

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

**Known issues:**
- Invalid `timespan` values silently default to `"All"` — no error returned
- No response sent on internal DB error (request hangs until timeout)

---

### GET /hidden

Get hidden story IDs for authenticated user.

**Headers:** `Authorization: bearer <JWT>`

**Response:** `200 OK`
```json
[12345, 67890]
```

**Error responses:**
- `401` — missing/invalid token: `{ "error": "invalid token" }` or `{ "error": <Error object> }`

**Known issues:**
- If user doesn't exist in DB, crashes with null pointer (no null check on `findOne` result)
- Error response serializes the Error object directly (`{ "error": e }`) instead of `e.message`

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

**Known issues:**
- `upsertHidden` is called without `await` — fire-and-forget, errors are silently lost
- Uses `$addToSet` so duplicates are prevented

---

### POST /login

Authenticate via HackerNews credentials.

**Request body:**
```json
{
  "goto": "news",
  "acct": "username",
  "pw": "password"
}
```

**Response (success):** `200 OK`
```json
{ "token": "eyJhbGciOiJIUzI1NiJ9..." }
```

**Response (failure):** `401`
```json
{ "error": "False username or password" }
```

**Response (bad request):** `400`
```json
{ "error": "missing fields" }
```

**Known issues:**
- Passwords are logged to console via `console.log("logging in: ", goto, pw, acct)`
- `sanitary()` regex rejects valid HN usernames containing `.` or `@`
- `upsertUser` is called without `await` — fire-and-forget
- JWT secret comes from `process.env.SECRET` — undefined in dev without .env
- JWT has no expiration
