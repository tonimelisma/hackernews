# CLAUDE.md

## What this is

A Hacker News aggregator: top stories by score per timespan (Day, Week, Month, Year, All), with
local accounts that can hide stories. A Node.js 24 / Express 5 backend with SQLite
(better-sqlite3) and an in-process sync worker, a React 19 frontend built with Vite, shipped as a
signed multi-arch container image (`ghcr.io/tonimelisma/hackernews`). Architecture:
[docs/architecture.md](docs/architecture.md); releases and the runtime contract:
[docs/release.md](docs/release.md).

## Working style

- When it is clear what is wanted, do it. Ask only for what only the user can do, or for a real
  product choice nobody has made yet.
- Don't end a turn with a summary announcing the next step, an offer to continue, or a list of
  decisions that block nothing: take the next step.
- Stop only when nothing can move forward without the user, or when what blocks you is
  deliberately protected (a permission, a ruleset, a secret). Then say exactly what is needed.
- Still confirm destructive or irreversible actions outside the normal flow (deleting data,
  rewriting history, changing settings); the normal flow (branch, commit, PR, merge, release) is
  not one of them.

## Product invariants

- This repository knows nothing about any host: no hostnames, machines, cloud projects,
  deployment tooling or credentials. CI publishes a signed image and reaches nothing but the
  registry; no workflow deploys, uses ssh/scp or dispatch triggers, or uses a secret other than
  `GITHUB_TOKEN`. ([ADR 0002](docs/adr/0002-signed-image-release-at-arms-length.md))
- The signing identity (`.github/workflows/ci.yml` on `refs/heads/main`) and the `:latest` tag
  are what hosts verify and pull. Never change the workflow path or branch without updating every
  verifying host's policy to accept both during the switch.
  ([ADR 0002](docs/adr/0002-signed-image-release-at-arms-length.md))
- Images are built and checked against the runtime contract in CI only, never on a host.
  ([ADR 0002](docs/adr/0002-signed-image-release-at-arms-length.md))
- Accounts are local and created only by `scripts/users.js`; login never creates users; a session
  needs its user row and a matching token version, and a token without a version counts as 0 so
  older cookies stay valid. ([ADR 0003](docs/adr/0003-local-password-accounts.md))
- Schema changes are new numbered migrations applied on startup; the image carries `migrations/`.
  ([ADR 0006](docs/adr/0006-versioned-migrations-on-startup.md))
- Hidden stories live on the server only. ([ADR 0007](docs/adr/0007-hidden-stories-server-side.md))
- Story queries keep their forced index per timespan and fresh `ANALYZE` statistics.
  ([ADR 0005](docs/adr/0005-query-planner-statistics-and-index-hints.md))
- $0 running cost; the app fits a 1 GB, 0.25 vCPU machine on a slow disk. Fix performance by
  doing less work. ([ADR 0008](docs/adr/0008-zero-budget-small-machine.md))
- One Node major in `.node-version`, CI and the Dockerfile. ([ADR 0010](docs/adr/0010-one-node-major.md))

## Engineering philosophy

- No compatibility shims. When a structure is wrong, replace it and migrate its callers in the
  same change.
- The smallest correct design. Simplicity first; measure before optimizing, never optimize on a
  hunch.
- One owner per fact, per mutation and per side effect. Two places that know the same thing will
  disagree.
- Abstractions only at real boundaries (a process, a network, a storage format, a platform), not
  in anticipation.
- Don't guess and don't fabricate: an unknown API, path, value or result is looked up, measured or
  reported as unknown.
- You own the repository. Nothing is "pre-existing" or someone else's problem, and red CI is never
  waived: it is fixed first.
- Comments and docs describe current behavior and why it is that way, never its history.

## Engineering practices

- Test first. A change in behavior starts with a test that fails without it.
- Every bug, CI failure and review finding gets a regression test, seen failing before the fix;
  quote its red output in the PR.
- The instrumentation flywheel, every increment:
  - Never guess a bug's cause. If the logs and metrics can't explain it, add the instrumentation
    first, so this occurrence or the next one is diagnosable, then fix.
  - Never guess at performance: measure, keep a baseline, optimize, and report before and after.
  - Even when nothing is blocked, review the instrumentation on every path you touched: add what
    was missing, remove what is noise.
- Tests are hermetic: temporary directories and fixtures, never the developer's real data, config
  or accounts.
