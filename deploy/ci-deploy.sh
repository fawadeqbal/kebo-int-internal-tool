#!/usr/bin/env bash
# Deploys RFQ Desk on the server. Run by GitHub Actions (.github/workflows/deploy.yml) over SSH, or by hand:
#   cd /opt/kebo-desk && bash deploy/ci-deploy.sh             the latest commit of main
#   cd /opt/kebo-desk && bash deploy/ci-deploy.sh <commit>    that commit of main (e.g. to go back to it)
#
# The Actions key in ~opc/.ssh/authorized_keys may only run this, through a
# forced command that first brings /opt/kebo-desk up to main:
#   command="cd /opt/kebo-desk && git fetch -q origin main && git merge --ff-only -q origin/main && exec bash deploy/ci-deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA… github-actions@kebo-desk
# The workflow sends the commit CI passed for as the SSH command (SSH_ORIGINAL_COMMAND): exactly that
# commit is deployed, if it is on main; anything else is refused. One older than the commit already
# deployed (CI runs that finish out of order) is skipped, unless it is sent as "<commit> --older-ok"
# (Run workflow with a commit: going back on purpose).
#
# The site keeps running the previous version until step 5:
#   1. tag the running images :previous
#   2. build the new images (a failed build changes nothing)
#   3. copy the database (backups/pre-deploy-*.sql.gz, the last 10 kept)
#   4. apply the migrations with the new image, in a one-off container. If they fail: stop, leave
#      the old containers running, and print how to recover
#   5. start the new containers and wait until they are healthy. If they are not: start the
#      :previous images again, and fail
# The API also applies migrations when it starts (a no-op after step 4; for a deploy by hand).
set -euo pipefail

APP_DIR="${KEBO_DESK_DIR:-/opt/kebo-desk}"
STATE="$HOME/kebo-deployed-commit"
LOG="$HOME/kebo-deploys.log"
# The services whose images are built here (the worker runs the api image).
BUILT=(api web backup)

dc() { sudo docker compose "$@"; }
say() { echo "[deploy] $*"; }
die() {
  echo "[deploy] ERROR: $*" >&2
  exit 1
}
short() { git rev-parse --short "$1"; }
# Whether a service's container is running. (Not "| grep -q": with pipefail, grep stopping early
# can fail the pipeline.)
running() { [[ $'\n'"$(dc ps --status running --services)"$'\n' == *$'\n'"$1"$'\n'* ]]; }

# Puts the working tree at a commit: on the branch main when it is main's latest, else detached.
checkout() {
  if [ "$1" = "$(git rev-parse origin/main)" ] && git show-ref -q --verify refs/heads/main; then
    git checkout -q main
    git merge --ff-only -q origin/main
  else
    git checkout -q --detach "$1"
  fi
}

# The commit running now: recorded by the last deploy (or found in the deploy log).
deployed_commit() {
  local c=""
  [ -s "$STATE" ] && c=$(<"$STATE")
  [ -n "$c" ] || c=$(awk '$2 == "deployed" { c = $3 } END { print c }' "$LOG" 2>/dev/null || true)
  if [ -n "$c" ]; then git rev-parse -q --verify "$c^{commit}" 2>/dev/null || true; fi
}

# The running images, tagged :previous (only this app's: kebo-desk-*).
tag_previous() {
  local svc cid ref
  for svc in "${BUILT[@]}"; do
    cid=$(dc ps -q "$svc" 2>/dev/null | head -n 1)
    [ -n "$cid" ] || continue
    ref=$(sudo docker inspect -f '{{.Config.Image}}' "$cid")
    case "$ref" in kebo-desk-*) ;; *) continue ;; esac
    sudo docker tag "$(sudo docker inspect -f '{{.Image}}' "$cid")" "${ref%:*}:previous"
    TAGGED+=("$ref")
    say "running $svc image kept as ${ref%:*}:previous"
  done
}

# Back to the previous images and the previous commit's files (after a failure).
restore_previous() {
  local ref
  for ref in ${TAGGED[@]+"${TAGGED[@]}"}; do sudo docker tag "${ref%:*}:previous" "$ref"; done
  if [ -n "$DEPLOYED" ]; then checkout "$DEPLOYED"; fi
}

# The database copied to backups/pre-deploy-<date>-<commit>.sql.gz (COPY), checked; the last 10 kept.
# Each step is checked here: set -e does not apply inside a function called with ||.
copy_database() {
  COPY=""
  if ! running db; then dc up -d --no-build --wait db || return 1; fi
  local copy
  copy="backups/pre-deploy-$(date +%Y%m%d-%H%M%S)-$(short HEAD).sql.gz"
  sudo mkdir -p backups || return 1
  dc exec -T db pg_dump -U kebo --no-owner kebo | gzip | sudo tee "$copy.tmp" >/dev/null || return 1
  sudo gzip -t "$copy.tmp" && sudo mv "$copy.tmp" "$copy" || return 1
  COPY=$copy
  say "database copied to $COPY"
  sudo sh -c 'ls -1t backups/pre-deploy-*.sql.gz | tail -n +11 | xargs -r rm -f'
}

