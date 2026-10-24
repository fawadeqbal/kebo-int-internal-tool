#!/usr/bin/env bash
# Install or update Kebo RFQ Desk on a server that already runs other apps
# behind a shared Caddy (145.241.156.60: container "global-caddy", network "global-proxy").
#
#   cd /opt/kebo-rfq && bash deploy/install.sh
#
# Safe to run again for every update. What it touches outside its own folder:
#   - joins the existing Docker network $PROXY_NETWORK (only the app container, as "kebo-rfq-app")
#   - appends ONE site block for $DOMAIN to $CADDYFILE (only if it is not there yet),
#     checks it with "caddy validate" and puts the old file back if the check fails,
#     then reloads Caddy (zero downtime for the other sites)
# Everything else is prefixed kebo-rfq (containers, volumes, network, image) and
# listens on 127.0.0.1:$APP_PORT only.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${DOMAIN:-rfq.fawadiqbal.dev}"
PROXY_CONTAINER="${PROXY_CONTAINER:-global-caddy}"
PROXY_NETWORK="${PROXY_NETWORK:-global-proxy}"
CADDYFILE="${CADDYFILE:-/opt/global-proxy/Caddyfile}"
APP_PORT="${APP_PORT:-3410}"
PROJECT=kebo-rfq

say() { printf '\033[1;36m[kebo-rfq]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[kebo-rfq] STOP:\033[0m %s\n' "$*" >&2; exit 1; }

D="docker"
docker ps >/dev/null 2>&1 || D="sudo docker"
$D ps >/dev/null 2>&1 || die "cannot talk to Docker (as $(id -un) or with sudo)"
SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"

# ---------------------------------------------------------------- 1. Pre-flight checks (read only)
say "checking the server…"
$D network inspect "$PROXY_NETWORK" >/dev/null 2>&1 || die "Docker network $PROXY_NETWORK not found"
$D inspect "$PROXY_CONTAINER" >/dev/null 2>&1 || die "Caddy container $PROXY_CONTAINER not found"
[ -f "$CADDYFILE" ] || die "Caddyfile $CADDYFILE not found"
owner=$($D ps -a --filter "name=^kebo-rfq-app$" --format '{{.Label "com.docker.compose.project"}}')
[ -z "$owner" ] || [ "$owner" = "$PROJECT" ] || die "a container called kebo-rfq-app already belongs to project '$owner'"
if ss -tln | awk '{print $4}' | grep -qE "[:.]${APP_PORT}\$"; then
  $D ps --filter "name=^kebo-rfq-app$" -q | grep -q . || die "port $APP_PORT is used by something else; run again with APP_PORT=<free port>"
fi
if grep -qE "^[^#]*\b${DOMAIN//./\\.}\b" "$CADDYFILE" && ! grep -q "reverse_proxy kebo-rfq-app:3000" "$CADDYFILE"; then
  die "$DOMAIN is already used by another site in $CADDYFILE"
fi
say "ok: no name, port or domain clashes"

# ---------------------------------------------------------------- 2. Settings (.env), first run only
FIRST_RUN=0
if [ ! -f .env ]; then
  FIRST_RUN=1
  say "first install: creating .env with fresh secrets"
  ask() { local var="$1" prompt="$2" def="$3" val; if [ -t 0 ]; then read -rp "$prompt [$def]: " val; fi; printf -v "$var" '%s' "${val:-$def}"; }
  ask ADMIN_EMAIL "Fawad Iqbal (Super Admin) email" "${ADMIN_EMAIL:-admin@fawadiqbal.dev}"
  ask MANAGER_EMAIL "Faizur Rehman (Manager) email" "${MANAGER_EMAIL:-faizur@keboint.com}"
  ask MANAGER2_EMAIL "Tanveer ul Haq (Manager) email" "${MANAGER2_EMAIL:-tanveer@keboint.com}"
  ask NOTIFY "Emails told about new RFQs (comma separated)" "${NOTIFY:-info@keboint.com, shandongkeboint@gmail.com}"
  pw() { printf 'Kb%s7' "$(openssl rand -hex 7)"; }
  ADMIN_PW=$(pw); MANAGER_PW=$(pw); MANAGER2_PW=$(pw)
  umask 077
  cat > .env <<ENV
# Kebo RFQ Desk on $(hostname) — created $(date -u +%F) by deploy/install.sh. Keep this file private.
COMPOSE_PROJECT_NAME=$PROJECT
COMPOSE_FILE=docker-compose.yml:deploy/compose.shared-proxy.yml
PROXY_NETWORK=$PROXY_NETWORK
APP_PORT=$APP_PORT

DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
COOKIE_SECURE=true
APP_TIME_ZONE=Asia/Shanghai

POSTGRES_PASSWORD=$(openssl rand -hex 24)
MINIO_ROOT_USER=kebo
MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)
AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')

PUBLIC_FORM_ORIGINS=https://keboint.com,https://www.keboint.com
NOTIFY_EMAILS="$NOTIFY"

# Outgoing email (fill in, then: docker compose up -d)
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# Security (see deploy/README.md → Security settings)
TWO_STEP_REQUIRED_ROLES=
TURNSTILE_SECRET_KEY=
BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
OFFSITE_S3_ENDPOINT=
OFFSITE_S3_REGION=auto
OFFSITE_S3_BUCKET=
OFFSITE_S3_ACCESS_KEY=
OFFSITE_S3_SECRET_KEY=

# Starting accounts (only used when an account does not exist yet)
SEED_ADMIN_NAME="Fawad Iqbal"
SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_PASSWORD=$ADMIN_PW
SEED_MANAGER_NAME="Faizur Rehman"
SEED_MANAGER_EMAIL=$MANAGER_EMAIL
SEED_MANAGER_PASSWORD=$MANAGER_PW
SEED_MANAGER2_NAME="Tanveer ul Haq"
SEED_MANAGER2_EMAIL=$MANAGER2_EMAIL
SEED_MANAGER2_PASSWORD=$MANAGER2_PW
ENV
  umask 022
fi
grep -q '^COMPOSE_FILE=' .env || die ".env exists but has no COMPOSE_FILE line; add: COMPOSE_FILE=docker-compose.yml:deploy/compose.shared-proxy.yml"

# ---------------------------------------------------------------- 3. Build and start
say "building the app image (a few minutes on first run)…"
$D compose build app
say "starting containers…"
$D compose up -d --remove-orphans
say "waiting for the app to be healthy…"
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null 2>&1; then break; fi
  [ "$i" = 90 ] && { $D compose logs --tail 60 app; die "the app did not become healthy"; }
  sleep 2
done
curl -fsS "http://127.0.0.1:${APP_PORT}/healthz"; echo

# ---------------------------------------------------------------- 4. Starting accounts (existing ones are left alone)
$D compose exec -T app node dist/scripts/seed.js

# ---------------------------------------------------------------- 5. Caddy site block (once)
if ! grep -q "reverse_proxy kebo-rfq-app:3000" "$CADDYFILE"; then
  backup="$CADDYFILE.before-kebo-rfq-$(date +%Y%m%d-%H%M%S)"
  say "adding $DOMAIN to $CADDYFILE (backup: $backup)"
  $SUDO cp -p "$CADDYFILE" "$backup"
  # Append in place (same file, so the bind mount inside global-caddy sees it).
  { printf '\n'; sed "s/__DOMAIN__/$DOMAIN/" deploy/Caddyfile.site; } | $SUDO tee -a "$CADDYFILE" >/dev/null
  if ! $D exec "$PROXY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/kebo-caddy-validate.log 2>&1; then
    $SUDO sh -c "cat '$backup' > '$CADDYFILE'"
    cat /tmp/kebo-caddy-validate.log >&2
    die "Caddy rejected the new block; the Caddyfile was put back exactly as it was"
  fi
  $D exec "$PROXY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  say "Caddy reloaded"
else
  say "Caddy already routes $DOMAIN"
fi

# ---------------------------------------------------------------- 6. Check through Caddy
sleep 2
code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/healthz" || true)
dns=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
say "through Caddy: HTTP $code   ·   DNS for $DOMAIN: ${dns:-not set yet}"
[ -n "$dns" ] || say "add a DNS A record: $DOMAIN -> 145.241.156.60 (Caddy then gets the HTTPS certificate by itself)"

echo
say "done: https://$DOMAIN"
if [ "$FIRST_RUN" = 1 ]; then
  cat <<INFO

  Logins (also stored in /opt/kebo-rfq/.env — change the passwords after signing in):
    Fawad Iqbal     Super Admin  $ADMIN_EMAIL   $ADMIN_PW
    Faizur Rehman   Manager      $MANAGER_EMAIL   $MANAGER_PW
    Tanveer ul Haq  Manager      $MANAGER2_EMAIL   $MANAGER2_PW

INFO
fi
