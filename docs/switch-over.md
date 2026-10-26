# Switching from the old app to the new stack

## Fresh start (no old data) — the chosen way

The new app starts empty with its own accounts; the old app's data is not moved. Run on the server (`145.241.156.60`):

```bash
# 1. The code, next to the old app (do not touch /opt/kebo-rfq).
git clone https://github.com/fawadeqbal/kebo-int-internal-tool /opt/kebo-desk
cd /opt/kebo-desk && mkdir -p secrets backups
cp /opt/kebo-rfq/secrets/firebase.json secrets/ 2>/dev/null || true   # phone push, if it was set up
```

`/opt/kebo-desk/.env` (new secrets; copy only the SMTP lines from `/opt/kebo-rfq/.env`):

```bash
POSTGRES_PASSWORD=<openssl rand -hex 24>
MINIO_ROOT_PASSWORD=<openssl rand -hex 24>
AUTH_SECRET=<openssl rand -hex 32>
APP_URL=https://rfq.fawadiqbal.dev
SMTP_HOST=... SMTP_PORT=... SMTP_USER=... SMTP_PASSWORD=... SMTP_FROM=...
COMPOSE_FILE=docker-compose.yml:deploy/compose.shared-proxy.yml
```

```bash
# 2. Build and start everything (the API applies the migrations when it starts).
docker compose up -d --build
docker compose logs api | tail -5          # "API on http://localhost:4000/api"

# 3. The starting accounts — use your real emails and strong passwords.
docker compose exec \
  -e SEED_ADMIN_EMAIL=you@example.com     -e SEED_ADMIN_PASSWORD='…' \
  -e SEED_MANAGER_EMAIL=boss@example.com  -e SEED_MANAGER_PASSWORD='…' \
  -e SEED_STAFF_EMAIL=staff@example.com   -e SEED_STAFF_PASSWORD='…' \
  api sh -c "cd packages/database && npx tsx scripts/seed.ts"

# 4. Point rfq.fawadiqbal.dev at the new app: in /opt/global-proxy/Caddyfile replace the
#    old rfq.fawadiqbal.dev block with deploy/Caddyfile.site (__DOMAIN__ → rfq.fawadiqbal.dev), then
docker exec global-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec global-caddy caddy reload --config /etc/caddy/Caddyfile

# 5. Stop the old app (stopped, not removed).
docker compose -p kebo-rfq stop
```

Then open https://rfq.fawadiqbal.dev, sign in as the admin, and in **Settings → Company** check the details and upload the company stamp. Add the team in **Users**. Try one deal end to end and download its PDFs.

**Undo**: put the old `rfq.fawadiqbal.dev` block back in the Caddyfile, reload Caddy, `docker compose -p kebo-rfq start`.

**Updates later**: `cd /opt/kebo-desk && git pull && docker compose up -d --build` (migrations apply on start).

## Moving the old data instead (not used)

The steps below import the old app's data; kept for reference.

The new stack (`kebo-desk`) runs beside the old one (`kebo-rfq`) on the same server until you switch, so you can try it with a copy of the real data first. Nothing here changes the old app until step 6, and step 6 can be undone in a minute.

Server: `145.241.156.60`, shared Caddy `global-caddy` on network `global-proxy`. Old app: `/opt/kebo-rfq`, domain `rfq.fawadiqbal.dev`.

> **Do not `git pull` in `/opt/kebo-rfq`.** `main` no longer contains the old app, so pulling there would replace it. The old app keeps running from what is already on the server, and the undo in step 6 uses those same containers.

## 1. Put the code on the server

```bash
git clone https://github.com/fawadeqbal/kebo-int-internal-tool /opt/kebo-desk
cd /opt/kebo-desk && mkdir -p secrets backups
cp /opt/kebo-rfq/secrets/firebase.json secrets/ 2>/dev/null || true   # phone push, if set up
```

Create `/opt/kebo-desk/.env`:

```bash
POSTGRES_PASSWORD=<new: openssl rand -hex 24>
MINIO_ROOT_PASSWORD=<new: openssl rand -hex 24>
AUTH_SECRET=<COPY the old app's AUTH_SECRET from /opt/kebo-rfq/.env — two-step sign-in secrets are encrypted with it>
APP_URL=https://desk.fawadiqbal.dev          # a test address first; rfq.fawadiqbal.dev at the switch
SMTP_HOST=... SMTP_PORT=... SMTP_USER=... SMTP_PASSWORD=... SMTP_FROM=...   # copy from the old .env
COMPOSE_FILE=docker-compose.yml:deploy/compose.shared-proxy.yml
```

