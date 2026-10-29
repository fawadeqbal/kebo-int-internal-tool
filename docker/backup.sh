#!/bin/sh
# Backups (the "backup" container in docker-compose.yml), now and then every night at BACKUP_HOUR:
#   - the database: backups/db-<date>.sql.gz, checked (a complete dump, not empty), kept BACKUP_RETENTION_DAYS
#   - the files (MinIO's volume): backups/files-<date>.tar.gz, only the newest BACKUP_FILES_KEEP (default 2, 0 = none)
#   - off-site, only when OFFSITE_S3_ENDPOINT is set: the dump is copied and the files are synced (only what
#     changed) to an S3 store of your own (MinIO on another machine), encrypted first when
#     OFFSITE_ENCRYPTION_PASSWORD is set
#   - the result: backups/status/last-status.json; the worker emails the platform admins when the last
#     good backup is more than a day old or the last run failed
# Old copies are removed only after a good run. A file is given its normal name only once it is checked,
# so a broken or unfinished copy never looks like a backup. Restore: docs/restore.md.
#
#   sh /backup.sh            a backup now, then every night (the container's command)
#   sh /backup.sh once       one backup now; the exit code says whether it worked
#   sh /backup.sh rclone …   rclone with the remotes "minio" (the app's files) and "offsite" ready (restores)
set -eu
# The image's sh (busybox ash) has pipefail: a failed pg_dump fails the run even though gzip succeeded.
# shellcheck disable=SC3040
set -o pipefail
# Backups hold every customer, price and file: readable by root and by the
# off-site uploader only (group BACKUP_GID, which nothing else on the server uses).
umask 027
BACKUP_GID="${BACKUP_GID:-10560}"
DIR="${BACKUP_DIR:-/backups}"
FILES="${FILES_DIR:-/data/files}"
STATUS="$DIR/status"

log() { echo "[backup] $*"; }
now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# A JSON string (or null when empty).
json_str() {
  if [ -z "$1" ]; then
    printf null
  else
    printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  fi
}

# backups/status/last-status.json, for the worker (backups/status is mounted into it, read-only).
write_status() { # ok message
  good=$(cat "$STATUS/last-good" 2>/dev/null || true)
  tmp="$STATUS/.last-status.json.tmp"
  printf '{"at":"%s","ok":%s,"message":%s,"lastGoodAt":%s,"dump":%s,"offsite":"%s"}\n' \
    "$(now_utc)" "$1" "$(json_str "$2")" "$(json_str "$good")" "$(json_str "${dump:-}")" "${offsite:-off}" >"$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$STATUS/last-status.json"
}

# rclone remotes, from the environment only (no config file):
#   minio:    the app's MinIO
#   offsite:  <OFFSITE_S3_BUCKET>/<OFFSITE_S3_PREFIX> on the off-site store, through encryption when a password is set
setup_rclone() {
  # No config file: everything is in the environment ("" = none, without a notice).
  export RCLONE_CONFIG=""
  export RCLONE_CONFIG_MINIO_TYPE=s3 RCLONE_CONFIG_MINIO_PROVIDER=Minio
  export RCLONE_CONFIG_MINIO_ENDPOINT="${FILES_S3_ENDPOINT:-http://minio:9000}"
  export RCLONE_CONFIG_MINIO_ACCESS_KEY_ID="${FILES_S3_ACCESS_KEY:-}" RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY="${FILES_S3_SECRET_KEY:-}"
  export RCLONE_CONFIG_MINIO_REGION=us-east-1 RCLONE_CONFIG_MINIO_FORCE_PATH_STYLE=true
  [ -n "${OFFSITE_S3_ENDPOINT:-}" ] || return 0
  for v in OFFSITE_S3_BUCKET OFFSITE_S3_ACCESS_KEY OFFSITE_S3_SECRET_KEY; do
    eval "val=\${$v:-}"
    [ -n "$val" ] || {
      log "OFFSITE_S3_ENDPOINT is set but $v is not (in .env)" >&2
      return 1
    }
  done
  export RCLONE_CONFIG_OFFSITERAW_TYPE=s3 RCLONE_CONFIG_OFFSITERAW_PROVIDER=Minio
  export RCLONE_CONFIG_OFFSITERAW_ENDPOINT="$OFFSITE_S3_ENDPOINT" RCLONE_CONFIG_OFFSITERAW_REGION="${OFFSITE_S3_REGION:-us-east-1}"
  export RCLONE_CONFIG_OFFSITERAW_ACCESS_KEY_ID="$OFFSITE_S3_ACCESS_KEY" RCLONE_CONFIG_OFFSITERAW_SECRET_ACCESS_KEY="$OFFSITE_S3_SECRET_KEY"
  # The bucket is made once on the off-site store (docs/restore.md); a key that may not create buckets works too.
  export RCLONE_CONFIG_OFFSITERAW_FORCE_PATH_STYLE=true RCLONE_CONFIG_OFFSITERAW_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_OFFSITE_REMOTE="offsiteraw:$OFFSITE_S3_BUCKET/${OFFSITE_S3_PREFIX:-kebo-desk}"
  if [ -n "${OFFSITE_ENCRYPTION_PASSWORD:-}" ]; then
    RCLONE_CONFIG_OFFSITE_PASSWORD=$(printf '%s' "$OFFSITE_ENCRYPTION_PASSWORD" | rclone obscure -)
    export RCLONE_CONFIG_OFFSITE_TYPE=crypt RCLONE_CONFIG_OFFSITE_PASSWORD
  else
    export RCLONE_CONFIG_OFFSITE_TYPE=alias
  fi
}

