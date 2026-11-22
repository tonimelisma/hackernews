#!/bin/bash
# Runs ON vps-1 as root, sent by ops/run.sh (.github/workflows/ops.yml) over
# the IAP tunnel as:  sudo bash -c "<this file>" hn-ops <job> [arg...]
#
# Everything it prints ends up in the age-encrypted artifact, never in the
# public workflow log. The workflow publishes only the last line,
# "HN_OPS_SUMMARY key=<digits> ...", after ops/workflow.js checks it holds
# nothing but numbers. Arguments were validated by ops/workflow.js and are
# checked again here, before anything touches the server.
set -Eeuo pipefail
exec 2>&1

APP_DIR=/opt/hackernews
APP=hackernews-app-1
BUCKET=hackernews-melisma-backup
GCS=https://storage.googleapis.com
MAX_LINES=5000

summary() { echo "HN_OPS_SUMMARY $*"; }
die() {
  echo "error: $*"
  summary ok=0
  exit 1
}
trap 'summary ok=0 line=$LINENO' ERR

dc() { docker compose -f "$APP_DIR/docker-compose.yml" "$@"; }
users_cli() { dc exec -T app node scripts/users.js "$@"; }
sql() { dc exec -T app sqlite3 /data/hackernews.db "$1"; }
section() { printf '\n===== %s =====\n%s\n' "$1" "$2"; }
count_lines() { if [[ -z $1 ]]; then echo 0; else grep -c '' <<<"$1"; fi; }
health_of() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo missing; }
gcs_token() {
  curl -sf -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" |
    jq -r .access_token
}

need_username() {
  [[ ${1:-} =~ ^[A-Za-z0-9_-]{1,32}$ ]] || die "invalid username"
}
need_backup() {
  [[ ${1:-} =~ ^(hackernews-[0-9]{8}|prerestore-[0-9]{8}T[0-9]{6}Z)\.db\.gz$ ]] || die "invalid backup name"
}

job_users_list() {
  local out n
  out=$(users_cli list </dev/null)
  echo "$out"
  if [[ $out == "No accounts." ]]; then n=0; else n=$(count_lines "$out"); fi
  summary ok=1 accounts="$n"
}

# The password comes on stdin (twice: users.js asks for a confirmation), from
# the workflow that generated it; it is never an argument.
job_users_password() {
  local command=$1 username=$2
  need_username "$username"
  users_cli "$command" "$username"
  summary ok=1
}

job_users_revoke() {
  need_username "$1"
  users_cli revoke-sessions "$1" </dev/null
  summary ok=1
}

job_logs() {
  local n=${1:-} app worker caddy update backup
  if ! [[ $n =~ ^[0-9]{1,4}$ ]] || ((n < 1 || n > MAX_LINES)); then die "invalid line count"; fi
  app=$(docker logs --tail "$n" "$APP" 2>&1 || true)
  # The worker runs inside the app process (bin/www); these are its lines.
  worker=$(docker logs --tail "$MAX_LINES" "$APP" 2>&1 | grep -E 'sync|WORKER|fetched|adding' | tail -n "$n" || true)
  caddy=$(docker logs --tail "$n" caddy 2>&1 || true)
  update=$(journalctl -t latchkey-update-apps -n "$n" --no-pager -o short-iso 2>&1 || true)
  backup=$(tail -n "$n" /var/log/hackernews-backup.log 2>&1 || true)
  section "app (docker logs $APP)" "$app"
  section "worker (sync lines from the app log)" "$worker"
  section "caddy (docker logs caddy)" "$caddy"
  section "update timer (journalctl -t latchkey-update-apps)" "$update"
  section "backup (/var/log/hackernews-backup.log)" "$backup"
  summary ok=1 app_lines="$(count_lines "$app")" worker_lines="$(count_lines "$worker")" \
    caddy_lines="$(count_lines "$caddy")" update_lines="$(count_lines "$update")" \
    backup_lines="$(count_lines "$backup")"
}

