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
3. It prints the three logins (Fawad Iqbal, Faizur Rehman, Tanveer ul Haq) once at the end. Sign in at https://rfq.fawadiqbal.dev and change the passwords.

## Updates

Commit, then `bash deploy/push.sh` again. `.env`, the database, files and backups stay; migrations run on start.

## Security settings

**Two-step sign-in** is off by default: nobody is asked for it, and anyone can turn it on for
themselves under My account. To make it compulsory, set `TWO_STEP_REQUIRED_ROLES=admin,manager` in `.env`
and run `docker compose up -d`; at their next sign-in each is then asked to scan a QR code with an
authenticator app and save 10 recovery codes.
Lost phone: the Super Admin resets it for others under Users. For the Super Admin's own account, on the server:

```bash
docker compose exec app node dist/scripts/reset-two-step.js admin@fawadiqbal.dev
```

**Phone push notifications** (Firebase Cloud Messaging). In the Firebase console of project
`kebo-rfq`: Project settings → Service accounts → Generate new private key. Copy the downloaded file
to the server (never into git) and deploy again:

```bash
scp kebo-rfq-firebase-adminsdk-*.json server:/opt/kebo-rfq/firebase-service-account.json
bash deploy/push.sh
```

`install.sh` moves it to `secrets/firebase.json`, readable only by the app. Every in-app
notification is then also sent to the person's phones (signed in to the app); signing out stops it.

**Off-site backup copy.** Make a bucket at any S3-compatible service (Cloudflare R2, Backblaze B2, AWS S3, Wasabi)
with a key that can only read/write that bucket, then add to `.env` and run `docker compose up -d`:

```bash
OFFSITE_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com   # empty for AWS S3
OFFSITE_S3_REGION=auto                                              # e.g. eu-central-1 for AWS
OFFSITE_S3_BUCKET=kebo-rfq-backups
OFFSITE_S3_ACCESS_KEY=...
OFFSITE_S3_SECRET_KEY=...
BACKUP_ENCRYPTION_KEY=...       # openssl rand -base64 32 — ALSO keep a copy off this server (password manager)
OFFSITE_RETENTION_DAYS=30
```

Each night's backup is encrypted (AES-256) and copied within 30 minutes (`docker compose logs worker | grep offsite`).
Without `BACKUP_ENCRYPTION_KEY` the copies can't be read, so store it somewhere other than this server. To restore one:

```bash
docker compose cp db-2026-10-24_0200.sql.gz.enc worker:/tmp/db.enc      # the file downloaded from the bucket
docker compose exec worker node dist/scripts/decrypt-backup.js /tmp/db.enc /tmp/db.sql.gz
docker compose cp worker:/tmp/db.sql.gz . && gunzip -c db.sql.gz | docker compose exec -T db psql -U qms -d qms
```

**"Not a robot" check on the website form** (Cloudflare Turnstile): follow the steps at the top of
`docs/keboint-contact-form.js`. Put `TURNSTILE_SECRET_KEY=...` in `.env` only after the widget is live on keboint.com
(before that, every website inquiry would be refused).

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
