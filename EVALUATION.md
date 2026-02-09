# Repository Evaluation: hackernews

**Evaluated:** 2026-02-09
**Codebase size:** ~1,198 lines of application JavaScript across 16 files
**Stack:** Node.js/Express + React + MongoDB + Heroku

---

## Executive Summary

This is a functional full-stack Hacker News aggregator that filters stories by score thresholds across time periods. It works but has significant gaps in security, testing, documentation, and code quality that would prevent it from being considered production-grade. The most urgent concerns are security vulnerabilities in authentication and a complete absence of automated testing.

**Overall Grade: D+** — Functional prototype, not production-ready.

---

## Evaluation Criteria

| Category | Grade | Weight |
|----------|-------|--------|
| 1. Functionality & Correctness | C+ | 15% |
| 2. Security | F | 20% |
| 3. Testing | F | 15% |
| 4. Code Quality & Maintainability | D | 15% |
| 5. Architecture & Design | C- | 10% |
| 6. Documentation | F | 10% |
| 7. DevOps & CI/CD | F | 5% |
| 8. Performance | D+ | 5% |
| 9. Dependencies & Supply Chain | C | 5% |

---

## 1. Functionality & Correctness — C+

**What works:**
- Core feature set is complete: story aggregation, time-based filtering, score thresholds, user authentication via HN credentials, hide-story functionality
- Background worker syncs stories and prunes low-scoring ones on a schedule
- Frontend is responsive (Bootstrap 5) and renders story cards with favicons, metadata, and external links
- API design supports pagination (limit/skip)

**What doesn't work or is fragile:**
- `routes/api.js:49` — catch block logs error but **never sends a response to the client**, leaving HTTP connections hanging indefinitely
- `services/hackernews.js:71` — scrapes HTML with regex (`page.data.match(/score_[0-9]+/g)`) to extract story IDs from hntoplinks.com — extremely brittle, will break on any HTML change
- `models/comments.js` — Comment model is defined but imported and used **nowhere** in the codebase; dead code
- `hackernews-frontend/src/App.test.js` — uses deprecated `ReactDOM.render` (React 16 pattern) while the project runs React 18
- `services/storyService.js:20` — `getHidden()` will crash with a null pointer if the user document doesn't exist (no null check after `findOne`)
- Frontend hardcodes two different production URLs: `tonidemo.herokuapp.com` in services vs `besthackernews.herokuapp.com` in the README

---

## 2. Security — F

This is the most critical area of concern. Multiple serious vulnerabilities exist.

### Critical Issues

| Issue | Location | Impact |
|-------|----------|--------|
| **Password logged to console** | `routes/api.js:104` — `console.log("logging in: ", goto, pw, acct)` | User credentials exposed in server logs, Heroku log drains, any log aggregation |
| **JWT tokens never expire** | `routes/api.js:112` — `jwt.sign({ username: acct }, process.env.SECRET)` with no `expiresIn` | Stolen tokens are valid forever; no way to revoke |
| **Token stored in localStorage** | `App.js:86` — `window.localStorage.setItem("loginToken", ...)` | Vulnerable to XSS — any injected script can steal the token |
| **No rate limiting on /login** | `routes/api.js` | Brute-force attacks are trivially possible |
| **CORS wide open** | `app.js:16` — `app.use(cors())` with no origin restriction | Any website can make authenticated requests |

### High-Severity Issues

- **No CSRF protection** — POST endpoints accept requests from any origin
- **Error objects sent to client** — `routes/api.js:75,96` — `res.status(401).json({ error: e })` leaks internal error details
- **No Content-Security-Policy headers** — no protection against inline script injection
- **No HTTPS enforcement** — app doesn't redirect HTTP to HTTPS
- **`javascript:` URLs not filtered** — `Story.js:36` renders `<a href={story.url}>` without validating the protocol, allowing `javascript:` URLs from malicious HN stories
- **`sanitary()` function is misnamed and limited** — `routes/api.js:8` — regex `/^[a-z0-9\d\-_\s]+$/i` may reject valid HN usernames and gives a false sense of security

---

## 3. Testing — F

### Backend: Zero tests

- `package.json` test script is literally `"echo placeholder"`
- No test framework installed (no jest, mocha, or supertest in dependencies)
- No test files exist for any backend code
- Zero coverage of API routes, services, models, worker, or middleware

### Frontend: One superficial test

- `App.test.js` — a single test: "renders without crashing" using deprecated `ReactDOM.render`
- No component tests for StoryList or Story
- No tests for service functions
- No user interaction tests
- No mocking of API calls

### What's missing

- Unit tests for all 6 backend modules
- Integration tests for the API endpoints
- Worker job correctness tests
- Database operation tests (ideally with mongodb-memory-server)
- Frontend component and interaction tests (React Testing Library)
- End-to-end tests
- Any test configuration (jest.config, test setup/teardown)
- Test database seeding or fixtures

