#!/usr/bin/env bash
# Clean start: wipe the live installation back to an empty install, after a full backup.
#
#   cd /opt/kebo-desk && sudo bash deploy/server/clean-start.sh [--platform-only] [--no-backup]
#
#   --platform-only   nobody in the company Kebo: no Super Admin, Manager or Staff. Only the platform admin
#                     is made; they open Kebo from /platform and add its people there.
#   --no-backup       skip step 3 (for an installation that only holds test data): nothing can be undone.
#
# What it does, in order (it stops at the first problem; nothing is deleted before step 3):
#   1. shows what is there now (companies, people, inquiries, orders, files)
#   2. asks for the new starting accounts and the platform admin, and for the typed confirmation
#   3. takes a full backup of its own: backups/clean-start-<time>-db.sql.gz (checked) and
#      backups/clean-start-<time>-files.tar.gz (every stored file), kept until you delete them
#   4. stops the app, drops and re-creates the database, empties the file store
#   5. applies the migrations (they make the first company, Kebo), starts the API, seeds the starting
#      accounts (Super Admin, Manager, Staff; none with --platform-only) and adds the platform admin (it
#      prints a link to set the password), then starts everything again
#
# Undo: docs/restore.md, with the two clean-start backup files (there are none after --no-backup).
# Note: the nightly off-site file sync mirrors the (now empty) file store; the off-site database dumps are
# kept for OFFSITE_RETENTION_DAYS, and the clean-start backup stays in backups/ on this server.
set -euo pipefail

PLATFORM_ONLY=0
BACKUP=1
for arg in "$@"; do
  case "$arg" in
    --platform-only) PLATFORM_ONLY=1 ;;
    --no-backup) BACKUP=0 ;;
    *) echo "Unknown option $arg (use --platform-only, --no-backup)." >&2; exit 1 ;;
  esac
done

APP_DIR="${KEBO_DESK_DIR:-/opt/kebo-desk}"
cd "$APP_DIR"
[ -f docker-compose.yml ] && [ -f .env ] || { echo "Run this in the app folder ($APP_DIR): docker-compose.yml and .env must be there." >&2; exit 1; }

dc() { docker compose "$@"; }
say() { echo "[clean-start] $*"; }
die() { echo "[clean-start] ERROR: $*" >&2; exit 1; }
sql() { dc exec -T db psql -U kebo -d kebo -tAq -v ON_ERROR_STOP=1 -c "$1"; }
count() { sql "select count(*) from $1" 2>/dev/null || echo "?"; }

env_get() { sed -n "s/^$1=//p" .env | tail -n 1 | sed 's/^["'\'']//; s/["'\'']$//'; }
BUCKET="$(env_get S3_BUCKET)"; BUCKET="${BUCKET:-kebo-files}"

# ---------------------------------------------------------------- 1. what is there now
dc ps --status running --services | grep -qx db || die "the database container is not running (docker compose up -d db)."
say "This server: $(hostname) · app folder $APP_DIR · deployed $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
say "Now in the database:"
printf '    companies %s · people %s · customers %s · factories %s · inquiries %s · orders %s · payments %s\n' \
  "$(count companies)" "$(count users)" "$(count customers)" "$(count factories)" "$(count inquiries)" "$(count orders)" "$(count payments)"
files_now=$(dc exec -T backup sh -c 'du -sh /data/files 2>/dev/null | cut -f1' 2>/dev/null || echo "?")
say "Stored files: ${files_now} (bucket $BUCKET)"
echo

# ---------------------------------------------------------------- 2. the new accounts and the confirmation
ask() { local v; read -r -p "$1 [$2]: " v || exit 1; echo "${v:-$2}"; }
ask_pw() {
  local a b
  while :; do
    read -r -s -p "$1 (at least 10 characters): " a || exit 1; echo >&2
    read -r -s -p "  again: " b || exit 1; echo >&2
    [ "$a" = "$b" ] || { echo "  They differ, try again." >&2; continue; }
    [ "${#a}" -ge 10 ] || { echo "  Too short, try again." >&2; continue; }
    printf '%s' "$a"; return
  done
}
if [ "$PLATFORM_ONLY" = 1 ]; then
  say "Nobody is made in the company Kebo (--platform-only): the platform admin opens it and adds its people."
  PA_EMAIL=$(ask "Platform admin email (signs in at /platform/login)" "$(env_get SEED_ADMIN_EMAIL || true)")
  PA_NAME=$(ask "Platform admin name" "Platform Admin")
else
  say "The starting accounts of the company Kebo (each signs in with email + password):"
  ADMIN_EMAIL=$(ask "  Super Admin email" "$(env_get SEED_ADMIN_EMAIL || true)")
  ADMIN_NAME=$(ask "  Super Admin name" "Super Admin")
  ADMIN_PW=$(ask_pw "  Super Admin password")
  MANAGER_EMAIL=$(ask "  Manager email" "$(env_get SEED_MANAGER_EMAIL || true)")
  MANAGER_PW=$(ask_pw "  Manager password")
  STAFF_EMAIL=$(ask "  Staff email" "$(env_get SEED_STAFF_EMAIL || true)")
  STAFF_PW=$(ask_pw "  Staff password")
  for p in "$ADMIN_PW" "$MANAGER_PW" "$STAFF_PW"; do [ -n "$p" ] || die "a password is missing: nothing was changed."; done
  for e in "$ADMIN_EMAIL" "$MANAGER_EMAIL" "$STAFF_EMAIL"; do [[ "$e" == *@*.* ]] || die "\"$e\" is not an email."; done
  PA_EMAIL=$(ask "Platform admin email (signs in at /platform/login)" "$ADMIN_EMAIL")
  PA_NAME=$(ask "Platform admin name" "$ADMIN_NAME")