# A dump is good when it is a whole gzip file, not tiny, and pg_dump finished it.
check_dump() {
  size=$(wc -c <"$1")
  min=$((${BACKUP_MIN_KB:-8} * 1024))
  if [ "$size" -lt "$min" ]; then
    log "the dump is only $size bytes (expected at least $min)" >&2
    return 1
  fi
  gzip -t "$1"
  end=$(gunzip -c "$1" | tail -n 5)
  case "$end" in
    *"PostgreSQL database dump complete"*) ;;
    *)
      log "the dump does not end the way a complete dump does" >&2
      return 1
      ;;
  esac
}

# rclone's "directory not found" (exit 3) is fine for a folder nothing was put in yet.
rclone_may_be_empty() {
  rc=0
  rclone "$@" || rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq 3 ] || return "$rc"
}

offsite_copy() {
  setup_rclone
  days="${OFFSITE_RETENTION_DAYS:-30}"
  flags="--stats-one-line --stats-log-level NOTICE"
  # shellcheck disable=SC2086
  rclone copyto "$DIR/$dump" "offsite:db/$dump" $flags
  bucket="${FILES_S3_BUCKET:-kebo-files}"
  if rclone lsf --dirs-only minio: | grep -qxF "$bucket/"; then
    # Only what changed is sent. A file deleted or replaced in the app is kept off-site
    # under files-changed/<date> for OFFSITE_RETENTION_DAYS, not lost at once.
    # shellcheck disable=SC2086
    rclone sync "minio:$bucket" offsite:files --backup-dir "offsite:files-changed/$stamp" $flags
  else
    log "no files uploaded yet (no bucket $bucket): nothing to sync"
  fi
  rclone_may_be_empty delete offsite:db --min-age "${days}d"
  rclone_may_be_empty delete offsite:files-changed --min-age "${days}d"
  rclone_may_be_empty rmdirs offsite:files-changed --leave-root
  log "off-site: copied $dump and synced the files"
}

finished() {
  code=$1
  trap - EXIT
  rm -f "$DIR"/.*.partial
  if [ "$code" -eq 0 ]; then
    write_status true ""
    log "done $stamp"
  else
    write_status false "Could not $step (exit code $code)."
    log "FAILED: could not $step (exit code $code)" >&2
  fi
  exit "$code"
}

once() {
  stamp=$(date +%Y-%m-%d_%H%M)
  dump=""
  offsite=off
  step="start"
  trap 'finished $?' EXIT
  log "starting $stamp"

  step="dump the database"
  part="$DIR/.db-$stamp.sql.gz.partial"
  pg_dump --no-owner --clean --if-exists | gzip >"$part"
  step="check the database dump"
  check_dump "$part"
  mv "$part" "$DIR/db-$stamp.sql.gz"
  dump="db-$stamp.sql.gz"
  chgrp "$BACKUP_GID" "$DIR/$dump" 2>/dev/null || true
  now_utc >"$STATUS/last-good"
  chmod 644 "$STATUS/last-good"
  log "database: $dump ($(wc -c <"$DIR/$dump") bytes)"

  keep="${BACKUP_FILES_KEEP:-2}"
  if [ "$keep" -gt 0 ]; then
    # MinIO keeps each file as a folder on its volume; a copy of that volume restores everything.
    step="copy the files"
    part="$DIR/.files-$stamp.tar.gz.partial"
    tar -czf "$part" -C "$(dirname "$FILES")" "$(basename "$FILES")"
    gzip -t "$part"
    mv "$part" "$DIR/files-$stamp.tar.gz"
    chgrp "$BACKUP_GID" "$DIR/files-$stamp.tar.gz" 2>/dev/null || true
    log "files: files-$stamp.tar.gz"
  fi

  # Only now, after a good run: the old copies go.
  step="remove old copies"
  find "$DIR" -maxdepth 1 -type f -name 'db-*.sql.gz' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -exec rm -f {} \;
  { ls -1t "$DIR"/files-*.tar.gz 2>/dev/null || true; } | tail -n +$((keep + 1)) | while read -r f; do rm -f "$f"; done

  if [ -n "${OFFSITE_S3_ENDPOINT:-}" ]; then
    step="copy the backup off-site"
    offsite=failed
    offsite_copy
    offsite=ok
  fi
  step="finish"
}

prepare() {
  mkdir -p "$DIR" "$STATUS"
  chgrp "$BACKUP_GID" "$DIR" && chmod 750 "$DIR"
  chmod 755 "$STATUS"
  find "$DIR" -maxdepth 1 -type f -exec chgrp "$BACKUP_GID" {} \; -exec chmod 640 {} \; 2>/dev/null || true
}

case "${1:-}" in
  once)
    prepare
    once
    exit 0
    ;;
  rclone)
    shift
    setup_rclone
    exec rclone "$@"
    ;;
  "") ;;
  *)
    echo "usage: sh /backup.sh [once | rclone …]" >&2
    exit 2
    ;;
esac

prepare
while true; do
  # A failed run is in the log, in backups/status/last-status.json and, through the worker, in an email.
  sh "$0" once || log "the backup failed (see above); next try at the next BACKUP_HOUR" >&2
  # Sleep until the next BACKUP_HOUR:00.
  now=$(date +%s)
  hour=$(printf "%02d" "${BACKUP_HOUR:-2}")
  target=$(date -d "$(date +%Y-%m-%d) ${hour}:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
done