---

## 4. Code Quality & Maintainability — D

### Code Duplication (DRY violations)

- **`services/storyService.js:52-146`** — `getStories()` function repeats the same query structure **4 times** (with/without skip × all/timespan). ~80 lines that could be ~20 lines with a simple conditional builder.
- **`worker.js:127-178`** — Four nearly identical `deleteMany()` calls with different thresholds. Should be a parameterized loop.
- **`hackernews-frontend/src/services/storyService.js:2-5` and `loginService.js:2-5`** — identical `baseUrl` logic duplicated in both files.

### Naming and Language

- Finnish-language strings appear throughout:
  - `routes/api.js:49` — `"uppistakeikkaa"` (informal Finnish exclamation)
  - `worker.js:180` — `"ei onnistunut"` (Finnish: "didn't succeed")
  - `worker.js:41` — `"LADATAAN UUSIMMAT TARINAT"` (Finnish: "LOADING LATEST STORIES")
- Abbreviated variable names: `acct`, `pw`, `goto` instead of `account/username`, `password`, `redirectUrl`
- `sanitary()` function should be named `isValidInput()` or `isAlphanumeric()`
- Inconsistent naming: `recvToken` vs `loginCorrect` vs `decodedToken`

### Error Handling

- **Silent failures everywhere**: 12+ catch blocks across `hackernews.js` and `worker.js` that only `console.log()` the error and continue
- `routes/api.js:48-50` — catch block logs but doesn't respond (client hangs)
- `services/hackernews.js:79,89,98,149,156,177,184` — all catch blocks swallow errors
- No error classification, no structured error responses, no retry logic

### TypeScript

- TypeScript 5.0.4 is installed as a frontend dependency but **completely unused** — no `.ts` files, no `tsconfig.json`, no type annotations
- No JSDoc type annotations anywhere
- No PropTypes on React components

---

## 5. Architecture & Design — C-

### What's reasonable
- Separation into models/routes/services/util follows a recognizable MVC-ish pattern
- Background worker is correctly separated from the web process (Heroku Procfile)
- Frontend has a clean component hierarchy: App → StoryList → Story
- Service layer abstracts API calls in both frontend and backend

### What's problematic
- **Database connection in service file** — `services/storyService.js:6-16` calls `mongoose.connect()` at module load time. This should be in app initialization. `topdump.js` also connects independently.
- **No middleware for auth** — token extraction and verification logic is inline in route handlers instead of being a reusable middleware
- **Route naming** — `/api/v1/get` is not RESTful; should be `/api/v1/stories`
- **Frontend-backend coupling** — production API URL is hardcoded in two frontend service files rather than using environment variables or a relative path
- **No API versioning strategy** — `/api/v1/` exists but there's no pattern for handling version evolution
- **Comment model** is orphaned — defined but never used
- **No separation of worker concerns** — `worker.js` contains sync logic, update logic, deletion logic, and scheduling all in one file

---

## 6. Documentation — F

### README.md — 3 lines total

```
# hackernews
Hacker news app, shows only the best articles
Works on both mobile and desktop
https://besthackernews.herokuapp.com
```

### What's missing
- Setup and installation instructions
- Environment variable documentation (`.env.example`)
- API endpoint documentation (no OpenAPI/Swagger)
- Architecture overview
- Database schema documentation
- Deployment instructions
- Contributing guidelines
- License file
- Inline code documentation — almost no JSDoc, no function descriptions, no parameter docs
- The few comments that exist are informal (`"this function is kind of nasty"`, `"oops"`, `"oops2"`)

---

## 7. DevOps & CI/CD — F

### What exists
- `Procfile` — Heroku process definitions for web and worker dynos
- Dependabot — automated dependency update PRs are being created and merged

### What's missing
- **No CI pipeline** — no GitHub Actions, no Travis CI, no CircleCI, nothing
- **No Dockerfile or docker-compose** — no containerization
- **No pre-commit hooks** — no husky, no lint-staged
- **No ESLint on backend** — only frontend has ESLint (default Create React App config)
- **No Prettier or code formatting** enforcement
- **No automated deployment** — Dependabot PRs are merged without any test gate
- **Build artifacts committed** — `hackernews-frontend/build/` is checked into git (should be built in CI)

The Dependabot PRs being merged without CI means dependency updates go to production **with zero automated verification**.

---

## 8. Performance — D+

### Database
- **No indexes** beyond the `unique: true` on `id` fields. Missing indexes on:
  - `stories.time` (used in range queries in worker.js and storyService.js)
  - `stories.updated` (used in range queries in worker.js)
  - `stories.score` (used in sort)
  - `users.username` (used in `findOne`)
- **Skip-based pagination** — `storyService.js` uses `.skip(n)` which scans and discards documents; doesn't scale
- **No query optimization** — no compound indexes, no `explain()` evidence

