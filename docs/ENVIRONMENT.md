# Environment Variables

## Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | No | `"production"` → `prod-` collections, `"ci"` → `ci-` collections, anything else → `dev-` |
| `SECRET` | Yes (auth) | JWT signing secret. If undefined, `jwt.sign()` throws |
| `GOOGLE_APPLICATION_CREDENTIALS` | For CI | Path to GCP service account key JSON (local dev uses ADC) |

### Firestore Authentication

| Environment | Auth Method |
|---|---|
| Local dev | Application Default Credentials via `gcloud auth application-default login` |
| CI (GitHub Actions) | Service account key stored as `GCP_SA_KEY` secret, written to temp file |
| Production | Service account key or workload identity (depends on deployment) |

### Config Constants (`util/config.js`)

| Constant | Value | Description |
|----------|-------|-------------|
| `limitResults` | 500 | Max stories per API response |

## Frontend (`hackernews-frontend/src/services/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `"development"` | CRA sets this automatically |

**URL switching (`storyService.js` + `loginService.js`):**
```js
const baseUrl =
  process.env.NODE_ENV === "production"
    ? "https://tonidemo.herokuapp.com/api/v1/"
    : "http://localhost:3000/api/v1/";
```

The production URL points to `tonidemo.herokuapp.com` — this is hardcoded and not configurable via environment variables.
