# Codebase Evaluation: hackernews

**Date:** 2026-02-09
**Scope:** Full-stack application — Node.js/Express backend, React frontend, MongoDB, Heroku deployment
**Lines of code:** ~1,430 (850 backend, 580 frontend) across 16 source files

---

## Executive Summary

A Hacker News aggregator that filters stories by score thresholds across time periods (day/week/month/year). Users can authenticate with their real HN credentials and hide stories. A background worker keeps the database fresh by syncing from the HN API every 10 minutes.

The app achieves its stated goal — it works. The architecture is sensible for a project of this size: clear separation into models/routes/services, a separate worker process, and a clean React component hierarchy. However, there are real security problems that need fixing, no test coverage, and no CI pipeline — which means the 12 open Dependabot PRs are being merged blind.

**Overall: C-** — Working application with sound structure, undermined by security gaps and absence of testing.

---

## Category Scores

| # | Category | Grade | Weight | Notes |
|---|----------|-------|--------|-------|
| 1 | Functionality | B- | 15% | Core features work; a few edge cases crash |
| 2 | Security | F | 20% | Multiple critical vulnerabilities |
| 3 | Testing | F | 15% | Zero meaningful tests |
| 4 | Code Quality | C- | 15% | Readable but repetitive; inconsistent error handling |
| 5 | Architecture | C+ | 10% | Good separation of concerns for its size |
| 6 | Documentation | F | 10% | 3-line README, no other docs |
| 7 | DevOps / CI | D- | 5% | Procfile exists; no CI, no Docker, no linting |
| 8 | Performance | C | 5% | Works at current scale; missing indexes |
| 9 | Dependencies | C | 5% | Dependabot active but merging without gates |

---

## 1. Functionality — B-

**What works well:**
- Story aggregation from the HN API with score-based filtering across 5 time periods
- Background worker with a tiered update strategy (fresher stories updated more often)
- HN credential-based authentication via proxy login to news.ycombinator.com
- Per-user story hiding with `$addToSet` to prevent duplicates
- Responsive Bootstrap 5 UI with favicons, relative timestamps, and HN discussion links
- API pagination support (limit/skip)

**What's broken or fragile:**
- `routes/api.js:48-50` — the catch block in GET `/api/v1/get` logs but **never sends a response**, leaving the client connection hanging indefinitely
- `services/storyService.js:20` — `getHidden()` calls `findOne` but never checks for null; if the user doesn't exist, the next line crashes with a null pointer
- `services/hackernews.js:71` — `getTopStories()` scrapes hntoplinks.com with a regex (`/score_[0-9]+/g`) to extract story IDs — extremely brittle, will break on any HTML change
- `models/comments.js` — Comment model is defined but imported and used **nowhere** in the codebase; dead code
- `hackernews-frontend/src/App.test.js` — uses deprecated `ReactDOM.render` (React 16 pattern) while the project runs React 18
- Production URL is inconsistent: `tonidemo.herokuapp.com` in frontend services vs `besthackernews.herokuapp.com` in the README

---

## 2. Security — F

This is the most critical area. Multiple serious vulnerabilities exist.

### Critical

| Finding | Location | Risk |
|---------|----------|------|
| **Password logged to stdout** | `routes/api.js:104` — `console.log("logging in: ", goto, pw, acct)` | Credentials visible in Heroku logs, any log drain, or aggregation tool |
| **JWT never expires** | `routes/api.js:112` — `jwt.sign({ username: acct }, process.env.SECRET)` with no `expiresIn` | A stolen token is valid forever with no revocation mechanism |
| **Token in localStorage** | `App.js:86` — `window.localStorage.setItem("loginToken", ...)` | Any XSS vector gives attackers the token |
| **CORS unrestricted** | `app.js:16` — `app.use(cors())` with no origin restriction | Any website can make authenticated API requests |

### High

