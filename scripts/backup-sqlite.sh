#!/bin/bash
# Daily SQLite backup to GCS
# Uses SQLite .backup for safe hot backup while DB is running
set -euo pipefail

BACKUP_DIR=/tmp/hackernews-backup
mkdir -p "$BACKUP_DIR"

# Run .backup inside the container to a temp file, then copy it out
docker compose -f /opt/hackernews/docker-compose.yml exec -T app \
  sqlite3 /data/hackernews.db ".backup '/tmp/hackernews-backup.db'"
docker compose -f /opt/hackernews/docker-compose.yml cp app:/tmp/hackernews-backup.db "$BACKUP_DIR/hackernews.db"

# Compress and upload to GCS with date stamp
gzip -f "$BACKUP_DIR/hackernews.db"
gcloud storage cp "$BACKUP_DIR/hackernews.db.gz" \
  "gs://hackernews-melisma-backup/hackernews-$(date +%Y%m%d).db.gz"

# Keep only last 30 days
gcloud storage ls gs://hackernews-melisma-backup/ | sort | head -n -30 | xargs -r gcloud storage rm

# Cleanup
rm -f "$BACKUP_DIR/hackernews.db.gz"

echo "Backup completed: hackernews-$(date +%Y%m%d).db.gz"
