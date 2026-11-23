#!/bin/bash
# Check a built image against the runtime contract (docs/RELEASE.md), the way
# a host would run it: uid 1000, all capabilities dropped, no-new-privileges,
# read-only root filesystem with only /data (a fresh volume) and /tmp
# writable. CI runs this on every image before it is published.
#
#   scripts/image-smoke.sh <image>
#
# Removes its container and volume on exit, even on failure, and confirms it.
set -euo pipefail

IMAGE=${1:?usage: scripts/image-smoke.sh <image>}
NAME=hn-smoke-$$
VOLUME=hn-smoke-$$
PORT=${SMOKE_PORT:-3999}
HEALTH="http://127.0.0.1:$PORT/api/v1/stories?timespan=Day&limit=1"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  if docker container inspect "$NAME" >/dev/null 2>&1 || docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    echo "[smoke] cleanup FAILED: $NAME / $VOLUME still exist" >&2
  else
    echo "[smoke] cleaned up: container and volume removed"
  fi
}
trap cleanup EXIT

fail() {
  echo "[smoke] FAIL: $*" >&2
  docker logs "$NAME" 2>&1 | tail -n 30 >&2 || true
  exit 1
}

docker volume create "$VOLUME" >/dev/null
docker run -d --name "$NAME" \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true \
  --read-only --tmpfs /tmp \
  -e SECRET=smoke-test-secret -e NODE_ENV=production -e SQLITE_PATH=/data/hackernews.db \
  -e DISABLE_WORKER=true \
  -v "$VOLUME:/data" -p "127.0.0.1:$PORT:3000" "$IMAGE" >/dev/null

code=000
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$HEALTH" || true)
  [[ $code == 200 ]] && break
  [[ $(docker inspect -f '{{.State.Running}}' "$NAME") == true ]] || fail "container exited"
  sleep 1
done
[[ $code == 200 ]] || fail "health check returned $code"
echo "[smoke] health: 200"

owner=$(docker exec "$NAME" stat -c %u /data/hackernews.db) || fail "no database in /data"
[[ $owner == 1000 ]] || fail "/data/hackernews.db owned by uid $owner, not 1000"
echo "[smoke] database created in /data, owned by uid 1000"

want=$(docker exec "$NAME" sh -c 'ls migrations/*.js | wc -l')
got=$(docker exec "$NAME" sqlite3 /data/hackernews.db 'SELECT COUNT(*) FROM schema_migrations;')
[[ $got -gt 0 && $got == "$want" ]] || fail "$got of $want migrations applied"
echo "[smoke] migrations: $got/$want applied"

docker exec "$NAME" node scripts/users.js list >/dev/null || fail "admin CLI (scripts/users.js list) failed"
echo "[smoke] admin CLI works"

docker stop -t 10 "$NAME" >/dev/null
exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$NAME")
[[ $exit_code == 0 ]] || fail "exit code $exit_code after SIGTERM"
echo "[smoke] clean shutdown on SIGTERM"
echo "[smoke] PASS: $IMAGE"
