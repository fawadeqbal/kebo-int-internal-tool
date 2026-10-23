# Deploying on the shared server (145.241.156.60)

The server already runs other apps (global-proxy, hearth, home, kcp-prod, vibe)
behind one Caddy container, `global-caddy`, on the Docker network `global-proxy`.
Kebo RFQ Desk fits in without touching them:

| | Kebo RFQ Desk uses | Clash check |
|---|---|---|
| Folder | `/opt/kebo-rfq` | new |
| Compose project | `kebo-rfq` | not used |
| Containers | `kebo-rfq-app`, `kebo-rfq-worker-1`, `kebo-rfq-db-1`, `kebo-rfq-minio-1`, `kebo-rfq-backup-1` | not used |
| Image | `kebo-rfq-app:latest` | not used |
| Volumes | `kebo-rfq_pgdata`, `kebo-rfq_files` | not used |
| Private network | `kebo-rfq_default` (database, files, worker) | not used |
| Shared network | only the app joins `global-proxy`, as `kebo-rfq-app` | unique name |
| Host port | `127.0.0.1:3410` (local only, for checks) | free |
| Public ports | none of its own; HTTPS comes from `global-caddy` | — |
| Web address | `rfq.fawadiqbal.dev` | not in the Caddyfile |
| Memory caps | app 1.5 GB, db 512 MB, files 512 MB, worker 384 MB, backup 256 MB | 5.4 GB free |

## First install

1. **DNS:** add an `A` record `rfq.fawadiqbal.dev → 145.241.156.60` (check: `nslookup rfq.fawadiqbal.dev`).
2. **From your PC** (Git Bash, project folder, everything committed):
   ```bash
   bash deploy/push.sh
   ```
   It uploads the code to `/opt/kebo-rfq` and runs `deploy/install.sh` there, which:
   - checks there is no name, port or domain clash (stops without changing anything if there is);
   - creates `/opt/kebo-rfq/.env` with fresh secrets and asks for the 3 login emails;
   - builds and starts the containers, waits until the app is healthy;
   - creates the Super Admin, Manager and Staff accounts;
   - appends one site block for `rfq.fawadiqbal.dev` to `/opt/global-proxy/Caddyfile`
     (backup first, `caddy validate`, old file put back if invalid), then reloads Caddy.
     The other sites keep running during the reload.
3. It prints the three logins once at the end. Sign in at https://rfq.fawadiqbal.dev and change the passwords.

## Updates

Commit, then `bash deploy/push.sh` again. `.env`, the database, files and backups stay; migrations run on start.

## Everyday commands (on the server, in /opt/kebo-rfq)

```bash
docker compose ps                    # status
docker compose logs -f app           # app log
docker compose restart app worker    # after editing .env (e.g. SMTP settings)
ls backups/                          # nightly database + file backups (14 days)
```

## Remove completely

```bash
cd /opt/kebo-rfq && docker compose down          # add -v to also delete the data volumes
# then delete the "Kebo RFQ Desk" block from /opt/global-proxy/Caddyfile and reload:
docker exec global-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```