- JavaScript: ESLint flat configs in the root and `hackernews-frontend/`; husky + lint-staged run
  `eslint --fix` on staged files. Backend tests are Jest on in-memory SQLite (`setDb()`), frontend
  tests Vitest with React Testing Library. Use the npm scripts, not bare `npx jest`: they set
  `--experimental-vm-modules` for the ESM-only `jose` ([ADR 0004](docs/adr/0004-jose-for-jwt.md)).
- Tests tag the requirement they prove with a `// Validates: HN-NNN` comment above the test.
- Every action in `.github/workflows/` is pinned to a full commit SHA with a `# vX.Y.Z` comment
  (`tests/unit/compose.test.js` enforces the SHA), tools in `run:` to exact versions, the base
  image by digest.
- Dependencies stay current through Dependabot's grouped weekly PRs (actions, base image, both npm
  packages); merge them when `CI gate` is green.

## Commands

Node 24 (`.node-version`). In a cloud session the SessionStart hook (`scripts/cloud-setup.sh`)
installs it and both packages; anywhere else run `npm ci` here and in `hackernews-frontend/`.

```sh
script/verify                                   # everything CI checks but the image; before every push
npm run lint                                    # backend lint (frontend: cd hackernews-frontend && npm run lint)
npm test                                        # backend tests (frontend: cd hackernews-frontend && npm test)
npm test -- -t "name of the test"               # one backend test (frontend: npx vitest run -t "...")
npm run lint:fix                                # format/fix (frontend: cd hackernews-frontend && npm run lint:fix)
npm run watch                                   # backend dev server
cd hackernews-frontend && npm start             # frontend dev server
npm run users -- list | add <u> | set-password <u> | revoke-sessions <u>
npm run migrate | migrate:rollback | migrate:status
scripts/preview.sh                              # seeded throwaway app + screenshots in preview-shots/
scripts/image-smoke.sh <image>                  # check an image against the runtime contract
script/process-check                            # requirements, Validates tags and doc links agree
script/stage start | pre-merge <PR> | post-merge <PR>
```

`scripts/preview.sh` builds the frontend, serves a seeded throwaway database with a test account,
writes logged-out, logged-in and dark screenshots to `preview-shots/`, then removes the database
and account, even on failure; `PREVIEW_HOLD=1` keeps it running. Open the PNGs to look at them
(details in [docs/design/testing.md](docs/design/testing.md)). Tests, previews and CI need no
credentials or secrets; preview generates a random `SECRET`.

## Where docs live

- `docs/index.md` maps every doc. Requirements live in `docs/requirements.md`: stable IDs, one
  EARS sentence each, current behavior only, each `[verified]` by a test tagged
  `Validates: <ID>` or `unverified: <why>`. Future work lives in GitHub issues, not in docs.
- `docs/architecture.md` says how the code is built and why; `docs/adr/NNNN-title.md` records each
  decision (superseded, never deleted); `docs/lessons.md` holds rules learned and open problems,
  and is pruned when they are resolved.
- Update the docs and this file in the same PR as the code they describe.
- Design notes for the API, database and tests live in `docs/design/`; the release and runtime
  contract in `docs/release.md`.

## Increment lifecycle

1. **Start**: `script/stage start`. Anything red on main or in the last scheduled run, and any
   unanswered review comment on recent PRs, is fixed before new work. Read the open issues.
2. **Ready**: write the Definition of Ready in the PR body: the problem, requirement IDs or
   issue, acceptance criteria, what is out of scope.
3. **Test first**, then implement with the instrumentation flywheel.
4. **Verify** with the one verify command; it must be green before pushing.
5. **Docs** (requirements, architecture, ADRs, lessons, this file) in the same PR.
6. **Land**: PR, wait for `CI gate`, squash-merge, which releases (see Git, CI and PRs).
7. **Report**: after the merge, one PR comment with the Definition of Done checklist and the final
   increment report (below).

A plan that spans several increments lives in a GitHub tracking issue with a checklist, never in
a file. Never committed: per-PR report or readiness files, session state or resume files, ledgers
of merged PRs. That information belongs in the PR and its comments.

## Git, CI and PRs

- One branch per increment, cut from a fresh `origin/main`, named `feat/`, `fix/`, `docs/`,
  `chore/`, `refactor/` or `perf/` plus a short topic. Never reuse a branch after its PR merged;
  never name a branch for the tool that wrote it.
