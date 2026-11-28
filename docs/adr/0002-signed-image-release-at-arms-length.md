# 0002. A release is a signed image; the runtime contract is the only interface

- Status: accepted
- Date: 2026-11-27 (recorded; in force since the release workflow was rebuilt)

## Context and problem

The app has to reach whatever runs it without this repository knowing about, or holding
credentials for, any host. Earlier, images were built on the running machine, which saturated its
disk, and a workflow that deploys needs deployment secrets in CI (HN-060 to HN-065).

## Decision drivers

- No host names, machines, cloud projects or deployment credentials in this repository.
- A host can prove a release came from this repository's CI on its default branch.
- Every published image has passed the same runtime checks a host will impose.

## Considered options

### CI deploys to the host (ssh, dispatch)

- Good: one place drives rollout.
- Bad: CI holds credentials for the host; the repository encodes the host.
- Failure modes: a leaked secret reaches the host; a host change breaks this repository's CI.

### CI publishes a signed image and stops

- Good: CI holds only `GITHUB_TOKEN` and an OIDC token for the signature; hosts verify and pull
  on their own.
- Bad: rollout timing is the host's; a host must keep its verification policy in step with the
  signing identity.
- Failure modes: if the signing identity changes (workflow path or branch), hosts that verify it
  stop updating until their policy accepts the new one.

## Decision

CI builds amd64 and arm64 natively, pushes each by digest with provenance and an SBOM, checks the
exact pushed image with `scripts/image-smoke.sh` against the runtime contract in
`docs/release.md`, and only then tags one index `:<sha>` and `:latest`, signs it keylessly with
cosign and verifies the signature. The signing identity is `.github/workflows/ci.yml` on the
default branch's ref. No workflow deploys, uses ssh/scp or dispatch triggers, or uses a secret
other than `GITHUB_TOKEN`. Images are built only in CI.

## Consequences

`:latest` must stay in the tags (hosts track it). The workflow file path and the branch name are
part of the published identity: renaming either is a coordinated change with every host that
verifies it, accepting both identities during the switch. Adding `workflow_dispatch` or a
deployment step is forbidden.

## Confirmation

`tests/unit/compose.test.js` (HN-060 to HN-062, HN-064) fails on ssh/scp, dispatch triggers,
foreign secrets, actions outside `actions/`, `docker/`, `sigstore/`, unpinned actions, a missing
`:latest`, or a release that does not need the image checks. `tests/unit/dockerfile.test.js`
(HN-063) and `scripts/image-smoke.sh` (HN-065) check the image itself.

## Retirement proof

A host that cannot verify cosign signatures, or a need for this repository to drive rollout,
shown concretely.

## Reversal plan

Add a deployment job and its credentials, and remove the guards in `compose.test.js`. Cheap in
code, expensive in exposure; not planned.
