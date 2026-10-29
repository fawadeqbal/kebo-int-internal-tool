#!/usr/bin/env bash
# Switches on the off-site backup copy, on the RFQ Desk server:
#
#   cd /opt/kebo-desk && bash deploy/server/enable-offsite.sh
#
# Paste the OFFSITE_* lines that deploy/offsite-minio/setup.sh printed, then press Ctrl-D. They are
# saved in .env (replacing any OFFSITE_* lines there; the old .env is kept as .env.before-offsite-<date>),
# the backup container restarts and backs up at once, and the result is checked.
set -euo pipefail

APP_DIR="${KEBO_DESK_DIR:-/opt/kebo-desk}"
cd "$APP_DIR"
sudo test -f .env || {
  echo "ERROR: no .env in $APP_DIR" >&2
  exit 1
}
dc() { sudo docker compose "$@"; }

echo "Paste the OFFSITE_ lines, then press Ctrl-D:"
lines=$(grep -E '^[[:space:]]*OFFSITE_[A-Z0-9_]+=' || true)
lines=$(printf '%s\n' "$lines" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
for need in OFFSITE_S3_ENDPOINT OFFSITE_S3_BUCKET OFFSITE_S3_ACCESS_KEY OFFSITE_S3_SECRET_KEY OFFSITE_ENCRYPTION_PASSWORD; do
  value=$(printf '%s\n' "$lines" | sed -n "s/^$need=//p" | tail -n 1)
  if [ -z "$value" ] || [[ $value == "<"* ]]; then
    echo "ERROR: $need is missing or not filled in. Nothing was changed." >&2
    exit 1
  fi
done

# .env and backups/ may be readable by root only: every step on them goes through sudo.
backup=".env.before-offsite-$(date +%Y%m%d-%H%M%S)"
sudo cp -p .env "$backup"
{
  sudo grep -vE '^[[:space:]]*OFFSITE_[A-Z0-9_]+=' "$backup" || true
  echo "# Off-site backup copy (deploy/server/enable-offsite.sh, $(date -I))"
  printf '%s\n' "$lines"
} | sudo tee .env.new >/dev/null
sudo chmod --reference="$backup" .env.new
sudo chown --reference="$backup" .env.new
sudo mv .env.new .env
echo "Saved in .env (the previous one: $backup)."

echo "Restarting the backup container: it backs up and copies off-site now…"
dc up -d backup >/dev/null
status=backups/status/last-status.json
# The backup writes this file once, when its run ends (up to 15 minutes are waited for).
before=$(sudo stat -c %Y "$status" 2>/dev/null || echo 0)
for _ in $(seq 1 90); do
  now=$(sudo stat -c %Y "$status" 2>/dev/null || echo 0)
  if [ "$now" -gt "$before" ]; then break; fi
  sleep 10
done
if sudo grep -q '"offsite":"ok"' "$status" 2>/dev/null; then
  echo "Done: the backup was copied off-site."
  sudo cat "$status"
  echo
else
  echo "The off-site copy did not succeed yet. What the backup said:" >&2
  sudo cat "$status" >&2 2>/dev/null || true
  echo >&2
  dc logs --tail 30 backup >&2 || true
  echo "Check that this server can reach the address in OFFSITE_S3_ENDPOINT (firewall, port)." >&2
  exit 1
fi
