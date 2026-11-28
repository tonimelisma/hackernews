# 0007. Hidden stories live on the server only

- Status: accepted
- Date: 2026-11-27 (recorded)

## Context and problem

Users hide stories they have seen. Keeping hidden IDs in the browser loses them across devices and
forces client-side filtering of up to 500 stories (HN-005, HN-011 to HN-013, HN-043).

## Decision drivers

- The same hidden list on every browser of a user.
- One owner for the filter: the query that already pages stories.

## Considered options

### localStorage plus server sync

- Good: works logged out.
- Bad: two owners of one fact; merge rules; client filtering.

### Server only, login required

- Good: one SQL `WHERE id NOT IN (...)` in `getStories`; no client filter.
- Bad: logged-out users cannot hide.

## Decision

Hiding requires login. `GET /stories` reads the cookie optionally and excludes the user's hidden
IDs in SQL. The client removes a hidden story optimistically and restores it if the POST fails, and
re-fetches stories on login and logout. No hidden state is stored in the browser. `upsertHidden`
never creates users.

## Consequences

The hide button shows only when logged in.

## Confirmation

`tests/integration/api.test.js` and `tests/integration/storyService.test.js` (HN-005, HN-011 to
HN-013); `hackernews-frontend/src/App.test.jsx` "reverts stories when addHidden API call fails"
and "does not show hide button when logged out" (HN-043).

## Retirement proof

A requirement to hide without an account.

## Reversal plan

Add browser storage for logged-out users and merge on login; the server path stays.
