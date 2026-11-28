# 0010. One Node major everywhere, changed on purpose

- Status: accepted
- Date: 2026-11-27 (recorded)

## Context and problem

The Node major appears in `.node-version` (cloud sessions), CI's `setup-node`, and the Dockerfile's
base image. A Dependabot bump of only the Dockerfile's Node major would split the image from what
was tested (HN-071).

## Decision drivers

- What CI tests is what ships.
- Pin refreshes stay automatic; majors are deliberate.

## Considered options

### Let Dependabot propose Node majors

- Good: nothing to remember.
- Bad: it changes one of three places, so the image runs a Node that CI never tested.

### One major in three places, guarded by a test; Dependabot ignores Node majors

- Good: a major moves as one change.
- Bad: someone has to start it.

## Decision

`.node-version`, every `node-version:` in CI and every `FROM node:` in the Dockerfile name the same
major; Dependabot's docker entry ignores `node` major updates. The app needs Node 24 or later
(jose through native `require(esm)`, ADR 0004).

## Consequences

A Node major upgrade is a PR that edits all three and the docs.

## Confirmation

`tests/unit/cloudSetup.test.js` "pins the same Node major as CI and the Dockerfile" and "never lets
Dependabot propose a Node major on its own" (HN-071).

## Retirement proof

A single source for the Node version that all three read.

## Reversal plan

Delete the Dependabot ignore rule and the test.
