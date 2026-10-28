#!/usr/bin/env bash
# One-time setup on the server (or again after a change): installs the nightly Docker cleanup.
set -euo pipefail
cd "$(dirname "$0")"
sudo install -m 0755 docker-cleanup.sh /usr/local/sbin/docker-cleanup.sh
sudo install -m 0644 docker-cleanup.service docker-cleanup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now docker-cleanup.timer
systemctl list-timers docker-cleanup.timer --no-pager