job_health() {
  local healthy health restarts caddy api timer mem_used mem_total swap_used disk load uptime_days last_backup
  health=$(health_of "$APP")
  restarts=$(docker inspect -f '{{.RestartCount}}' "$APP" 2>/dev/null || echo 0)
  caddy=$(docker inspect -f '{{.State.Running}}' caddy 2>/dev/null || echo false)
  if dc exec -T app wget -qO- 'http://localhost:3000/api/v1/stories?timespan=Day&limit=1' >/dev/null 2>&1; then api=1; else api=0; fi
  if systemctl is-active --quiet latchkey-update-apps.timer; then timer=1; else timer=0; fi
  read -r mem_used mem_total < <(free -m | awk '/^Mem:/ {print $3, $2}')
  swap_used=$(free -m | awk '/^Swap:/ {print $3}')
  disk=$(df -P / | awk 'NR == 2 {sub("%", "", $5); print $5}')
  load=$(awk '{printf "%d", $1 * 100}' /proc/loadavg)
  uptime_days=$(awk '{printf "%d", $1 / 86400}' /proc/uptime)
  last_backup=$(grep -oE 'Backup completed: hackernews-[0-9]{8}' /var/log/hackernews-backup.log 2>/dev/null | tail -n 1 | grep -oE '[0-9]{8}' || echo 0)
  section "containers" "$(docker ps -a --format '{{.Names}}  {{.Image}}  {{.Status}}')"
  section "app container" "health=$health restarts=$restarts"
  section "docker stats" "$(docker stats --no-stream --format '{{.Name}}  cpu={{.CPUPerc}}  mem={{.MemUsage}}')"
  section "memory" "$(free -h)"
  section "disk" "$(df -h / && du -sh "$APP_DIR" 2>/dev/null)"
  section "uptime" "$(uptime)"
  section "update timer" "$(systemctl list-timers latchkey-update-apps.timer --no-pager 2>&1 || true)"
  [[ $health == healthy ]] && healthy=1 || healthy=0
  [[ $caddy == true ]] && caddy=1 || caddy=0
  summary ok="$((healthy && api && caddy))" app_healthy="$healthy" app_api="$api" caddy_running="$caddy" \
    app_restarts="$restarts" update_timer="$timer" mem_used_mb="$mem_used" mem_total_mb="$mem_total" \
    swap_used_mb="$swap_used" disk_used_pct="$disk" load1_x100="$load" uptime_days="$uptime_days" \
    last_backup="$last_backup"
}