### Worker
- Four separate `deleteMany()` calls could be a single aggregated query
- Four separate update scans could be batched
- No connection pooling configuration

### Frontend
- **No memoization** — `React.memo()` and `useCallback()` not used; components re-render unnecessarily
- **No code splitting** — entire app loaded at once
- **No lazy loading** of stories (renders all 500 at once)
- **No caching headers** — API responses have no ETag, Cache-Control, or Last-Modified
- jQuery included but barely used (loaded for Bootstrap dependency)

### Positive
- API uses field projection (only selects needed fields from MongoDB)
- Results are limited (max 500)

---

## 9. Dependencies & Supply Chain — C

### Positive
- Dependabot is enabled and PRs are being merged regularly
- Dependencies are relatively current (mongoose 8.x, React 18, Express 4.21)
- `package-lock.json` is committed for deterministic builds

### Concerns
- **jQuery 3.6.4** is a dependency but barely used — unnecessary attack surface
- **Popper.js 1.x** is deprecated (replaced by @popperjs/core 2.x)
- **moment.js** is in maintenance mode; day.js or date-fns recommended
- **Five FontAwesome packages** installed for what appears to be minimal icon usage — heavy bundle weight
- **No `npm audit`** in any pipeline
- **No license file** — legal risk for consumers
- **Build output committed to git** — `hackernews-frontend/build/` should be in `.gitignore` and generated in CI
- Dependabot PRs merged without any CI gate — could introduce breaking changes or vulnerabilities undetected

---

## Top 10 Recommendations (Priority Order)

1. **Remove password logging** (`routes/api.js:104`) — immediate security fix
2. **Add JWT expiration** — set `expiresIn: '24h'` in `jwt.sign()` options
3. **Add a test framework and basic test coverage** — install jest + supertest, write tests for API routes and authentication
4. **Set up GitHub Actions CI** — run tests and linting on every PR; stop merging Dependabot PRs blind
5. **Add rate limiting** on `/login` endpoint (express-rate-limit)
6. **Restrict CORS** to the actual frontend domain
7. **Fix the hanging response** in the catch block at `routes/api.js:49`
8. **Refactor duplicated query logic** in `storyService.js` and `worker.js`
9. **Add database indexes** on `time`, `updated`, `score`, and `username`
10. **Write a proper README** with setup instructions, env vars, architecture, and API docs

---

## Detailed File Inventory

| File | Lines | Role | Key Issues |
|------|-------|------|------------|
| `app.js` | 31 | Express setup | Wide-open CORS |
| `bin/www` | — | Server entry | Generated boilerplate, fine |
| `worker.js` | 209 | Background sync | Duplicated logic, silent failures, Finnish strings |
| `topdump.js` | 54 | One-off bootstrap | Separate DB connection, HTML regex scraping |
| `routes/api.js` | 125 | API routes | Password logging, hanging catch, no rate limit |
| `services/hackernews.js` | 197 | HN API client | Regex HTML parsing, 7 silent catch blocks |
| `services/storyService.js` | 148 | DB operations | Massive duplication, connection in service file |
| `models/stories.js` | 16 | Story schema | No validation, no indexes |
| `models/users.js` | 9 | User schema | No username index, id field never set |
| `models/comments.js` | 13 | Comment schema | Dead code — unused |
| `util/config.js` | 25 | Config | SECRET not included |
| `util/middleware.js` | 18 | Error handling | Exposes error.message to client |
| `App.js` | 224 | React root | Token in localStorage, hardcoded URL |
| `Story.js` | 70 | Story card | No URL protocol validation |
| `StoryList.js` | 15 | Story list | No memoization |
| `storyService.js` (FE) | 25 | API client | Duplicated baseUrl |
| `loginService.js` | 19 | Auth client | Error handling commented out |

---

## Git History Assessment

- 58+ commits, mostly Dependabot merges for dependency updates
- Dependabot is the primary contributor by volume
- No evidence of feature branches or code review process
- No PR template, no required reviewers
- Commit messages are auto-generated (Dependabot) or terse

---

## Conclusion

The repository demonstrates a working understanding of the Node.js/React/MongoDB stack and solves a real problem (filtering HN stories by quality). However, it has the characteristics of a personal project/prototype rather than production software:

- **Security vulnerabilities** that would be flagged in any audit (password logging, no token expiry, open CORS)
- **Zero meaningful test coverage** with no CI to prevent regressions
- **Significant code duplication** that makes maintenance error-prone
- **No documentation** for setup, API, or architecture
- **No operational infrastructure** (monitoring, alerting, CI/CD pipeline)

To bring this to production quality, the security issues should be addressed first (items 1-2, 5-6 in recommendations), followed by testing infrastructure (items 3-4), and then code quality improvements (items 7-10).
