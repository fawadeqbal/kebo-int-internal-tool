#!/usr/bin/env bash
# Deploys main to this server once GitHub's CI has passed for it.
#
# Run by the kebo-deploy.timer every two minutes (deploy/systemd). Each run:
#   1. fetches main; nothing new → done;
#   2. asks GitHub (the repository is public, so no token) whether the "CI"
#      workflow passed for that commit; still running → try again next time;
#      failed → wait (a re-run that passes is picked up);
#   3. fast-forwards, rebuilds and restarts with docker compose, waits until the
#      containers are healthy and the site answers, and logs the result.
# A commit whose build fails is not retried until a newer one arrives
# (or: rm ~/.kebo-deploy/failed). Logs: journalctl -u kebo-deploy, and
# ~/.kebo-deploy/last.txt for the last result.
#
# Wrapped in main() so bash reads the whole file first: the git pull below
# may replace this very file while it runs.
set -euo pipefail

main() {
  local dir=/opt/kebo-desk repo=fawadeqbal/kebo-int-internal-tool site=https://rfq.fawadiqbal.dev
  local state="$HOME/.kebo-deploy"
  mkdir -p "$state"
  exec 9>"$state/lock"
  flock -n 9 || exit 0
  cd "$dir"

  git fetch -q origin main
  local head target
  head=$(git rev-parse HEAD)
  target=$(git rev-parse origin/main)
  [ "$head" = "$target" ] && exit 0
  if [ -f "$state/failed" ] && [ "$(cat "$state/failed")" = "$target" ]; then exit 0; fi

  local short=${target:0:7}
  local ci
  ci=$(curl -fsS --max-time 20 -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$repo/actions/runs?head_sha=$target&event=push&per_page=20" |
    jq -r '[.workflow_runs[] | select(.name == "CI")] | sort_by(.run_started_at) | last | if . == null then "none" else "\(.status)/\(.conclusion)" end') || {
    echo "$short: could not ask GitHub about CI; trying again later"
    exit 0
  }
  case "$ci" in
    completed/success) ;;
    completed/*)
      if [ "$(cat "$state/ci-failed" 2>/dev/null)" != "$target" ]; then
        echo "$short: CI did not pass ($ci); not deploying. A re-run that passes is deployed."
        echo "$target" >"$state/ci-failed"
      fi
      exit 0
      ;;
    *) exit 0 ;; # not started or still running
  esac

  local subject started
  subject=$(git log -1 --format=%s "$target")
  started=$(date -Is)
  echo "$short: CI passed; deploying \"$subject\""

  if git merge --ff-only -q origin/main &&
    sudo docker compose up -d --build --wait --wait-timeout 900 &&
    curl -fsS --max-time 20 -o /dev/null "$site/login"; then
    rm -f "$state/failed" "$state/ci-failed"
    printf '%s deployed %s "%s" (started %s)\n' "$(date -Is)" "$short" "$subject" "$started" | tee "$state/last.txt"
    sudo docker compose ps --format '{{.Service}} {{.Status}}'
  else
    echo "$target" >"$state/failed"
    printf '%s FAILED to deploy %s "%s"; it stays as it was. Retry: rm %s/failed\n' "$(date -Is)" "$short" "$subject" "$state" | tee "$state/last.txt"
    sudo docker compose ps --format '{{.Service}} {{.Status}}' || true
    exit 1
  fi
}

main "$@"
exit