## 2. Start it (no seed — the import brings the people)

```bash
docker compose up -d --build db minio
docker compose up -d api          # applies the migrations on start
docker compose logs api | tail    # "API on http://localhost:4000/api"
```

## 3. Copy the files (drawings, photos) from the old store

```bash
docker compose stop minio && docker compose -p kebo-rfq stop minio
docker run --rm -v kebo-rfq_files:/from:ro -v kebo-desk_files:/to alpine sh -c "cp -a /from/. /to/"
docker compose -p kebo-rfq start minio && docker compose start minio
```

## 4. Import the data (a rehearsal first)

```bash
# A copy of the old database inside the new PostgreSQL, as "legacy".
docker compose exec -T db psql -U kebo -d kebo -c "create database legacy"
docker compose -p kebo-rfq exec -T db pg_dump -U qms --no-owner qms | docker compose exec -T db psql -q -U kebo -d legacy

# Dry run: everything is done and then rolled back; read the report.
docker compose exec api sh -c "cd packages/database && npx tsx scripts/import-legacy.ts --from postgres://kebo:\$POSTGRES_PASSWORD@db:5432/legacy --dry-run"
# The real import (one transaction; refuses if anything was imported before).
docker compose exec api sh -c "cd packages/database && npx tsx scripts/import-legacy.ts --from postgres://kebo:\$POSTGRES_PASSWORD@db:5432/legacy"
```

The report must say every totals check is OK (invoices, payments, quotations). It also lists the customers whose country is not known (`ZZ`) with a suggestion from their phone number — fix those in the new app (Customers → Edit).

## 5. Try it on the test address

```bash
docker compose up -d web worker
```

Add a site block for the test address to `/opt/global-proxy/Caddyfile` from `deploy/Caddyfile.site` (replace `__DOMAIN__` with `desk.fawadiqbal.dev`), `docker exec global-caddy caddy validate --config /etc/caddy/Caddyfile`, then `docker exec global-caddy caddy reload --config /etc/caddy/Caddyfile`.

Sign in with your usual email and password (two-step codes keep working because AUTH_SECRET is the same). Check: dashboard, a won deal and its order (stage, money, documents), a quotation PDF and an invoice PDF, a customer, the reports.

## 6. The switch (about 10 minutes)

1. Tell the team not to enter anything for 10 minutes. Stop the old app so nothing new is written: `docker compose -p kebo-rfq stop app worker`.
2. Re-import the latest data:
   ```bash
   docker compose stop web worker
   docker compose exec -T db psql -U kebo -d kebo -c "drop schema public cascade; create schema public"
   docker compose exec -T db psql -U kebo -d postgres -c "drop database legacy" -c "create database legacy"
   docker compose -p kebo-rfq start db && docker compose -p kebo-rfq exec -T db pg_dump -U qms --no-owner qms | docker compose exec -T db psql -q -U kebo -d legacy
   docker compose restart api   # migrations again on the empty schema
   docker compose exec api sh -c "cd packages/database && npx tsx scripts/import-legacy.ts --from postgres://kebo:\$POSTGRES_PASSWORD@db:5432/legacy"
   ```
   Copy the files again (step 3) if any were uploaded since.
3. Set `APP_URL=https://rfq.fawadiqbal.dev` in `.env`, `docker compose up -d`.
4. In `/opt/global-proxy/Caddyfile` replace the old `rfq.fawadiqbal.dev` block with `deploy/Caddyfile.site` (domain filled in), validate, reload. The website form keeps working: it posts to `/api/public/inquiries`, which is now the new API.

**Undo** (if anything is wrong): put the old site block back, reload Caddy, `docker compose -p kebo-rfq start app worker`. The old database was only read, so nothing is lost.

## 7. After the switch

- Keep the old stack stopped (not removed) for a few weeks; then `docker compose -p kebo-rfq down` (volumes stay until you remove them).
- **Mobile app**: the old app calls `/api/v1/...`, which the new API does not have. Ship the updated app before the switch, or tell the team to use the web app on phones until it is out.
- Backups: `/opt/kebo-desk/backups` (nightly database dump + files), same as before.
- **First morning**: the reminder worker runs within the hour and finds the real backlog on imported open orders (deposits not received, balances still due after shipping). Each person gets one summary of their orders that need them, and managers one summary of orders more than the escalation days late (Settings → reminders), not one message per order. Ask each handler to open *Orders → Mine* in the first days and move each order to the stage it is really at.
