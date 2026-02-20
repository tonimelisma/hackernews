#!/bin/bash
# Daily SQLite backup to GCS
# Uses SQLite .backup for safe hot backup while DB is running
set -euo pipefail

BACKUP_DIR=/tmp/hackernews-backup
mkdir -p "$BACKUP_DIR"

# Copy from Docker volume using SQLite .backup command
docker compose -f /opt/hackernews/docker-compose.yml exec -T app \
  sqlite3 /data/hackernews.db ".backup '$BACKUP_DIR/hackernews.db'"

# Compress and upload to GCS with date stamp
gzip -f "$BACKUP_DIR/hackernews.db"
gsutil cp "$BACKUP_DIR/hackernews.db.gz" \
  "gs://hackernews-melisma-backup/hackernews-$(date +%Y%m%d).db.gz"

# Keep only last 30 days
gsutil ls gs://hackernews-melisma-backup/ | sort | head -n -30 | xargs -r gsutil rm

# Cleanup
rm -f "$BACKUP_DIR/hackernews.db.gz"

echo "Backup completed: hackernews-$(date +%Y%m%d).db.gz"
