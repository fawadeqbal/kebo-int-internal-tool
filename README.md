# QMS — Query & Order Management System

Internal web app for **Shandong Kebo International Trade Co., Ltd.** (keboint.com) to receive customer queries — from the website RFQ form, WhatsApp, email or phone — track who is working on them and how long they take, send quotations, and generate invoices. Admins are emailed about everything important.

Built with **Next.js 16 (App Router) · TypeScript · PostgreSQL · Drizzle ORM · Tailwind CSS**, and deployed with **Docker Compose on your own server**.

---

## What it does

| Area | Features |
|---|---|
| **Website inquiries** | The keboint.com RFQ form sends straight into the system: customer added or matched by email/phone, Pending query created, admins emailed. Spam protection built in. See `docs/website-form.md` |
| **Admin emails** | One list of admin emails (Settings) · tick what to be told about: new query, quotation accepted/rejected, query closed, payment, and a morning summary · "Send a test email" button |
| **Customers** | Name, company (optional), phone / WhatsApp, email · search · duplicate warning (same phone/email) · full history and account balance per customer |
| **Queries / orders** | Only three things needed: customer, category, requirements · everything else optional · auto reference (`RFQ-2026-0001`) · the same 10 categories as the website · new customer can be added inside the query form · file attachments (drag & drop, with progress) |
| **Workflow** | Pending → Processing → Completed / Not Completed (reason required) · reopen (managers) · assignment with history · internal notes · activity timeline · turnaround time |
| **Quotations** | Line items, discount, tax %, auto totals · due/valid-until and submission dates · Draft → Sent → Accepted / Rejected / Expired · new versions (v1, v2…) without changing what the customer saw · **Download PDF** (A4, page numbers) · print |
| **Invoices** | Generated from an accepted quotation (values copied, editable before issuing) · sequential numbers (`INV-2026-0001`) never reused · locked once issued · payments (partial or full) · Overdue shown automatically · cancel with reason · **Download PDF** · print |
| **Dashboard** | Pending / Processing / On hold / Overdue / Completed / Unassigned · money this month · queries per month chart · pipeline · my open work · needs attention · quotations awaiting reply · unpaid invoices · team workload |
| **Reports** | Any date range and staff member · conversion · money · source and category breakdown · staff performance · CSV export · print to PDF |
| **Reminders** | Background worker checks every hour: pending too long, processing too long, due soon / overdue, quotations expiring (auto-expired after due date), invoices due / overdue · in-app notifications · daily summary email to admins |
| **Admin** | Users and roles · company profile, tax, defaults and reminder rules · full audit log (who changed what, old → new values) |

### Roles

| Role | Can |
|---|---|
| Super Admin | Everything, including users and settings |
| Manager | All queries, assign work, reopen, quotations, invoices, payments, reports, audit log |
| Staff | Create queries and customers, work on queries assigned to them, draft and send quotations |

**File storage:** uploads go to MinIO by default (`STORAGE_DRIVER=s3`). The same settings work for AWS S3, Cloudflare R2 or any S3-compatible store: change `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY`. Files are never public; every download goes through the app's permission check.

Website inquiries are recorded under a built-in, sign-in-disabled "Website form" account.

Permissions live in one file: `src/lib/auth/permissions.ts`.

---

## Run it on your server (Docker)

Requirements: a Linux server with Docker and Docker Compose.

```bash
cp .env.example .env
# Edit .env — at minimum set:
#   POSTGRES_PASSWORD   (a strong password)
#   MINIO_ROOT_PASSWORD (another strong password, for file storage)
#   AUTH_SECRET         (openssl rand -base64 48)
#   DOMAIN              (e.g. qms.yourcompany.com — Caddy gets an HTTPS certificate automatically)
#   APP_URL             (e.g. https://qms.yourcompany.com)
#   SEED_ADMIN_* / SEED_MANAGER_* / SEED_STAFF_*   (email + password of the 3 starting accounts)
#   NOTIFY_EMAILS       (admin emails to notify — can be changed later in Settings)
#   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD   (outgoing email, e.g. Gmail with an App password)

docker compose up -d --build

# Create the starting accounts: Super Admin, Manager, Staff (run once)
docker compose run --rm app node dist/scripts/seed.js

# Optional: add demo data for a client demo / training
docker compose run --rm app node dist/scripts/seed.js --demo
```

Open `https://<DOMAIN>` and sign in with the admin account. Then:

1. **Settings → Email notifications:** check the admin emails and press **Send a test email**.
2. **Settings → Website form:** give the script there to the website designer (details in `docs/website-form.md`).

**LAN-only (no domain):** set `DOMAIN=:80` and `COOKIE_SECURE=false`, then open `http://<server-ip>`.

### Containers

| Container | Purpose |
|---|---|
| `proxy` | Caddy — HTTPS, compression, 30 MB upload limit |
| `app` | Next.js app; runs database migrations on every start |
| `worker` | Reminder job (every `REMINDER_INTERVAL_MINUTES`, default 60) |
| `db` | PostgreSQL 16 (volume `pgdata`) |
| `minio` | S3-compatible file storage for drawings, spec sheets and photos (volume `files`, private bucket `kebo-files`). Uses Chainguard's free MinIO image, because MinIO stopped publishing its community image in Oct 2025 |
| `backup` | Nightly database dump + the file store into `./backups`, kept `BACKUP_RETENTION_DAYS` (default 14) |

