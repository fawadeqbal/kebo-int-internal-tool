# Backups and restoring them

All commands run on the server in `/opt/kebo-desk` (`cd /opt/kebo-desk`), as a user that may use Docker (`sudo` in front of `docker` if needed).

## What is kept

| What                                          | Where                                                                               | How long                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Database, every night at `BACKUP_HOUR` (2:00) | `backups/db-<date>.sql.gz`                                                          | `BACKUP_RETENTION_DAYS` (14)                                                                                    |
| Files (drawings, photos, PDFs), every night   | `backups/files-<date>.tar.gz`                                                       | the newest `BACKUP_FILES_KEEP` (2)                                                                              |
| Database before each deploy                   | `backups/pre-deploy-<date>-<commit>.sql.gz`                                         | the last 10                                                                                                     |
| Off-site, when set up (below)                 | your own S3 store: `db/` (the nightly dumps) and `files/` (the files, kept in step) | `OFFSITE_RETENTION_DAYS` (30) for dumps, and for files deleted or replaced in the app (`files-changed/<date>/`) |

Every nightly dump is checked before it gets its name (a whole gzip file, not tiny, ending the way a complete dump ends); old copies are removed only after a good run. The result is in `backups/status/last-status.json`. The worker reads it every hour and emails the platform admins (`PLATFORM_EMAIL`, else every platform admin; needs SMTP) when the last good backup is more than 26 hours old, the last run failed, or the off-site copy failed, and when the disk is 80% full (from the nightly Docker cleanup). Each problem is emailed once a day while it lasts and is in the platform log.

```bash
cat backups/status/last-status.json        # the last run
docker compose logs --tail 50 backup       # what it said
docker compose exec backup sh /backup.sh once   # a backup now (exit code 0 = good)
```

## Off-site copy (your own MinIO)

Off until `OFFSITE_S3_ENDPOINT` is set. Then, after each good nightly backup, the dump is copied and the files are synced (only what changed) to an S3 store of your own, ideally on another machine. Encrypted before it leaves the server when `OFFSITE_ENCRYPTION_PASSWORD` is set (rclone crypt): the store sees only scrambled names and contents. **Keep that password somewhere other than this server**: without it the off-site copy cannot be read.

**On the other machine** (any with Docker; the port must be reachable from this server, best only from it, or through a VPN):

```bash
mkdir -p /srv/backup-minio/data
openssl rand -hex 24 > /srv/backup-minio/root-password      # the store's own admin password
openssl rand -hex 24                                         # note it: the server's secret key (below)
docker run -d --name backup-minio --restart unless-stopped --user 0:0 -p 9000:9000 \
  -v /srv/backup-minio/data:/data -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD="$(cat /srv/backup-minio/root-password)" \
  cgr.dev/chainguard/minio:latest server /data
# A bucket, and a key that can only use it (the same MinIO image as the app's; mc from Chainguard too):
cat > /srv/backup-minio/policy.json <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*"],"Resource":["arn:aws:s3:::kebo-backups","arn:aws:s3:::kebo-backups/*"]}]}
JSON
mc() { docker run --rm --network container:backup-minio -v /srv/backup-minio:/cfg -e MC_HOST_local="http://admin:$(cat /srv/backup-minio/root-password)@localhost:9000" cgr.dev/chainguard/minio-client:latest "$@"; }
mc mb local/kebo-backups
mc admin policy create local kebo-backups /cfg/policy.json
mc admin user add local kebo-desk <the secret key you noted>
mc admin policy attach local kebo-backups --user kebo-desk
```

Put it behind HTTPS (e.g. Caddy) when it is reached over the internet.

**On this server**, in `/opt/kebo-desk/.env`:

```bash
OFFSITE_S3_ENDPOINT=https://backup.example.com      # or http://10.0.0.5:9000 on a private network
OFFSITE_S3_BUCKET=kebo-backups
OFFSITE_S3_ACCESS_KEY=kebo-desk
OFFSITE_S3_SECRET_KEY=<the secret above>
OFFSITE_ENCRYPTION_PASSWORD=<openssl rand -hex 32; also keep it in your password manager>
# optional: OFFSITE_S3_PREFIX=kebo-desk  OFFSITE_RETENTION_DAYS=30  OFFSITE_S3_REGION=us-east-1
```

Then `docker compose up -d backup` (it backs up at once) and check: `cat backups/status/last-status.json` says `"ok":true,"offsite":"ok"`, and `docker compose exec backup sh /backup.sh rclone lsf -R offsite:db` lists the dump.

## Before a restore

- **`kebo_app` first.** The database's company tables are granted to the role `kebo_app`. It belongs to the database server, not to the database, so a dump does not make it. On a new database server create it before restoring: `create role kebo_app nologin`, and give it to `kebo` (`grant kebo_app to kebo`). Without it the restore prints errors for every grant and the app cannot read company data.
- **Stop the app** while restoring: `docker compose stop web worker api`.
- **Time zone.** Every connection of the app runs in UTC, and so must the database's default. pg_dump does not keep that setting, so set it after every restore into a new database: `alter database kebo set timezone to 'UTC'`.
- **Dumps from before the time zone fix.** A dump made before the migration `20261110090100_utc_timestamps` holds times 8 hours early (the server ran on Asia/Shanghai). You can tell: a dump made after it has the row `utc_timestamps` in the table `database_markers` (from `20261113000000_database_markers`; dumps made between those two migrations have UTC times too but no row). Restore such an old dump **with the database's time zone set to the zone it was made in** (`alter database kebo set timezone to 'Asia/Shanghai'` before the restore) and let the normal migrations bring it up to date (start the API, or `docker compose run --rm --no-deps api sh -c "cd /app/packages/database && npx prisma migrate deploy"`): the fix moves the times while it is applied and then sets UTC itself. **Never run that migration's SQL by hand** or on a database that already had it: the times would move twice.

