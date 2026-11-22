#!/bin/bash
# Run a production job on vps-1 from a cloud session, through
# .github/workflows/ops.yml, and decrypt its results. See docs/OPERATIONS.md.
#
#   scripts/ops.sh <job> [--user NAME] [--backup OBJECT] [--confirm TEXT] [--lines N]
#   scripts/ops.sh recipient    # write HN_OPS_AGE_KEY's public key to ops/age-recipient.txt
#
# Jobs: users-list users-add users-set-password users-revoke-sessions logs
#       health db-stats backup restore backups-list backups-download
#
# Needs: gh (REST only), jq, age, unzip, and HN_OPS_AGE_KEY (the age private
# key, a cloud environment variable). Results land in $HN_OPS_OUT/<request id>
# (default: a private directory under ${TMPDIR:-/tmp}); the encrypted
# artifact is deleted from GitHub once downloaded.
set -euo pipefail

REPO=${HN_OPS_REPO:-tonimelisma/hackernews}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TIMEOUT=${HN_OPS_TIMEOUT:-1800}

die() {
  echo "ops: $*" >&2
  exit 1
}

need_key() {
  [[ ${HN_OPS_AGE_KEY:-} == AGE-SECRET-KEY-1* ]] ||
    die "HN_OPS_AGE_KEY is not set in this cloud environment (Owner setup in CLAUDE.md)."
}

if [[ ${1:-} == recipient ]]; then
  need_key
  file=$ROOT/ops/age-recipient.txt
  grep '^#' "$file" >"$file.new" || true
  age-keygen -y <(printf '%s\n' "$HN_OPS_AGE_KEY") >>"$file.new"
  mv "$file.new" "$file"
  echo "Wrote $(grep -c '^age1' "$file") public key to ops/age-recipient.txt; commit it."
  exit 0
fi

job=${1:-}
[[ -n $job && $job != -* ]] || die "usage: scripts/ops.sh <job> [--user NAME] [--backup OBJECT] [--confirm TEXT] [--lines N]"
shift
payload=$(jq -n --arg job "$job" '{job: $job}')
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || die "$1 needs a value"
  case $1 in
    --user) key=username ;;
    --backup) key=backup ;;
    --confirm) key=confirm ;;
    --lines) key=lines ;;
    *) die "unknown option $1" ;;
  esac
  payload=$(jq --arg k "$key" --arg v "$2" '.[$k] = $v' <<<"$payload")
  shift 2
done
need_key

request_id="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
payload=$(jq --arg id "$request_id" '.request_id = $id' <<<"$payload")
jq -n --argjson p "$payload" '{event_type: "hn-ops", client_payload: $p}' |
  gh api -X POST "repos/$REPO/dispatches" --input - >/dev/null
echo "Dispatched $job (request $request_id); waiting for the run..."

run_id=""
deadline=$((SECONDS + TIMEOUT))
while [[ -z $run_id ]]; do
  ((SECONDS < deadline)) || die "no run appeared for request $request_id"
  sleep 5
  run_id=$(gh api "repos/$REPO/actions/workflows/ops.yml/runs?event=repository_dispatch&per_page=30" \
    --jq ".workflow_runs[] | select(.display_title | endswith(\" $request_id\")) | .id" | head -n 1)
done
echo "Run: https://github.com/$REPO/actions/runs/$run_id"

status=""
while [[ $status != completed ]]; do
  ((SECONDS < deadline)) || die "run $run_id did not finish in ${TIMEOUT}s"
  sleep 10
  status=$(gh api "repos/$REPO/actions/runs/$run_id" --jq .status)
done
conclusion=$(gh api "repos/$REPO/actions/runs/$run_id" --jq .conclusion)
echo "Conclusion: $conclusion"

artifact=$(gh api "repos/$REPO/actions/runs/$run_id/artifacts" \
  --jq ".artifacts[] | select(.name == \"hn-ops-$request_id\") | .id" | head -n 1)
if [[ -z $artifact ]]; then
  echo "No results artifact (the run stopped before the job ran); see the run's log."
  [[ $conclusion == success ]] && exit 0
  exit 1
fi

out=${HN_OPS_OUT:-${TMPDIR:-/tmp}/hn-ops}/$request_id
mkdir -p "$out"
chmod 700 "$out"
gh api "repos/$REPO/actions/artifacts/$artifact/zip" >"$out/artifact.zip"
unzip -q -o "$out/artifact.zip" -d "$out"
age -d -i <(printf '%s\n' "$HN_OPS_AGE_KEY") "$out/hn-ops.tar.age" | tar -C "$out" -xf -
rm -f "$out/artifact.zip" "$out/hn-ops.tar.age"
if gh api -X DELETE "repos/$REPO/actions/artifacts/$artifact" >/dev/null 2>&1; then
  echo "Deleted the encrypted artifact from GitHub."
else
  echo "Could not delete artifact $artifact (it expires after 1 day)."
fi

echo "Results: $out/out"
ls -l "$out/out"
grep '^HN_OPS_SUMMARY' "$out/out/result.txt" 2>/dev/null | tail -n 1 || true
[[ $conclusion == success ]]
