#!/usr/bin/env bash
# Run on your PC (Git Bash) to deploy the committed version to the server:
#   bash deploy/push.sh                 # uses the "server" entry in ~/.ssh/config
#   bash deploy/push.sh serverb
#   bash deploy/push.sh --fresh-start   # then DELETES all data and starts empty (deploy/fresh-start.sh)
# It uploads the code to /opt/kebo-rfq (your .env and backups there are kept)
# and runs deploy/install.sh on the server.
set -euo pipefail
FRESH=0; HOST="server"
for arg in "$@"; do
  case "$arg" in
    --fresh-start) FRESH=1 ;;
    *) HOST="$arg" ;;
  esac
done
cd "$(dirname "$0")/.."
git diff --quiet HEAD -- || echo "note: you have uncommitted changes; only the last commit is deployed"
echo "[push] uploading $(git log -1 --format='%h %s') to $HOST:/opt/kebo-rfq"
git archive --format=tar HEAD | ssh "$HOST" 'sudo mkdir -p /opt/kebo-rfq && sudo chown "$(id -u):$(id -g)" /opt/kebo-rfq && tar -x -C /opt/kebo-rfq'
ssh -t "$HOST" 'cd /opt/kebo-rfq && bash deploy/install.sh'
if [ "$FRESH" = 1 ]; then
  ssh -t "$HOST" 'cd /opt/kebo-rfq && bash deploy/fresh-start.sh'
fi