- Every change lands through a PR whose body fills `.github/pull_request_template.md`. CI checks
  the body, and that a PR titled `fix...` changes a test.
- `CI gate` is the one required check: a job that needs every other job. Wait for it
  (`script/stage pre-merge <PR>`), and fix every failure; never bypass it.
- Squash-merge as soon as `CI gate` is green, without asking: in a cloud session with
  `gh api -X PUT repos/<owner>/<repo>/pulls/<N>/merge -f merge_method=squash -f sha=<head sha>`
  (`script/stage post-merge <PR>` does this); locally with `gh pr merge --auto --squash`.
- Merging to main releases; nobody tags or publishes by hand.
- The cloud sessions' GitHub proxy refuses tag pushes, branch deletion and GraphQL: use the REST
  API (`gh api`), and leave branch deletion to GitHub's delete-on-merge and the branch-cleanup
  workflow.
- Commit messages: an imperative subject saying what changed; the body says why.
- Cloud sessions are the default place to work; nothing here needs a particular machine. The
  SessionStart hook in `.claude/settings.json` runs `scripts/cloud-setup.sh`, which does nothing
  unless `CLAUDE_CODE_REMOTE=true`.
- Releases: every push to main whose CI passes is a release. The `image` job builds linux/amd64
  and linux/arm64 natively, pushes each untagged by digest with provenance and an SBOM, pulls it
  back and runs `scripts/image-smoke.sh`; then `release` tags one index `:<sha>` and `:latest`,
  signs it with cosign keyless and verifies the signature. Releases are identified by commit SHA,
  so there is no version number or series to bump. PRs and the weekly scheduled run build and
  check both images but publish nothing.
- CI (`.github/workflows/ci.yml`): `workflows` (actionlint), `backend-tests`, `frontend-tests`,
  `image`, `release`, `process` (`script/process-check`, and `script/pr-check` on PRs) and
  `CI gate`; weekly on main (Wednesday 05:37 UTC). No manual or dispatch triggers (forbidden by
  ADR 0002). Branch cleanup: `.github/workflows/branch-cleanup.yml`.

## Privacy review

Before every commit, read your own staged diff (`git diff --cached`) and remove anything private
about the maintainer, their family or their computers: people's names, addresses, personal email
addresses and accounts, hostnames, home-directory paths, IP addresses, tenant, client or vault
IDs, real personal documents or photos. Use neutral stand-ins in tests and examples. There is no
list of private terms to check against: judge the diff.

## Definition of Done

An increment is done when every line holds; the final report marks each ✅ or ❌ with evidence:

- [ ] Start stage clean: main CI, the last scheduled run and recent review comments were green or
      fixed first.
- [ ] Tests first; the regression test's red output before the fix is quoted.
- [ ] The verify command is green, and CI is green on the final commit.
- [ ] Traceability and doc checks (`script/process-check`, `script/pr-check`) are green.
- [ ] Docs and CLAUDE.md are updated in the same PR.
- [ ] Instrumentation reviewed on touched paths: what was added, what removed, or why it is
      adequate.
- [ ] Privacy review done on every commit's staged diff.
- [ ] Every review thread is answered or resolved.
- [ ] Merged; main CI green; the release it produced is linked.
- [ ] Clean up: only main and open PRs' branches remain on the remote; the working tree is clean.

### Final increment report

One PR comment after the merge, with these parts:

1. **Done / not done**: what the increment delivered, and anything left out.
2. **Definition of Ready**: as written, and whether it held.
3. **Requirements, ADRs and docs**: IDs added, changed or retired; ADRs; docs touched.
4. **Design decisions**: each with the alternatives considered and why they lost.
5. **Verification evidence**: commands, CI run links and durations, release link.
6. **Regression test**: name and red output before the fix (or "no bug fixed").
7. **Diagnosis**: for a bug, the root cause and how it was established.
8. **Instrumentation**: added, removed, and gaps still open.
9. **Performance**: before and after numbers, or "not touched".
10. **Privacy review**: done on every commit; anything removed.
11. **Smells**: what looked wrong but was out of scope.
12. **Follow-ups**: each filed as an issue, linked.
13. **Definition of Done**: the checklist above, each line ✅ or ❌ with evidence.