- **No rate limiting** on `/api/v1/login` — brute-force attacks are trivially possible
- **No CSRF protection** — POST endpoints accept requests from any origin
- `routes/api.js:75,96` — **error objects sent directly to client** (`res.status(401).json({ error: e })`), potentially leaking internal error details and stack traces
- `Story.js:36` — renders `<a href={story.url}>` without protocol validation; a malicious HN story with a `javascript:` URL would execute in the user's browser
- **No security headers** — no Content-Security-Policy, HSTS, X-Frame-Options, or X-Content-Type-Options
- **No HTTPS enforcement** at the app level — relies entirely on Heroku
- `routes/api.js:8` — **`sanitary()` function is misnamed and limited** — regex `/^[a-z0-9\d\-_\s]+$/i` may reject valid HN usernames and gives a false sense of security

### Mitigating factors
- Heroku provides HTTPS by default on `*.herokuapp.com`
- Passwords are never stored — they're proxied to HN for authentication
- The `sanitary()` input validator exists for usernames, even if limited

---

## 3. Testing — F

### Backend: Zero tests

- `package.json` test script is literally `"echo placeholder"`
- No test framework installed (no jest, mocha, or supertest in dependencies)
- No test files exist for any backend code
- Zero coverage of API routes, services, models, worker, or middleware

### Frontend: One superficial test

- `App.test.js` — a single smoke test: "renders without crashing" using deprecated `ReactDOM.render`
- No component tests for StoryList or Story
- No tests for service functions or user interactions
- No mocking of API calls

### What's missing

- Unit tests for all 6 backend modules
- Integration tests for the 4 API endpoints
- Worker job correctness tests
- Database operation tests (ideally with mongodb-memory-server)
- Frontend component and interaction tests (React Testing Library)
- End-to-end tests
- Any test configuration (jest.config, test setup/teardown)
- Test database seeding or fixtures

### Impact

Dependabot has created 12 open PRs for dependency updates. Every one gets merged with zero automated verification. A breaking change or a supply-chain attack would pass straight through.

---

## 4. Code Quality — C-

Readable and well-structured for the most part. Files are short, naming is generally clear, and the project layout makes sense.

### Code duplication (DRY violations)

- **`services/storyService.js:52-146`** — `getStories()` repeats the same query pattern **4 times** (with/without skip x all/timespan). ~80 lines that could be ~20 with a conditional query builder.
- **`worker.js:127-178`** — Four nearly identical `deleteMany()` calls with different thresholds, followed by four similar update scans. Should be a loop over a config array.
- **`hackernews-frontend/src/services/storyService.js:2-5` and `loginService.js:2-5`** — identical `baseUrl` logic duplicated in both files.

### Naming and language

- Finnish strings appear throughout production code:
  - `routes/api.js:49` — `"uppistakeikkaa"` (informal Finnish exclamation)
  - `worker.js:180` — `"ei onnistunut"` (Finnish: "didn't succeed")
  - `worker.js:41` — `"LADATAAN UUSIMMAT TARINAT"` (Finnish: "LOADING LATEST STORIES")
- Abbreviated variable names: `acct`, `pw`, `goto` instead of `account/username`, `password`, `redirectUrl`
- `sanitary()` should be named `isValidInput()` or `isAlphanumeric()`

### Error handling

- **Silent failures everywhere**: 12+ catch blocks across `hackernews.js` and `worker.js` that only `console.log()` the error and continue
- `routes/api.js:48-50` — catch block logs but doesn't respond (client hangs)
- No error classification, no structured error responses, no retry logic

### Dead code

- TypeScript 5.0.4 installed as a frontend dependency but **completely unused** — no `.ts` files, no `tsconfig.json`, no type annotations
- `react-icons` package installed but never imported
- Comment model defined but never used
- Informal comments: `"this function is kind of nasty"`, `"oops"`, `"oops2"`

---

## 5. Architecture — C+

### Good decisions