fi
[[ "$PA_EMAIL" == *@*.* ]] || die "\"$PA_EMAIL\" is not an email: nothing was changed."
echo
echo "This DELETES EVERYTHING on this installation: every company, person, customer, factory, inquiry,"
echo "quotation, order, payment, expense, paper, file, notification and the whole history."
[ "$BACKUP" = 1 ] || echo "NO BACKUP is taken first (--no-backup): this cannot be undone."
read -r -p 'Type DELETE EVERYTHING to go on: ' ok
[ "$ok" = "DELETE EVERYTHING" ] || die "not confirmed: nothing was changed."

# ---------------------------------------------------------------- 3. a full backup of its own
if [ "$BACKUP" = 1 ]; then
  STAMP=$(date -u +%Y%m%d-%H%M%S)
  DB_BAK="backups/clean-start-$STAMP-db.sql.gz"
  FILES_BAK="backups/clean-start-$STAMP-files.tar.gz"
  mkdir -p backups
  say "Backing up the database to $DB_BAK …"
  dc exec -T db pg_dump -U kebo -d kebo --no-owner --clean --if-exists | gzip >"$DB_BAK.part"
  gzip -t "$DB_BAK.part" || die "the database backup is broken: nothing was changed."
  zcat "$DB_BAK.part" | grep -q "PostgreSQL database dump complete" || die "the database backup is incomplete: nothing was changed."
  mv "$DB_BAK.part" "$DB_BAK"; chmod 600 "$DB_BAK"
  say "Backing up the files to $FILES_BAK …"
  dc exec -T backup sh -c 'tar czf - -C /data/files .' >"$FILES_BAK.part"
  gzip -t "$FILES_BAK.part" || die "the files backup is broken: nothing was changed."
  mv "$FILES_BAK.part" "$FILES_BAK"; chmod 600 "$FILES_BAK"
  say "Backups done: $(du -h "$DB_BAK" | cut -f1) database, $(du -h "$FILES_BAK" | cut -f1) files."
else
  say "No backup (--no-backup)."
fi

# ---------------------------------------------------------------- 4. wipe
say "Stopping the app …"
dc stop web worker api
say "Dropping and re-creating the database …"
dc exec -T db psql -U kebo -d postgres -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists kebo with (force)" -c "create database kebo owner kebo"
say "Emptying the file store (bucket $BUCKET) …"
dc exec -T backup sh /backup.sh rclone delete --rmdirs "minio:$BUCKET" || die "could not empty the file store; the database is already empty. Fix it and run the steps from 'migrations' in this script by hand."

# ---------------------------------------------------------------- 5. an empty install again
say "Applying the migrations …"
dc run --rm --no-deps api sh -c "cd /app/packages/database && npx prisma migrate deploy"
say "Starting the API …"
dc up -d api
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q api)" 2>/dev/null)" = "healthy" ] && break
  sleep 3
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q api)")" = "healthy" ] || die "the API did not become healthy: docker compose logs --tail 80 api"
if [ "$PLATFORM_ONLY" = 1 ]; then
  say "Setting up the company Kebo (roles and settings, no people) …"
  dc exec -T api sh -c "cd /app/packages/database && npx tsx scripts/seed.ts --no-people"
else
  say "Creating the starting accounts …"
  dc exec -T \
    -e SEED_ADMIN_EMAIL="$ADMIN_EMAIL" -e SEED_ADMIN_NAME="$ADMIN_NAME" -e SEED_ADMIN_PASSWORD="$ADMIN_PW" \
    -e SEED_MANAGER_EMAIL="$MANAGER_EMAIL" -e SEED_MANAGER_PASSWORD="$MANAGER_PW" \
    -e SEED_STAFF_EMAIL="$STAFF_EMAIL" -e SEED_STAFF_PASSWORD="$STAFF_PW" \
    api sh -c "cd /app/packages/database && npx tsx scripts/seed.ts"
fi
say "Adding the platform admin …"
dc exec -T api node apps/api/dist/cli/platform-admin.js add "$PA_EMAIL" "$PA_NAME"
say "Starting everything …"
dc up -d
if [ "$PLATFORM_ONLY" = 1 ]; then
  say "Done. The site is an empty install with nobody in Kebo: $PA_EMAIL sets a password with the link above,"
  say "signs in at /platform/login, opens the company Kebo and adds its people (Admin › Users)."
else
  say "Done. The site is an empty install: sign in as $ADMIN_EMAIL; the platform admin sets a password with the link above."
fi
[ "$BACKUP" = 0 ] || say "Backups of what was there: $DB_BAK and $FILES_BAK (delete them when you no longer need them)."
