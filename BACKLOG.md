# Backlog

Future work items for the HackerNews aggregator project.

## Security

- **JWT from localStorage to HTTP-only cookie** — localStorage tokens are vulnerable to XSS; HTTP-only cookies prevent JavaScript access

## Build & Tooling

- **CRA to Vite migration** — react-scripts is unmaintained; Vite unlocks fixing 9 frozen frontend vulnerabilities
- **Add ESLint to backend** — frontend has CRA's default ESLint, backend has none
- **Add pre-commit hooks** (husky + lint-staged) — enforce linting and formatting before commits

## API & Backend

- **RESTful API naming** — rename `/get` to `/stories`, follow REST conventions
- **Replace `moment.js` with `dayjs`** — moment is in maintenance mode; dayjs is a drop-in replacement at 2KB
- **Extract worker `main()` for direct testability** — currently `throng(1, main)` runs at module scope, making the worker untestable

## Frontend

- **Replace FontAwesome 5 packages with lighter alternative** — five packages for minimal icon usage
- **Remove Bootstrap JS side-effect import** — `App.js` imports `bootstrap.bundle.min` at module scope
- **Add virtualization for large story lists** — currently renders all stories at once (up to 500)

## Testing & Quality

- **Add end-to-end tests** (Playwright or Cypress)
- **Add code coverage reporting** — track coverage trends over time

## Documentation & Governance

- **Add JSDoc to exported functions**
- **Add CONTRIBUTING.md**
- **Add LICENSE file**
