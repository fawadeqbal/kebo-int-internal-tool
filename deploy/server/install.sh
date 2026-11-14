#!/usr/bin/env bash
# One-time setup on the server (or again after a change; the deploy runs it when these files change):
#   - the nightly Docker cleanup (docker-cleanup.timer)
#   - the server's status every minute for Dev tools (kebo-status.timer)
#   - the live logs for Dev tools (kebo-logs.service)
set -euo pipefail
cd "$(dirname "$0")"
sudo install -m 0755 docker-cleanup.sh /usr/local/sbin/docker-cleanup.sh
sudo install -m 0644 docker-cleanup.service docker-cleanup.timer /etc/systemd/system/
if command -v python3 >/dev/null; then
  sudo install -m 0755 kebo-status.py /usr/local/sbin/kebo-status
  sudo install -m 0755 kebo-logs.py /usr/local/sbin/kebo-logs
  sudo install -m 0644 kebo-status.service kebo-status.timer kebo-logs.service /etc/systemd/system/
else
  echo "WARNING: python3 is missing: Dev tools shows no server status or live logs until it is installed" >&2
fi
sudo systemctl daemon-reload
sudo systemctl enable --now docker-cleanup.timer
if command -v python3 >/dev/null; then
  sudo systemctl enable --now kebo-status.timer
  sudo systemctl enable kebo-logs.service
  sudo systemctl restart kebo-logs.service
fi
systemctl list-timers docker-cleanup.timer kebo-status.timer --no-pager
