# Switching from the old app to the new stack

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

Sign in with your usual email and password (two-step codes keep working because AUTH_SECRET is the same). Check: dashboard, a won deal and its order checklist, a quotation PDF, a customer, the reports.

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
- **First morning**: the reminder worker runs within the hour and finds the real backlog on imported open orders (deposits not received, documents not released, factory VAT invoices). Each person gets one summary of their late steps, and managers one summary of steps more than the escalation days late (Settings → reminders), not one message per step. Ask each handler to open *Orders → Mine* in the first days and tick or skip (with a note) what already happened. Steps before shipping on orders that already shipped were skipped by the import, with a note saying so.