- MVC-ish layout: `models/`, `routes/`, `services/`, `util/` is clear and appropriate for this project size
- Background worker correctly separated from the web process (Heroku Procfile with separate dyno)
- Frontend has a clean component hierarchy: `App` -> `StoryList` -> `Story`
- Service layer abstracts both external APIs (HN) and database operations
- `throng` for worker process management with graceful shutdown

### Problems

- **Database connection in service file** — `services/storyService.js:6-16` calls `mongoose.connect()` at module load time. `topdump.js` also connects independently. Connection lifecycle isn't centrally managed.
- **No auth middleware** — JWT verification is done inline in each route handler instead of being a reusable middleware
- **Route naming** — `/api/v1/get` is not RESTful; should be `/api/v1/stories`
- **Frontend-backend coupling** — production API URL is hardcoded in two frontend service files rather than using relative paths or environment variables
- **Comment model** is orphaned dead code
- **No separation of worker concerns** — `worker.js` handles fetching, updating, pruning, and scheduling all in one 210-line file

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

## 7. DevOps / CI — D-

### What exists
- `Procfile` — Heroku process definitions for web and worker dynos
- Dependabot — automated dependency update PRs are being created
- `.gitignore` files for both backend and frontend

### What's missing
- **No CI pipeline** — no GitHub Actions, no Travis, no CircleCI
- **No Dockerfile or docker-compose** — no containerization
- **No pre-commit hooks** — no husky, no lint-staged
- **No ESLint on backend** — only frontend has ESLint (default CRA config)
- **No Prettier or code formatting** enforcement
- **No automated deployment** — Dependabot PRs are merged without any test gate
- **Build artifacts committed** — `hackernews-frontend/build/` is checked into git (should be built in CI)

The Dependabot PRs being merged without CI means dependency updates go to production **with zero automated verification**.

---

## 8. Performance — C

Adequate for current scale (likely a small user base given this is a personal project).

### Database
- **No indexes** beyond `unique: true` on `id` fields. Missing indexes on:
  - `stories.time` (used in range queries in worker.js and storyService.js)
  - `stories.updated` (used in range queries in worker.js)
  - `stories.score` (used in sort)
  - `users.username` (used in `findOne`)
- **Skip-based pagination** — `storyService.js` uses `.skip(n)` which degrades linearly with offset
- No compound indexes, no query optimization

### Worker
- Four separate `deleteMany()` calls could be consolidated
- Four separate update scans could be batched
- No connection pooling configuration

### Frontend
- **No virtualization** — renders all stories at once (up to 500)
- **No code splitting** — entire app loaded at once
- jQuery loaded for Bootstrap but barely used — heavy dead weight
- Five FontAwesome packages for minimal icon usage — heavy bundle
- No `React.memo()` or `useCallback()` — components re-render unnecessarily
- No caching headers on API responses (no ETag, Cache-Control, or Last-Modified)

### Positives
- API uses field projection (only fetches needed fields from MongoDB)
- Results are capped at 500
- Worker updates are tiered by story age — smart resource allocation

---

## 9. Dependencies — C

### Positives
- Dependabot is enabled and actively creating PRs
- Core dependencies are reasonably current (Mongoose 8.x, React 18, Express 4.21)
- `package-lock.json` committed for deterministic builds

### Concerns
- `jquery ^3.6.4` — dependency but barely used; unnecessary attack surface
- `popper.js ^1.16.0` — deprecated (replaced by @popperjs/core 2.x)
- `moment ^2.29.4` — in maintenance mode; `date-fns` or `dayjs` recommended
- `react-icons ^4.8.0` — installed but never imported (dead dependency)
- `typescript ^5.0.4` — installed but completely unused
- `mongoose-unique-validator ^5.0.1` — may not work correctly with Mongoose 8.x
- No `npm audit` in any pipeline
- No license file
- Build output committed to git
- Dependabot PRs merged without any CI gate

---

## Open Branches and PRs

The repository has 15 branches and 13 open PRs:

