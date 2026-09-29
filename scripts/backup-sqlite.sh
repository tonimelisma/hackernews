#!/bin/bash
# Daily SQLite backup to GCS
# Uses SQLite .backup for safe hot backup while DB is running. Uploads with
# curl and the VM service account's token from the metadata server (the VM has
# the devstorage.read_write scope) — no gcloud CLI needed on the box.
set -euo pipefail

BUCKET=hackernews-melisma-backup
KEEP=30
BACKUP_DIR=/tmp/hackernews-backup
OBJECT="hackernews-$(date -u +%Y%m%d).db.gz"
API=https://storage.googleapis.com
mkdir -p "$BACKUP_DIR"

# Run .backup inside the container to a temp file, then copy it out
docker compose -f /opt/hackernews/docker-compose.yml exec -T app \
  sqlite3 /data/hackernews.db ".backup '/tmp/hackernews-backup.db'"
docker compose -f /opt/hackernews/docker-compose.yml cp app:/tmp/hackernews-backup.db "$BACKUP_DIR/hackernews.db"

gzip -f "$BACKUP_DIR/hackernews.db"

TOKEN=$(curl -sf -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | jq -r .access_token)
AUTH="Authorization: Bearer $TOKEN"

# Upload with date stamp (same-day reruns overwrite)
curl -sf -X POST -H "$AUTH" -H "Content-Type: application/gzip" \
  --data-binary @"$BACKUP_DIR/hackernews.db.gz" \
  "$API/upload/storage/v1/b/$BUCKET/o?uploadType=media&name=$OBJECT" > /dev/null

# Keep only the newest $KEEP backups (names sort by date)
curl -sf -H "$AUTH" "$API/storage/v1/b/$BUCKET/o?prefix=hackernews-&fields=items(name)" \
  | jq -r '.items[]?.name' | sort | head -n -"$KEEP" \
  | while read -r name; do
      curl -sf -X DELETE -H "$AUTH" "$API/storage/v1/b/$BUCKET/o/$name" > /dev/null
      echo "Deleted old backup: $name"
    done

rm -f "$BACKUP_DIR/hackernews.db.gz"

echo "Backup completed: $OBJECT"
