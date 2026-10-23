#!/bin/sh
# Nightly backup of the database and uploaded files, kept for BACKUP_RETENTION_DAYS.
# Restore: gunzip -c db-YYYY-MM-DD.sql.gz | docker compose exec -T db psql -U qms -d qms
set -eu
mkdir -p /backups

run_backup() {
  stamp=$(date +%Y-%m-%d_%H%M)
  echo "[backup] starting ${stamp}"
  pg_dump --no-owner --clean --if-exists | gzip > "/backups/db-${stamp}.sql.gz.tmp" && mv "/backups/db-${stamp}.sql.gz.tmp" "/backups/db-${stamp}.sql.gz"
  tar -czf "/backups/files-${stamp}.tar.gz" -C /data uploads 2>/dev/null || true
  find /backups -type f -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
  echo "[backup] done ${stamp}"
}

run_backup
while true; do
  # Sleep until the next BACKUP_HOUR:00.
  now=$(date +%s)
  hour=$(printf "%02d" "${BACKUP_HOUR:-2}")
  target=$(date -d "$(date +%Y-%m-%d) ${hour}:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
  run_backup
done