job_db_stats() {
  local counts stories users hidden migrations sizes db_bytes wal_bytes pages free_pages page_size age
  counts=$(sql "SELECT (SELECT COUNT(*) FROM stories), (SELECT COUNT(*) FROM users),
                       (SELECT COUNT(*) FROM hidden), (SELECT COUNT(*) FROM schema_migrations);")
  IFS='|' read -r stories users hidden migrations <<<"$counts"
  sizes=$(dc exec -T app sh -c 'stat -c %s /data/hackernews.db; stat -c %s /data/hackernews.db-wal 2>/dev/null || echo 0')
  db_bytes=$(sed -n 1p <<<"$sizes")
  wal_bytes=$(sed -n 2p <<<"$sizes")
  pages=$(sql "PRAGMA page_count;")
  free_pages=$(sql "PRAGMA freelist_count;")
  page_size=$(sql "PRAGMA page_size;")
  age=$(sql "SELECT MAX(0, COALESCE((CAST(strftime('%s','now') AS INTEGER) * 1000 - MAX(time)) / 60000, 0)) FROM stories;")
  section "schema_migrations" "$(sql 'SELECT name FROM schema_migrations ORDER BY name;')"
  summary ok=1 stories="$stories" users="$users" hidden="$hidden" migrations="$migrations" \
    db_bytes="$db_bytes" wal_bytes="$wal_bytes" pages="$pages" free_pages="$free_pages" \
    page_size="$page_size" newest_story_age_min="$age"
}

# The same script cron runs nightly (the server's copy in /opt/hackernews).
job_backup() {
  bash "$APP_DIR/scripts/backup-sqlite.sh"
  summary ok=1
}

# Overwrites the production database with a backup from the bucket. Keeps a
# safety copy of the current database in the bucket first, as
# prerestore-<UTC time>.db.gz (outside the hackernews- prefix, so the nightly
# retention never deletes it; restore it the same way to undo).
job_restore() {
  local name=${1:-} confirm=${2:-} work token stamp safety check restored health
  need_backup "$name"
  [[ $confirm == "confirm=$name" ]] || die "restore needs confirmation"

  work=$(mktemp -d /tmp/hn-restore.XXXXXX)
  # shellcheck disable=SC2064 # expand $work now
  trap "rm -rf '$work'; dc exec -T app rm -f /tmp/hn-restore.db /tmp/hn-prerestore.db >/dev/null 2>&1 || true" EXIT

  token=$(gcs_token)
  echo "Downloading $name"
  curl -sf -H "Authorization: Bearer $token" "$GCS/storage/v1/b/$BUCKET/o/$name?alt=media" -o "$work/restore.db.gz" ||
    die "download failed (no such backup?)"
  gunzip "$work/restore.db.gz"
  # docker cp keeps the host owner (root); the app's sqlite3 runs as uid 1000
  # with no capabilities, so it needs the file world-writable to open it.
  chmod 0666 "$work/restore.db"
  dc cp "$work/restore.db" app:/tmp/hn-restore.db
  check=$(dc exec -T app sqlite3 /tmp/hn-restore.db "PRAGMA integrity_check;")
  [[ $check == ok ]] || die "backup failed the integrity check: $check"
  restored=$(dc exec -T app sqlite3 /tmp/hn-restore.db "SELECT COUNT(*) FROM stories;")

  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  safety="prerestore-$stamp.db.gz"
  echo "Saving the current database as $safety"
  dc exec -T app sqlite3 /data/hackernews.db ".backup '/tmp/hn-prerestore.db'"
  dc cp app:/tmp/hn-prerestore.db "$work/prerestore.db"
  gzip "$work/prerestore.db"
  curl -sf -X POST -H "Authorization: Bearer $token" -H "Content-Type: application/gzip" \
    --data-binary @"$work/prerestore.db.gz" \
    "$GCS/upload/storage/v1/b/$BUCKET/o?uploadType=media&name=$safety" >/dev/null ||
    die "could not save the safety copy; nothing was restored"

  echo "Restoring $name"
  dc exec -T app sqlite3 /data/hackernews.db ".restore '/tmp/hn-restore.db'"
  dc exec -T app rm -f /tmp/hn-restore.db /tmp/hn-prerestore.db
  dc restart app
  health=starting
  for _ in $(seq 1 60); do
    health=$(health_of "$(dc ps -q app)")
    [[ $health == healthy ]] && break
    sleep 5
  done
  echo "Safety copy: $safety"
  echo "App health after restart: $health"
  [[ $health == healthy ]] || die "app not healthy after the restore"
  summary ok=1 restored_stories="$restored" safety_copy=1 app_healthy=1
}

job=${1:-}
shift || true
case $job in
  users-list) job_users_list ;;
  users-add) job_users_password add "${1:-}" ;;
  users-set-password) job_users_password set-password "${1:-}" ;;
  users-revoke-sessions) job_users_revoke "${1:-}" ;;
  logs) job_logs "${1:-}" ;;
  health) job_health ;;
  db-stats) job_db_stats ;;
  backup) job_backup ;;
  restore) job_restore "${1:-}" "${2:-}" ;;
  *) die "unknown job" ;;
esac