migration_failed() {
  local failed
  failed=$(dc exec -T db psql -U kebo -d kebo -Atc \
    "select string_agg(migration_name, ', ') from _prisma_migrations where finished_at is null and rolled_back_at is null" 2>/dev/null || true)
  restore_previous
  cat >&2 <<EOF

[deploy] ERROR: the database migrations of $(short "$TARGET") failed (the error is above).
Nothing was restarted: the site still runs the previous version${DEPLOYED:+ ($(short "$DEPLOYED"))}, and the
files here are back at it. It can restart (it starts with a warning about the failed migration),
but no deploy can apply migrations until the failed one is dealt with.

Failed migration: ${failed:-none recorded (it failed before it started)}

Undo it: a migration can stop half-way, so put the database back as it was before this deploy:
  cd $APP_DIR
  sudo docker compose stop web worker api
  sudo docker compose exec -T db psql -U kebo -d kebo -v ON_ERROR_STOP=1 -c "drop schema public cascade" -c "create schema public"
  gunzip -c ${COPY:-backups/pre-deploy-<latest>.sql.gz} | sudo docker compose exec -T db psql -q -U kebo -d kebo -v ON_ERROR_STOP=1
  sudo docker compose start api worker web
(Only if you are sure none of it was applied, instead mark it as rolled back:
  sudo docker compose run --rm --no-deps api sh -c "cd /app/packages/database && npx prisma migrate resolve --rolled-back <name>")
Then fix it in a NEW migration (never edit one that was applied anywhere) and deploy again.
More: docs/restore.md.
EOF
}

main() {
  cd "$APP_DIR"
  # One deploy at a time, even if two are started by hand.
  exec 9>/tmp/kebo-desk-deploy.lock
  flock -w 1800 9

  local request="" from_ssh=""
  if [ -n "${SSH_ORIGINAL_COMMAND-}" ]; then
    request=$SSH_ORIGINAL_COMMAND
    from_ssh=1
  elif [ -n "${1-}" ]; then
    request=$1
  fi
  git fetch -q origin main
  if [ -n "$request" ]; then
    # "<commit>", or "<commit> --older-ok" to go back to an older one (Run workflow with a commit).
    [[ $request =~ ^([0-9a-f]{7,40})(\ --older-ok)?$ ]] || die "refused: \"$request\" is not a commit id"
    request=${BASH_REMATCH[1]}
    if [ -n "${BASH_REMATCH[2]}" ]; then from_ssh=""; fi
    TARGET=$(git rev-parse -q --verify "$request^{commit}") || die "refused: commit $request is not known here (not on main?)"
    git merge-base --is-ancestor "$TARGET" origin/main || die "refused: commit $request is not on main"
  else
    TARGET=$(git rev-parse origin/main)
  fi
  DEPLOYED=$(deployed_commit)
  if [ -n "$from_ssh" ] && [ -n "$DEPLOYED" ] && [ "$DEPLOYED" != "$TARGET" ] && git merge-base --is-ancestor "$TARGET" "$DEPLOYED"; then
    say "$(short "$DEPLOYED") is already deployed and newer than $(short "$TARGET"): nothing to do"
    checkout "$DEPLOYED"
    return 0
  fi
  checkout "$TARGET"
  say "deploying $(git log -1 --format='%h %s')${DEPLOYED:+ (running now: $(short "$DEPLOYED"))}"

  # 1. The running images, to come back to (from the containers, so a half-finished build changes nothing).
  TAGGED=()
  tag_previous

  # 2. Build. A failure here leaves everything running as it was.
  dc build || {
    restore_previous
    die "the build failed: nothing was changed"
  }

  # 3. The database as it is just before this deploy's migrations (after the build, so nothing
  # entered while it built is missing from the copy).
  copy_database || {
    restore_previous
    die "could not copy the database: nothing was changed"
  }

  # 4. Migrations with the new image while the old containers keep serving.
  say "applying the database migrations"
  # Its own name: the api service may have a fixed container_name (deploy/compose.shared-proxy.yml).
  if ! dc run --rm --no-deps -T --name "kebo-desk-migrate-$(date +%s)" api sh -c "cd /app/packages/database && npx prisma migrate deploy"; then
    migration_failed
    exit 1
  fi

  # 5. The new containers.
  if ! dc up -d --no-build --wait --wait-timeout 900; then
    say "the new containers are not healthy:"
    dc ps --format '{{.Service}}: {{.Status}}' || true
    dc logs --tail 30 api worker web || true
    if [ ${#TAGGED[@]} -eq 0 ]; then die "nothing was running before, so there is nothing to go back to"; fi
    say "starting the previous version again"
    restore_previous
    if dc up -d --no-build --wait --wait-timeout 600; then
      say "the previous version${DEPLOYED:+ ($(short "$DEPLOYED"))} runs again."
    else
      say "the previous version is not healthy either: see sudo docker compose ps / logs"
    fi
    say "this deploy's migrations stay applied; to undo them too, restore ${COPY:-the pre-deploy copy} (docs/restore.md)."
    echo "$(date -Is) FAILED $(short "$TARGET"), back on ${DEPLOYED:+$(short "$DEPLOYED")}" >>"$LOG"
    exit 1
  fi
  dc ps --format '{{.Service}}: {{.Status}}'
  # The images this rebuild replaced are now unnamed leftovers: remove them (never a used one, never :previous).
  sudo docker image prune -f >/dev/null || true
  echo "$TARGET" >"$STATE"
  echo "$(date -Is) deployed $(short "$TARGET")" >>"$LOG"
  say "deployed $(short "$TARGET")"
}

# One line: bash reads it whole before running it, so the checkout of another commit (which may
# change this file) cannot make it read the rest of a different script.
main "$@"; exit $?
