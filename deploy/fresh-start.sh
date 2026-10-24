#!/usr/bin/env bash
# Go live with an EMPTY system: deletes every inquiry, customer, quotation,
# invoice, packing list, payment, user, setting and uploaded file, then creates
# only the three starting accounts:
#   Fawad Iqbal     Super Admin
#   Faizur Rehman   Manager
#   Tanveer ul Haq  Manager
# Company settings (name, address, bank details, terms, categories, notification
# emails) are kept. Two-step sign-in is switched off (anyone can still turn it
# on for themselves in My account).
#
# From your PC (uploads the latest commit first):  bash deploy/push.sh --fresh-start
# On the server:                                   cd /opt/kebo-rfq && bash deploy/fresh-start.sh
#
# A full backup of the old data is saved first in /opt/kebo-rfq/backups (before-fresh-start-*).
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\033[1;36m[kebo-rfq]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[kebo-rfq] STOP:\033[0m %s\n' "$*" >&2; exit 1; }

D="docker"
docker ps >/dev/null 2>&1 || D="sudo docker"
$D ps >/dev/null 2>&1 || die "cannot talk to Docker (as $(id -un) or with sudo)"
[ -f .env ] || die "no .env here; run deploy/install.sh first"
[ -t 0 ] || die "run this in a terminal (it asks you to confirm)"
APP_PORT=$(grep -E '^APP_PORT=' .env | cut -d= -f2 || true); APP_PORT=${APP_PORT:-3410}
DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2 || true)

current() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"' || true; }
ask() { local var="$1" prompt="$2" def="$3" val; read -rp "  $prompt [$def]: " val; printf -v "$var" '%s' "${val:-$def}"; }

cat <<WARN

  This DELETES all data on ${DOMAIN:-this server}: inquiries, customers, quotations,
  invoices, packing lists, payments, users and uploaded files.
  Company settings (details, bank, terms, notification emails) are kept.
  Only Fawad Iqbal (Super Admin), Faizur Rehman and Tanveer ul Haq (Managers)
  are created again. Everyone is signed out (web and phone app).

WARN
read -rp "  Type DELETE to continue: " answer
[ "$answer" = "DELETE" ] || die "nothing was changed"

echo
say "login emails (press Enter to keep the one shown):"
ask ADMIN_EMAIL "Fawad Iqbal (Super Admin)" "$(current SEED_ADMIN_EMAIL | grep -v example.com || echo admin@fawadiqbal.dev)"
ask MANAGER_EMAIL "Faizur Rehman (Manager)" "faizur@keboint.com"
ask MANAGER2_EMAIL "Tanveer ul Haq (Manager)" "tanveer@keboint.com"
for e in "$ADMIN_EMAIL" "$MANAGER_EMAIL" "$MANAGER2_EMAIL"; do
  [[ "$e" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "\"$e\" is not an email address; nothing was changed"
done
[ "$(printf '%s\n' "$ADMIN_EMAIL" "$MANAGER_EMAIL" "$MANAGER2_EMAIL" | tr 'A-Z' 'a-z' | sort -u | wc -l)" = 3 ] || die "the three emails must be different; nothing was changed"

# ---------------------------------------------------------------- 1. Backup of the old data
stamp=$(date +%Y-%m-%d_%H%M%S)
say "saving a backup of the old data first…"
$D compose exec -T backup sh -c "umask 027 && pg_dump --no-owner --clean --if-exists | gzip > /backups/before-fresh-start-$stamp.sql.gz && tar -czf /backups/before-fresh-start-files-$stamp.tar.gz -C /data files 2>/dev/null; chgrp \${BACKUP_GID:-10560} /backups/before-fresh-start-* 2>/dev/null || true" \
  || die "the backup failed, so nothing was deleted"
say "backup: backups/before-fresh-start-$stamp.sql.gz (+ files)"
SETTINGS=$($D compose exec -T db psql -U qms -d qms -At -c "select value::text from settings where key = 'app'" 2>/dev/null || true)

# ---------------------------------------------------------------- 2. New accounts and settings in .env
pw() { printf 'Kb%s7' "$(openssl rand -hex 7)"; }
ADMIN_PW=$(pw); MANAGER_PW=$(pw); MANAGER2_PW=$(pw)
SUDO=""; [ -w .env ] || SUDO="sudo"
$SUDO cp -p .env ".env.before-fresh-start-$stamp"
$SUDO sed -i -E '/^SEED_(ADMIN|MANAGER|MANAGER2|STAFF)_(NAME|EMAIL|PASSWORD)=/d; /^TWO_STEP_REQUIRED_ROLES=/d; /^# Starting accounts/d' .env
$SUDO tee -a .env >/dev/null <<ENV

# Two-step sign-in: empty = nobody is asked (anyone can turn it on in My account)
TWO_STEP_REQUIRED_ROLES=
# Starting accounts (fresh start $(date -u +%F); only used when an account does not exist yet)
SEED_ADMIN_NAME="Fawad Iqbal"
SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_PASSWORD=$ADMIN_PW
SEED_MANAGER_NAME="Faizur Rehman"
SEED_MANAGER_EMAIL=$MANAGER_EMAIL
SEED_MANAGER_PASSWORD=$MANAGER_PW
SEED_MANAGER2_NAME="Tanveer ul Haq"
SEED_MANAGER2_EMAIL=$MANAGER2_EMAIL
SEED_MANAGER2_PASSWORD=$MANAGER2_PW
ENV

healthy() {
  for i in $(seq 1 90); do
    curl -fsS "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null 2>&1 && return 0
    sleep 2
  done
  $D compose logs --tail 60 app; die "the app did not become healthy"
}

# ---------------------------------------------------------------- 3. Wipe and start again
say "applying the new settings…"
$D compose up -d --remove-orphans
healthy
$D compose stop worker
say "deleting all data and files…"
$D compose exec -T -e RESET_CONFIRM=delete-everything app node dist/scripts/reset.js
say "creating the empty database…"
$D compose restart app
healthy
if [ -n "$SETTINGS" ]; then
  printf '%s\n' "insert into settings (key, value) values ('app', :'v'::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now();" \
    | $D compose exec -T db psql -U qms -d qms -q -v ON_ERROR_STOP=1 -v v="$SETTINGS" >/dev/null && say "company settings kept"
fi
$D compose exec -T app node dist/scripts/seed.js
$D compose start worker

cat <<INFO

  Done. https://${DOMAIN:-<your domain>} is empty and ready.
  Logins (also in /opt/kebo-rfq/.env; each person should change their password under My account):

    Fawad Iqbal     Super Admin  $ADMIN_EMAIL   $ADMIN_PW
    Faizur Rehman   Manager      $MANAGER_EMAIL   $MANAGER_PW
    Tanveer ul Haq  Manager      $MANAGER2_EMAIL   $MANAGER2_PW

  Next: sign in as Fawad Iqbal, check Settings (company details, bank, email
  notifications), then add Staff under Users.

INFO
