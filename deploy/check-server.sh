#!/usr/bin/env bash
# READ-ONLY survey of the server before installing Kebo RFQ Desk.
# It changes nothing: it only lists what is already running, so names and ports don't clash.
# Run from your PC:   ssh server 'bash -s' < deploy/check-server.sh
set -u
section() { printf '\n===== %s =====\n' "$1"; }
SUDO=""; if [ "$(id -u)" != 0 ] && sudo -n true 2>/dev/null; then SUDO="sudo -n"; fi
D="docker"; if ! docker ps >/dev/null 2>&1 && [ -n "$SUDO" ]; then D="$SUDO docker"; fi

section "System"
. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"; uname -m; nproc | sed 's/^/CPUs: /'
free -h | sed -n '1,2p'; df -h / /var/lib/docker 2>/dev/null | sort -u
echo "user: $(id -un) (sudo without password: $([ -n "$SUDO" ] && echo yes || echo no))"

section "Docker"
$D version --format 'engine {{.Server.Version}}' 2>&1 | head -1
$D compose version 2>&1 | head -1

section "Containers (name | image | ports | status)"
$D ps -a --format '{{.Names}} | {{.Image}} | {{.Ports}} | {{.Status}}' 2>&1

section "Compose projects"
$D compose ls -a 2>&1

section "Networks"
$D network ls --format '{{.Name}} ({{.Driver}})' 2>&1

section "Volumes"
$D volume ls --format '{{.Name}}' 2>&1

section "Images"
$D images --format '{{.Repository}}:{{.Tag}}  {{.Size}}' 2>&1 | head -60

section "Listening ports"
($SUDO ss -tlnp 2>/dev/null || ss -tln) | awk 'NR==1 || /LISTEN/' | sed 's/users:((\("[^"]*"\).*/\1/'

section "Is port 3410 free?"
if ss -tln | awk '{print $4}' | grep -qE '[:.]3410$'; then echo "3410 IN USE"; else echo "3410 free"; fi

section "Caddy"
systemctl is-active caddy 2>/dev/null | sed 's/^/systemd caddy: /'
command -v caddy && caddy version 2>/dev/null
$D ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -i caddy
for f in /etc/caddy/Caddyfile /opt/*/Caddyfile /opt/*/*/Caddyfile /home/*/*/Caddyfile /srv/*/Caddyfile; do
  [ -f "$f" ] && { echo "--- $f (site names only)"; grep -E '^[^#[:space:]].*\{' "$f" | head -40; }
done 2>/dev/null
for c in $($D ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk 'tolower($2) ~ /caddy/ {print $1}'); do
  echo "--- caddy container $c mounts:"; $D inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' "$c"
  echo "--- networks of $c:"; $D inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c"
done

section "Existing app folders"
ls -d /opt/* /srv/* 2>/dev/null

section "Firewall"
($SUDO firewall-cmd --list-all 2>/dev/null || $SUDO ufw status 2>/dev/null || echo "no firewalld/ufw info") | head -20

echo; echo "Done. Nothing was changed."
