#!/usr/bin/env bash
# Keeps Docker from filling the server's disk (all projects on it). Nightly, by
# docker-cleanup.timer. Never touches volumes (databases, uploads, backups),
# images a container uses (running or stopped), or containers.
#   - build cache: only the most recently used 20 GB is kept (fast rebuilds)
#   - images no container uses: removed once older than 7 days, and unnamed
#     leftovers of rebuilds at once. Named images labelled desk.kebo.keep (RFQ Desk's
#     :previous images, which a failed deploy goes back to) are kept
# Logs how much was freed and warns (syslog, warning) when the disk is over 80%.
# Also writes the disk use to <KEBO_STATUS_DIR>/disk.json (default /opt/kebo-desk/backups/status,
# when that folder exists): the RFQ Desk worker emails the platform admins when it is 80% or more.
# Installed at /usr/local/sbin/docker-cleanup.sh; see install.sh.
set -uo pipefail

used() { df -BG --output=used / | tail -1 | tr -dc 0-9; }
before=$(used)

docker buildx prune -f --max-used-space 20GB >/dev/null
docker image prune -f >/dev/null
docker image prune -af --filter "until=168h" --filter "label!=desk.kebo.keep" >/dev/null

after=$(used)
pct=$(df --output=pcent / | tail -1 | tr -dc 0-9)
free=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
echo "freed $((before - after)) GB; disk ${pct}% used, ${free} GB free"
status_dir="${KEBO_STATUS_DIR:-/opt/kebo-desk/backups/status}"
if [ -d "$status_dir" ]; then
  printf '{"at":"%s","percent":%d,"freeGb":%d}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$pct" "$free" >"$status_dir/.disk.json.tmp" &&
    chmod 644 "$status_dir/.disk.json.tmp" && mv "$status_dir/.disk.json.tmp" "$status_dir/disk.json"
fi
if [ "$pct" -ge 80 ]; then
  logger -p user.warning -t docker-cleanup "disk ${pct}% full (${free} GB free) after cleanup"
  echo "WARNING: disk ${pct}% full after cleanup"
fi
