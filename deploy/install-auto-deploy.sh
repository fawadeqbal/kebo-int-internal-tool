#!/usr/bin/env bash
# One-time setup on the server (as opc, from /opt/kebo-desk): installs the timer
# that deploys main once CI has passed. Run again after changing the unit files.
set -euo pipefail
cd "$(dirname "$0")"
sudo install -m 0644 systemd/kebo-deploy.service systemd/kebo-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kebo-deploy.timer
systemctl list-timers kebo-deploy.timer --no-pager