## Restore a nightly dump into a new server

1. Set up the code and `.env` as in `docs/switch-over.md` (same `POSTGRES_PASSWORD` is not needed, but the same `AUTH_SECRET` keeps two-step sign-in working). Copy the dump (`backups/db-<date>.sql.gz`, or from off-site, below) to `/opt/kebo-desk/backups/`.
2. Start only the database, make the role, set the time zone, restore:

   ```bash
   docker compose up -d db
   docker compose exec -T db psql -U kebo -d kebo -v ON_ERROR_STOP=1 \
     -c "create role kebo_app nologin" -c "grant kebo_app to kebo" -c "alter database kebo set timezone to 'UTC'"
   gunzip -c backups/db-<date>.sql.gz | docker compose exec -T db psql -q -U kebo -d kebo -v ON_ERROR_STOP=1
   ```

   (A dump from before the time zone fix: see above.) The nightly dumps start by dropping what they create (`--clean --if-exists`), so on an empty database they print nothing; any error stops the restore (`ON_ERROR_STOP`).

3. Restore the files (below), then start everything: `docker compose up -d`. The API applies any migrations newer than the dump.
4. Check (below).

## Go back to a pre-deploy copy (same server)

The copy is from just before a deploy's migrations, so it matches the code that ran before that deploy. Put that code back first, then the database, in place:

```bash
docker compose stop web worker api
git checkout <the commit that ran before>    # ~/kebo-deploys.log; the copy is named after the deploy that made it
docker compose exec -T db psql -U kebo -d kebo -v ON_ERROR_STOP=1 -c "drop schema public cascade" -c "create schema public"
gunzip -c backups/pre-deploy-<…>.sql.gz | docker compose exec -T db psql -q -U kebo -d kebo -v ON_ERROR_STOP=1
docker compose exec -T db psql -U kebo -d kebo -c "alter database kebo set timezone to 'UTC'"
docker compose up -d --build
```

Easier with the deploy, which goes back to an older commit of main on purpose: Actions › Deploy › Run workflow, with that commit (or on the server: `bash deploy/ci-deploy.sh <commit>`). That deploys the code; it does not undo the database, so restore the copy as above first if a migration changed data.

A deploy whose migrations failed prints the same steps with the right copy's name. The old version keeps running meanwhile (it starts with a warning about the failed migration).

Only for a copy made before the time zone fix (before the `20261110090100_utc_timestamps` deploy): `alter database kebo reset timezone` instead of setting UTC, so the old code gets the database's old time zone back.

## Restore the files

**From the local copy** (`backups/files-<date>.tar.gz`: MinIO's whole volume, files and their details):

```bash
docker compose stop minio
docker run --rm -v kebo-desk_files:/data -v "$PWD/backups:/backups:ro" alpine \
  sh -c "rm -rf /data/* /data/.minio.sys && tar -xzf /backups/files-<date>.tar.gz -C /data --strip-components 1"
docker compose start minio
```

(`kebo-desk_files` is the volume's name with the default `COMPOSE_PROJECT_NAME`; `docker volume ls` shows it.)

**From the off-site copy** (the files as they are in the app's bucket). With MinIO running and empty (a new server) or as it is (missing files come back, others are left alone):

```bash
docker compose up -d minio backup
docker compose exec backup sh /backup.sh rclone copy offsite:files minio:kebo-files --progress
```

A file deleted in the app in the last `OFFSITE_RETENTION_DAYS` days is under `offsite:files-changed/<date>/` (list: `docker compose exec backup sh /backup.sh rclone lsf -R offsite:files-changed`).

**A database dump from off-site:**

```bash
docker compose exec backup sh /backup.sh rclone lsf offsite:db
docker compose exec backup sh /backup.sh rclone copy offsite:db/db-<date>.sql.gz /backups/
```

Without this server (it is gone), on any machine with Docker and a copy of the code: put the `OFFSITE_*` lines in a file `offsite.env`, then

```bash
docker build -t kebo-desk-backup -f docker/backup.Dockerfile docker
docker run --rm -v "$PWD/restore:/out" --env-file offsite.env kebo-desk-backup sh /backup.sh rclone copy offsite: /out
```

(Or any rclone: an `s3` remote, and a `crypt` remote over `<bucket>/<prefix>` with the password `OFFSITE_ENCRYPTION_PASSWORD` and no salt.)

## Check

```bash
docker compose exec -T db psql -U kebo -d kebo -c "show timezone" -c "select key from database_markers" -c "select count(*) from inquiries"
docker compose run --rm --no-deps api sh -c "cd /app/packages/database && npx prisma migrate status"    # "Database schema is up to date!"
docker compose ps                                  # all healthy
```

Then sign in, open a few inquiries and orders, and download a file and a PDF.
