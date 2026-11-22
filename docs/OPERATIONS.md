# Operations

Production work on vps-1 (accounts, logs, health, backups, restores, DB
stats) runs as the GitHub Actions workflow
[`.github/workflows/ops.yml`](../.github/workflows/ops.yml), started from a
Claude Code cloud session with [`scripts/ops.sh`](../scripts/ops.sh). Nobody
needs SSH, `gcloud` or Toni's Mac for it. Deploys are separate: merging to
`master` is the deploy ([ARCHITECTURE.md](ARCHITECTURE.md#cicd-pipeline-and-deploys)).

Only vps-1 (GCP project `melisma-services`) is reachable from Actions. The
home server purkki is never involved.

## How it works

```
cloud session                          GitHub Actions (public log)            vps-1
─────────────                          ───────────────────────────            ─────
scripts/ops.sh users-add --user X
  POST repos/…/dispatches  ──────────▶ ops.yml (repository_dispatch hn-ops)
  {job, username, request_id}            ops/workflow.js: validate payload
                                           from the event file, mask user
                                         google-github-actions/auth (WIF)
                                           → GCP_SA_EMAIL, no stored key
                                         ops/run.sh: generate password
                                           gcloud compute ssh --tunnel-       sudo bash -c <ops/remote.sh>
                                           through-iap, password on stdin ──▶   docker compose exec app
                                                                                node scripts/users.js add X
                                         log: "HN_OPS_SUMMARY ok=1" only  ◀── output (all of it)
                                         tar + age -R ops/age-recipient.txt
                                         upload artifact hn-ops-<id> (1 day)
  poll runs (display_title has the id)
  GET …/artifacts/<id>/zip  ◀─────────
  age -d with $HN_OPS_AGE_KEY
  DELETE …/artifacts/<id>
  → $TMPDIR/hn-ops/<id>/out/{report.txt,result.txt,…}
```

`repository_dispatch` always runs the workflow file on `master`, so a change
to `ops.yml` or `ops/` takes effect only once merged.

### The repo is public: what may appear in the log

Workflow logs and artifacts of this repo are public. The rules, each guarded
by `tests/unit/ops.test.js` / `tests/unit/opsRun.test.js`:

- **The log shows only pass/fail and digits.** The single result line is
  `HN_OPS_SUMMARY key=<digits> …`; `ops/workflow.js summary` prints it only
  if it matches `^HN_OPS_SUMMARY( key=\d+)+$`, otherwise a fixed
  "unavailable" line. Error messages never quote request values.
- **Everything else is encrypted before upload**: the user list, log lines,
  generated passwords, error output, backups. `ops/run.sh` tars its output
  directory, encrypts it with `age` to `ops/age-recipient.txt`, deletes the
  plaintext, and the workflow uploads only `hn-ops.tar.age` (retention 1 day;
  `scripts/ops.sh` deletes it as soon as it has downloaded it).
- **Request values never reach `env:` or `run:` text** (the log prints both,
  and `${{ }}` in `run:` is a script-injection hole). `ops/workflow.js`
  reads them from `$GITHUB_EVENT_PATH`; the username goes to a private file
  and is `::add-mask::`ed. Only `job` and `request_id` appear in `run-name`.
- **User jobs are `repository_dispatch` only.** `workflow_dispatch` inputs
  show on the public run page, so the GitHub-UI form offers only jobs without
  a username.
- **Passwords are generated in the workflow** (`openssl rand`, 32 URL-safe
  characters), sent to `users.js` on stdin (never an argument), masked, and
  leave the runner only inside the encrypted bundle.
- `ops/remote.sh` re-validates its arguments on the server before touching
  anything.

## Jobs

Run from the repo root in a cloud session. Results land in
`${HN_OPS_OUT:-$TMPDIR/hn-ops}/<request id>/out/` (`report.txt`: job,
username, generated password; `result.txt`: the job's output and summary);
read them with the Read tool. Relay a generated password to Toni and do not
write it anywhere else.

| Job | Command | Public summary |
|-----|---------|----------------|
| List accounts | `scripts/ops.sh users-list` | `accounts` |
| Create account (generates the password) | `scripts/ops.sh users-add --user NAME` | `ok` |
| Reset password (generates it; other browsers stay logged in) | `scripts/ops.sh users-set-password --user NAME` | `ok` |
| Log an account out of every browser | `scripts/ops.sh users-revoke-sessions --user NAME` | `ok` |
| Logs: app, worker, Caddy, update timer, backup log | `scripts/ops.sh logs [--lines 200]` (max 5000 per source) | line counts |
| Health and resources | `scripts/ops.sh health` | `app_healthy app_api caddy_running app_restarts update_timer mem_used_mb mem_total_mb swap_used_mb disk_used_pct load1_x100 uptime_days last_backup` |
| DB size and row counts | `scripts/ops.sh db-stats` | `stories users hidden migrations db_bytes wal_bytes pages free_pages page_size newest_story_age_min` |
| Manual backup (the nightly script) | `scripts/ops.sh backup` | `ok` |
| List backups | `scripts/ops.sh backups-list` | `backups newest total_bytes` |
| Download a backup | `scripts/ops.sh backups-download --backup hackernews-YYYYMMDD.db.gz` | `bytes` |
| **Restore** (destructive) | `scripts/ops.sh restore --backup hackernews-YYYYMMDD.db.gz --confirm "restore hackernews-YYYYMMDD.db.gz"` | `restored_stories safety_copy app_healthy` |

Restore downloads the object on the server, runs `PRAGMA integrity_check` on
it, uploads a safety copy of the current database as
`prerestore-<UTC time>.db.gz` (outside the `hackernews-` prefix, so nightly
retention never deletes it), runs sqlite3 `.restore` inside the container,
restarts the app and waits for it to be healthy. To undo, restore the
`prerestore-…` object the same way. The `confirm` value must name the exact
backup, both in the workflow and on the server.

The health check from outside needs no workflow:
`curl -s "https://hackernews.melisma.net/api/v1/stories?timespan=Day&limit=1"`.

The GitHub UI's "Run workflow" form (Actions → Ops) offers `health`,
`db-stats`, `logs`, `users-list`, `backup`, `backups-list`,
`backups-download` and `restore`; its results still need `scripts/ops.sh`'s
decryption, so it is mainly for Toni on a phone.

### Artifact download through the cloud proxy

Verified 2026-11-22: `GET repos/tonimelisma/hackernews/actions/artifacts`
and `GET …/actions/artifacts/<id>/zip` both work with `gh api` from a cloud
session (the zip's redirect to GitHub's blob storage is followed through the
proxy). `DELETE …/actions/artifacts/<id>` works too (verified the same day:
204, then 404 on read-back), so `scripts/ops.sh` removes each artifact right
after downloading it; if that ever fails, the artifact still expires after
one day.

## Owner setup

One-time steps only Toni can do (also listed in [CLAUDE.md](../CLAUDE.md#owner-setup)):

1. **GCP Workload Identity Federation** — run `deploy/gcp-wif-setup.sh` from
   the latchkey repo. This workflow expects it to:
   - create a pool/provider trusting `https://token.actions.githubusercontent.com`
     with an attribute condition limiting it to
     `assertion.repository == 'tonimelisma/hackernews'` (ideally also
     `assertion.ref == 'refs/heads/master'`; `repository_dispatch` runs on
     `master`);
   - create a service account for this repo and let the provider
     impersonate it (`roles/iam.workloadIdentityUser`);
   - grant that service account: `roles/iap.tunnelResourceAccessor` and
     `roles/compute.osAdminLogin` on vps-1 (sudo through OS Login; OS Login
     enabled on the instance), `roles/compute.viewer` on the project,
     `roles/iam.serviceAccountUser` on the VM's own service account (OS Login
     requires it), and `roles/storage.objectViewer` on
     `gs://hackernews-melisma-backup` (for `backups-list`/`backups-download`;
     backup and restore run on the VM with its own `storage-rw` scope).
2. **Repository variables** (Settings → Secrets and variables → Actions →
   Variables; not secrets, these are not sensitive):
   - `GCP_WIF_PROVIDER` — `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`
   - `GCP_SA_EMAIL` — the service account's email
3. **age key pair** — on the Mac: `brew install age` then `age-keygen`. Put
   the `AGE-SECRET-KEY-1…` line in the claude.ai cloud environment as the
   variable `HN_OPS_AGE_KEY`. Then, in a cloud session,
   `scripts/ops.sh recipient` writes the matching public key to
   `ops/age-recipient.txt`; commit and merge it. Until then every ops run
   stops at "Check encryption key" and uploads nothing.
4. **Cloud environment network**: the Default environment is currently
   unrestricted. If it is ever limited, allow `hackernews.melisma.net` (smoke
   checks), and for local image builds `registry-1.docker.io`,
   `auth.docker.io`, `production.cloudfront.docker.com` and
   `dl-cdn.alpinelinux.org` (all verified reachable 2026-11-22). GitHub
   (API, artifact downloads) and npm are allowed by default.

### First run after setup

Once steps 1–3 are done and merged, check each path from a cloud session (all
read-only):

```bash
scripts/ops.sh health
scripts/ops.sh db-stats
scripts/ops.sh users-list
scripts/ops.sh logs --lines 50
scripts/ops.sh backups-list
```

The raw dispatch, if `scripts/ops.sh` itself is in doubt:

```bash
gh api -X POST repos/tonimelisma/hackernews/dispatches --input - <<'EOF'
{"event_type": "hn-ops", "client_payload": {"job": "health", "request_id": "manual-check-0001"}}
EOF
gh api "repos/tonimelisma/hackernews/actions/workflows/ops.yml/runs?per_page=1" --jq '.workflow_runs[0] | [.id, .status, .conclusion, .display_title] | @tsv'
```

## Break-glass (Toni's workstation)

If GitHub Actions or the WIF setup is down, the same commands work over IAP
SSH with Toni's own `gcloud` login, e.g.
`gcloud compute ssh --tunnel-through-iap --project=melisma-services vps-1 --zone=us-central1-a --command="docker exec hackernews-app-1 node scripts/users.js list"`.
[ARCHITECTURE.md](ARCHITECTURE.md#deployment--operations) has the server
layout these commands rely on.