**Restore a backup**

```bash
gunzip -c backups/db-YYYY-MM-DD_HHMM.sql.gz | docker compose exec -T db psql -U qms -d qms
docker compose stop minio
docker run --rm -v qms_files:/data/files -v "$PWD/backups:/backups" alpine sh -c "rm -rf /data/files/* && tar -xzf /backups/files-YYYY-MM-DD_HHMM.tar.gz -C /data"
docker compose start minio
```

**Update to a new version:** `git pull && docker compose up -d --build` (migrations run automatically).

---

## Develop locally

```bash
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL on localhost:5433, MinIO on localhost:9000
cp .env.example .env                              # DATABASE_URL=postgres://qms:qms@localhost:5433/qms
npm install
npm run db:migrate
npm run db:seed -- --demo                         # or later: npm run db:reset -- --demo  (wipe and start again)
npm run dev                                       # http://localhost:3000
npm run worker                                    # reminder job (optional)
```

**PDF downloads** are printed by headless Chrome (`puppeteer-core`) from the same print page you see on screen, so the file matches it exactly. Locally an installed Chrome or Edge is used automatically; the Docker image ships Chromium. Set `CHROME_PATH` only if your browser is in an unusual place.

### Roles and starting accounts

| Role | For | Can use | Login (defaults, set in `.env`) |
|---|---|---|---|
| **Super Admin** | The developer | Everything: all work and sales, users, settings, audit log | `admin@example.com` / `Admin@12345` |
| **Manager** | Kebo's manager | All inquiries, assigning work, quotations, invoices, payments, reports, exports, audit log | `manager@example.com` / `Manager@12345` |
| **Staff** | Sales and sourcing team | Their own inquiries (assigned to or created by them), customers, quotations | `staff@example.com` / `Staff@12345` |

`npm run db:reset` wipes the local database and seeds just these three accounts; `npm run db:reset -- --demo` adds sample customers, inquiries, quotations and invoices (and demo people `ayesha@` manager, `bilal@` / `sana@` / `usman@` staff, password `Demo@12345`). It only runs against a database on your own computer.

| Command | |
|---|---|
| `npm run lint` · `npm run typecheck` · `npm test` | Quality checks (also run in CI) |
| `npm run db:reset` | Wipe the local database and seed again (`-- --demo` for sample data) |
| `npm run db:generate` | Create a migration after changing `src/lib/db/schema.ts` |
| `npm run build` | Production build (app + worker + scripts) |

---

## Architecture

A **modular monolith**: one deployable app, split into feature modules with clear layers.

```
src/
  app/                  Routes only — pages read data and render; no business rules
    (app)/…             Signed-in screens (dashboard, queries, customers, …)
    print/…             Printable quotation & invoice
    api/…               File upload/download, CSV export, customer search
  modules/<feature>/
    schema.ts           Input validation (Zod) — shared by forms and server
    repository.ts       Database queries (the only place that reads tables)
    service.ts          Business rules, permissions, transactions, audit
    actions.ts          Server actions: auth → validate → service → revalidate
    workflow.ts         Status lifecycles (single source of truth)
    components.tsx      Feature UI
  modules/events.ts     Domain events → notifications (add email/WhatsApp here)
  lib/
    db/                 Drizzle schema + connection pool
    auth/               Sessions (signed cookie), passwords, RBAC
    storage/            StorageProvider interface: S3/MinIO (default) or local disk
    email/              Mailer interface (console or SMTP)
    utils/money.ts      All money maths in integer paisa — no rounding errors
worker/                 Reminder worker entry point
scripts/                migrate.ts, seed.ts
drizzle/                SQL migrations
tests/                  Unit tests for money, workflows and validation
```

**Principles applied:** separation of concerns (route → action → service → repository), single source of truth for statuses and totals, interfaces for storage/email/events (open for extension), database transactions for multi-step changes, row locking for payments, gap-free reference numbers, soft delete for business records, audit trail on every change, server-side permission checks on every action and API route, strict TypeScript.

**Usability (HCI):** colour-coded status badges that always include text, plain business words, confirmation before destructive actions, inline validation with friendly messages, values kept after an error, live totals while typing prices, search-as-you-type customer picker, quick views and bookmarkable filters, keyboard shortcuts (`n` new query, `/` search, `Ctrl+Enter` post note), empty states that say what to do next, upload progress, responsive layout for phone and tablet, accessible labels and focus states.

---

## Where this differs from the scope document (v0.1)

These were simplified to keep the first version small and easy to run; each sits behind an interface so it can be swapped later without touching business code.

| Scope said | Built | Why / how to change |
|---|---|---|
| Server-side PDF engine | Print-ready pages; "Print / Save as PDF" in the browser | No headless browser in the image; output is A4 and clean |
| BullMQ + Redis worker | A simple scheduled worker (no Redis needed) | Enough for reminders; add a queue if heavier jobs come |
| Prisma or Drizzle | Drizzle | Lighter, SQL-like, no engine binaries |
| Auth.js | Signed session cookie (`jose`) + bcrypt, checked against the DB every request | Fewer moving parts for a credentials-only internal app |
