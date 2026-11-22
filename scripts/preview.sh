#!/usr/bin/env bash
# Runs the app on a throwaway database with a seeded test account, screenshots
# it logged out and logged in, then removes everything it made (server, DB,
# test account) — also on failure — and confirms the removal.
#
#   scripts/preview.sh [out-dir]           # default out-dir: ./preview-shots
#   PREVIEW_HOLD=1 scripts/preview.sh      # keep serving until Ctrl-C / kill,
#                                          # for manual curl/screenshot checks
#   PORT=3100 scripts/preview.sh           # default port 3100
#
# Never touches data/hackernews.db or any real account: the test user lives
# only in the temp DB, which is deleted at the end. Builds the frontend first
# (Express serves hackernews-frontend/build, as in production).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/preview-shots}"
PORT="${PORT:-3100}"
BASE="http://localhost:$PORT"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/hn-preview.XXXXXX")"
USERNAME="claude-preview"
PASSWORD="$(node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))')"
SERVER_PID=""

cleanup() {
  local status=$?
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
  if [ -e "$TMP" ] || { [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; }; then
    echo "[preview] CLEANUP FAILED: check $TMP and pid $SERVER_PID" >&2
    exit 1
  fi
  echo "[preview] cleaned up: server stopped, temp DB and test account $USERNAME deleted" >&2
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

mkdir -p "$OUT"
cd "$ROOT"

echo "[preview] building frontend" >&2
(cd hackernews-frontend && npx vite build --logLevel warn >&2)

export SQLITE_PATH="$TMP/preview.db"
node scripts/seed-preview.js "$USERNAME" "$PASSWORD" >&2

echo "[preview] starting server on $BASE" >&2
SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')" \
  PORT="$PORT" NODE_ENV=development DISABLE_WORKER=true \
  node bin/www > "$TMP/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
  curl -fsS "$BASE/api/v1/stories?timespan=Day" >/dev/null 2>&1 && break
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then cat "$TMP/server.log" >&2; exit 1; fi
  sleep 0.2
done

curl -fsS -c "$TMP/cookies" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" "$BASE/api/v1/login" >/dev/null
TOKEN="$(awk '$6 == "token" { print $7 }' "$TMP/cookies")"
[ -n "$TOKEN" ] || { echo "[preview] login failed" >&2; exit 1; }

"$ROOT/scripts/screenshot.sh" "$BASE/" "$OUT/logged-out.png"
"$ROOT/scripts/screenshot.sh" "$BASE/" "$OUT/logged-in.png" --cookie "token=$TOKEN"
"$ROOT/scripts/screenshot.sh" "$BASE/" "$OUT/logged-in-dark.png" --cookie "token=$TOKEN" --dark

if [ -n "${PREVIEW_HOLD:-}" ]; then
  echo "[preview] serving $BASE as $USERNAME; cookie: token=$TOKEN" >&2
  echo "[preview] server log: $TMP/server.log — Ctrl-C or kill $$ to stop and clean up" >&2
  wait "$SERVER_PID"
fi
