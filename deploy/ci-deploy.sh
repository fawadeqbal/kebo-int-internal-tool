#!/usr/bin/env bash
# Run on the server by GitHub Actions (.github/workflows/deploy.yml) over SSH.
#
# The Actions key in ~opc/.ssh/authorized_keys may only run this, through a
# forced command that first brings /opt/kebo-desk up to main:
#   command="cd /opt/kebo-desk && git fetch -q origin main && git merge --ff-only -q origin/main && exec bash deploy/ci-deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA… github-actions@kebo-desk
#
# Copies the database first (backups/pre-deploy-*.sql.gz, the last 10 kept), so
# a deploy whose migrations change data can be undone. Then rebuilds and
# restarts with docker compose, waits until the containers are healthy, and
# fails (so the workflow shows red) if they are not. If the build fails, the
# running containers are left as they were.
set -euo pipefail

main() {
  cd /opt/kebo-desk
  # One deploy at a time, even if two are started by hand.
  exec 9>/tmp/kebo-desk-deploy.lock
  flock -w 1800 9

  echo "Deploying $(git log -1 --format='%h %s')"
  # The database as it is before this deploy's migrations run.
  if sudo docker compose ps --status running --services | grep -qx db; then
    sudo mkdir -p backups
    local copy="backups/pre-deploy-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).sql.gz"
    sudo docker compose exec -T db pg_dump -U kebo --no-owner kebo | gzip | sudo tee "$copy.tmp" >/dev/null
    sudo mv "$copy.tmp" "$copy"
    echo "Database copied to $copy"
    ls -1t backups/pre-deploy-*.sql.gz | tail -n +11 | xargs -r sudo rm -f
  fi
  sudo docker compose up -d --build --wait --wait-timeout 900
  sudo docker compose ps --format '{{.Service}}: {{.Status}}'
  # The images this rebuild replaced are now unnamed leftovers: remove them (never a used one).
  sudo docker image prune -f >/dev/null || true
  echo "$(date -Is) deployed $(git rev-parse --short HEAD)" >>"$HOME/kebo-deploys.log"
}

main "$@"
exit
