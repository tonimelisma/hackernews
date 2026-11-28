# 0008. Zero running cost; sized for a 1 GB machine

- Status: accepted
- Date: 2026-11-27 (recorded)

## Context and problem

The app is a personal-scale service. It must cost nothing to build and publish and run well on a
1 GB RAM, 0.25 vCPU machine with a slow disk (HN-063, HN-065).

## Decision drivers

- Hard $0 per month for this repository: GitHub Actions for a public repository and a public GHCR
  package only.
- Performance problems are fixed by doing less work, not by bigger machines.

## Considered options

### Paid managed services (database, hosting, CI)

- Good: less to operate.
- Bad: recurring cost; credentials.

### Free CI and registry, one small container

- Good: no cost; one process and one file.
- Bad: every heavy operation (password hashing, queries, builds) must fit a small machine.

## Decision

Only free GitHub Actions and public GHCR. One Node process with the worker inside it, SQLite in one
file. Heavy work is measured on small hardware assumptions: scrypt parameters chosen to stay out of
swap (ADR 0003), query plans pinned (ADR 0005), images built in CI, never on the host (ADR 0002).

## Consequences

Never assume paid infrastructure. The health check allows at least 10 s, because under disk
contention a healthy app has taken more than 5 s.

## Confirmation

Review rule; `tests/unit/compose.test.js` "gives the health check at least 10 s before timing
out" (HN-064); `tests/unit/auth.test.js` "uses production scrypt parameters by default" (HN-024).

## Retirement proof

A decision to fund paid infrastructure for this app.

## Reversal plan

Not applicable; a funding decision would add services, each with its own ADR.
