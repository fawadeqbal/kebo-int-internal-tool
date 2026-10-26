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
git archive --format=tar HEAD | ssh "$HOST" 'cat > /tmp/kebo-rfq-release.tar'
# Unpack it, and delete the files that are no longer in the code (otherwise a removed
# page stays on the server and breaks the build). .env, backups, secrets and uploads are
# never touched: only files that came from a previous upload are removed.
ssh "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
DIR=${KEBO_DIR:-/opt/kebo-rfq}
TAR=/tmp/kebo-rfq-release.tar
SUDO=${KEBO_SUDO-sudo}
$SUDO mkdir -p "$DIR" && $SUDO chown "$(id -u):$(id -g)" "$DIR"
cd "$DIR"
tar -tf "$TAR" | grep -v '/$' | LC_ALL=C sort > .deploy-files.new
if [ -f .deploy-files ]; then
  OLD=.deploy-files
else
  # First upload with this script: compare the code folders only.
  OLD=$(mktemp)
  find src drizzle scripts deploy public tests -type f 2>/dev/null | LC_ALL=C sort > "$OLD"
fi
removed=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in .env*|backups/*|secrets/*|storage/*|*firebase*.json|kebo-rfq-*.json|.deploy-files*) continue ;; esac
  if [ -f "$f" ]; then rm -f -- "$f"; removed=$((removed + 1)); fi
done < <(LC_ALL=C comm -23 "$OLD" .deploy-files.new)
tar -x -f "$TAR"
mv .deploy-files.new .deploy-files
rm -f "$TAR"
find src public drizzle -depth -type d -empty -delete 2>/dev/null || true
[ "$removed" -gt 0 ] && echo "[push] removed $removed old file(s) that are no longer in the code"
exit 0
REMOTE
ssh -t "$HOST" 'cd /opt/kebo-rfq && bash deploy/install.sh'
if [ "$FRESH" = 1 ]; then
  ssh -t "$HOST" 'cd /opt/kebo-rfq && bash deploy/fresh-start.sh'
fi