| Category | Items | Recommendation |
|----------|-------|----------------|
| 12 Dependabot PRs (#60-#71) | Security patches and dep updates spanning Mar 2025 — Feb 2026 | Set up CI first, then batch-merge after tests pass |
| `claude/repo-evaluation-review-kANiL` (PR #72) | Previous EVALUATION.md | Superseded by this document |
| `claude/heroku-vps-migration-plan-Z1nU8` | MIGRATION_PLAN.md, no PR | Open a PR or merge the plan |

The Dependabot backlog includes security-relevant updates (lodash, axios, webpack, node-forge, jws). They should be addressed, but merging them without test infrastructure continues the pattern of unverified changes.

---

## Detailed File Inventory

| File | Lines | Role | Key Issues |
|------|-------|------|------------|
| `app.js` | 31 | Express setup | Wide-open CORS |
| `bin/www` | 91 | Server entry | Generated boilerplate, fine |
| `worker.js` | 210 | Background sync | Duplicated logic, silent failures, Finnish strings |
| `topdump.js` | 55 | One-off bootstrap | Separate DB connection, deprecated Mongoose options |
| `routes/api.js` | 126 | API routes | Password logging, hanging catch, no rate limit |
| `services/hackernews.js` | 197 | HN API client | Regex HTML parsing, 7+ silent catch blocks |
| `services/storyService.js` | 149 | DB operations | Massive duplication, connection at module load |
| `models/stories.js` | 16 | Story schema | No validation, no indexes |
| `models/users.js` | 9 | User schema | No username index, id field never set |
| `models/comments.js` | 13 | Comment schema | Dead code — unused |
| `util/config.js` | 25 | Configuration | Clean; SECRET not included |
| `util/middleware.js` | 18 | Error handling | Exposes error.message to client |
| `App.js` (FE) | 224 | React root | Token in localStorage, hardcoded URL |
| `Story.js` | 70 | Story card | No URL protocol validation |
| `StoryList.js` | 15 | Story list | No memoization |
| `storyService.js` (FE) | 25 | API client | Duplicated baseUrl, hardcoded Heroku URL |
| `loginService.js` | 19 | Auth client | Error handling commented out, hardcoded URL |

---

## Prioritized Recommendations

### Immediate (< 5 minutes each)
1. **Remove password logging** — delete `console.log` at `routes/api.js:104`
2. **Add JWT expiration** — add `{ expiresIn: '24h' }` to `jwt.sign()` at `routes/api.js:112`
3. **Fix hanging response** — add `res.status(500).json(...)` in catch at `routes/api.js:49`
4. **Add null check** in `getHidden()` at `services/storyService.js:20`

### Short-term (1-2 hours each)
5. **Set up GitHub Actions CI** — `npm install && npm test` workflow to gate Dependabot PRs
6. **Add basic backend tests** — install Jest + Supertest, cover the 4 API endpoints
7. **Restrict CORS** to the actual frontend domain
8. **Add rate limiting** on `/api/v1/login` with express-rate-limit

### Medium-term
9. **Fix hardcoded frontend URLs** — use relative paths (`/api/v1/`) since Express serves the frontend
10. **Add database indexes** on `time`, `updated`, `score`, `username`
11. **Refactor duplicated query logic** in `storyService.js` and `worker.js`
12. **Write a proper README** with setup instructions, env vars, architecture, and API docs
13. **Remove dead dependencies** — TypeScript, react-icons, Comment model

---

## Git History Assessment

- 58+ commits, majority are Dependabot merges
- No evidence of feature branches or code review process
- No PR template, no required reviewers
- Commit messages are auto-generated (Dependabot) or terse

---

## Conclusion

This is a well-scoped personal project that solves a real problem. The architecture is sensible, the code is readable, and the feature set is complete. The main gaps are in surrounding engineering practices: security hardening, testing, CI, and documentation.

Items 1-4 above are 5-minute fixes that would eliminate the worst vulnerabilities. Items 5-6 would establish the foundation needed to safely merge the backlog of 12 dependency updates. Together, those 6 items would move the overall grade from C- to a solid C+.
