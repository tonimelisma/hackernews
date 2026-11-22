#!/bin/bash
# Runner side of .github/workflows/ops.yml: runs one ops job and leaves its
# results in $WORK/hn-ops.tar.age, encrypted to ops/age-recipient.txt.
#
# This repo is public, so this script's own output is the public log. It
# prints only fixed text and the digits-only summary line; every result,
# error message and generated password goes into $OUT, which the EXIT trap
# encrypts and then deletes.
#
# Input (from the "Check request" step): JOB, WHERE, BACKUP, LINES,
# GENERATE_PASSWORD, WORK; the username, if any, in $WORK/private/username.
set -euo pipefail

: "${JOB:?}" "${WHERE:?}" "${WORK:?}"
GCP_PROJECT=melisma-services
GCP_ZONE=us-central1-a
GCP_INSTANCE=vps-1
BUCKET=hackernews-melisma-backup
HERE=$(cd "$(dirname "$0")" && pwd)

OUT=$WORK/out
REPORT=$OUT/report.txt
mkdir -p "$OUT"
chmod 700 "$WORK" "$OUT"
: >"$REPORT"

# shellcheck disable=SC2317,SC2329 # runs from the EXIT trap
seal() {
  local rc=$?
  echo "exit=$rc" >>"$REPORT"
  if tar -C "$WORK" -cf - out | age -R "$HERE/age-recipient.txt" -o "$WORK/hn-ops.tar.age"; then
    echo "Results encrypted ($(stat -c %s "$WORK/hn-ops.tar.age") bytes)."
  else
    rm -f "$WORK/hn-ops.tar.age"
    echo "::error::Encrypting the results failed; nothing will be uploaded."
    rc=1
  fi
  rm -rf "$OUT" "$WORK/private"
  exit "$rc"
}
trap seal EXIT

username=""
if [[ -f $WORK/private/username ]]; then username=$(<"$WORK/private/username"); fi
{
  echo "job: $JOB"
  if [[ -n $username ]]; then echo "username: $username"; fi
  if [[ -n ${BACKUP:-} ]]; then echo "backup: $BACKUP"; fi
} >>"$REPORT"

stdin=/dev/null
if [[ ${GENERATE_PASSWORD:-false} == true ]]; then
  # 24 random bytes, URL-safe base64: 32 characters.
  password=$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=\n')
  echo "::add-mask::$password"
  echo "password: $password" >>"$REPORT"
  # users.js reads the password and then its confirmation, one per line.
  printf '%s\n%s\n' "$password" "$password" >"$WORK/private/stdin"
  stdin=$WORK/private/stdin
fi

run_on_vps() {
  local args=() script command
  case $JOB in
    users-add | users-set-password | users-revoke-sessions) args=("$username") ;;
    logs) args=("$LINES") ;;
    restore) args=("$BACKUP" "confirm=$BACKUP") ;;
  esac
  # The script travels as base64 inside the command, so stdin stays free for
  # the password. Every argument was validated to [A-Za-z0-9._=-] by
  # ops/workflow.js, so it needs no quoting on the remote shell.
  script=$(base64 -w0 "$HERE/remote.sh")
  command="sudo bash -c \"\$(echo $script | base64 -d)\" hn-ops $JOB ${args[*]}"
  gcloud compute ssh "$GCP_INSTANCE" --project="$GCP_PROJECT" --zone="$GCP_ZONE" \
    --tunnel-through-iap --quiet --ssh-flag=-T --command="$command" \
    <"$stdin" >"$OUT/result.txt" 2>"$OUT/ssh-stderr.txt"
}

run_on_runner() {
  local listing count newest bytes
  case $JOB in
    backups-list)
      listing=$(gcloud storage ls -l "gs://$BUCKET/" 2>"$OUT/gcloud-stderr.txt")
      echo "$listing" >>"$REPORT"
      count=$(grep -c 'gs://' <<<"$listing" || true)
      newest=$(grep -oE 'hackernews-[0-9]{8}' <<<"$listing" | sort | tail -n 1 | grep -oE '[0-9]{8}' || echo 0)
      bytes=$(awk '/^TOTAL:/ {print $4}' <<<"$listing")
      echo "HN_OPS_SUMMARY ok=1 backups=$count newest=$newest total_bytes=${bytes:-0}" >"$OUT/result.txt"
      ;;
    backups-download)
      gcloud storage cp "gs://$BUCKET/$BACKUP" "$OUT/$BACKUP" 2>"$OUT/gcloud-stderr.txt"
      echo "HN_OPS_SUMMARY ok=1 bytes=$(stat -c %s "$OUT/$BACKUP")" >"$OUT/result.txt"
      ;;
  esac
}

rc=0
case $WHERE in
  vps) run_on_vps || rc=$? ;;
  runner) run_on_runner || rc=$? ;;
esac
if [[ $rc -ne 0 ]]; then echo "The job's command failed (exit $rc); details are in the encrypted artifact."; fi

# Public: the digits-only summary, or a fixed "unavailable" line.
node "$HERE/workflow.js" summary "$OUT/result.txt" || true
last=$(grep '^HN_OPS_SUMMARY' "$OUT/result.txt" 2>/dev/null | tail -n 1 || true)
if [[ $rc -eq 0 && $last != "HN_OPS_SUMMARY ok=1"* ]]; then rc=1; fi
exit "$rc"
