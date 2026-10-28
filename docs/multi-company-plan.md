# Multi-company product plan

Status: **planned, not started** (written 28 Oct 2026).
Goal: sell Kebo RFQ Desk to other trading companies. Each company works in its own space with its own data; a platform admin (Fawad) runs the companies.

## Decisions (28 Oct 2026)

| Topic | Decision |
|---|---|
| Isolation | **Own database section per company**: one Postgres schema per company. A forgotten filter can never show another company's data, and one company can be backed up, exported or deleted on its own. |
| How people reach their company | **Own subdomain per company**, e.g. `kebo.rfq.fawadiqbal.dev`, `acme.rfq.fawadiqbal.dev`. |
| Who creates companies | **All three ways:** the platform admin creates them; the platform admin can also make a **demo account for 2–3 days** for someone who wants to try it; and a **public self sign-up with a trial**. |
| Plans | **Plans with limits** (users, storage and similar), with a warning near the limit. No online payment yet. |

## Roles

- **Platform admin** (new, top level): companies, plans, demos, trials, usage. Works in its own area (`admin.rfq.fawadiqbal.dev`). Does **not** see a company's inquiries by default; opening a company's workspace for support is an explicit action, logged in the company's audit log.
- **Company admin**: today's "Super Admin" becomes the admin of their own company only: roles, users, settings, money, security for that company.
- **Managers and staff**: as today, inside one company.

## Architecture

### Database
- **Platform schema** (`platform`): companies, plans, platform admins, subdomains, demo and trial dates, usage counters, sign-up requests, platform audit log.
- **One schema per company** (`co_<slug>`): today's 36 tables, unchanged in shape: users, roles, sessions, settings, counters, customers, factories, inquiries, quotations, orders, payments, expenses, accounts, targets, notifications, audit log…
- Per request, the API picks the company from the subdomain and uses a database connection whose `search_path` is that company's schema. The 34 raw SQL queries keep working unchanged.
- One Prisma client per active company, created on first use and closed when idle (limit how many are open at once).
- **Migrations** run for the platform schema, then for every company schema, on each deploy. A company that fails to migrate is switched to read-only and reported; the others carry on.
- New companies are created by running the migrations into a fresh schema, then seeding roles and settings.

### Requests and sign-in
- Caddy: wildcard `*.rfq.fawadiqbal.dev` with a DNS-challenge certificate (Caddy needs the DNS provider's module) and wildcard DNS.
- Web and API read the host: `admin.` → platform area; `<slug>.` → that company; unknown or switched-off → a clear page.
- Sessions belong to one company; a cookie for `kebo.` does not work on `acme.`. Emails are unique within a company (the same person may be in two companies with two accounts).
- Sign-in page shows the company's name and logo.

### Per-company things that are global today
- Settings (company details, stamp, currencies and rates, terms, reminders, email recipients).
- Numbering (RFQ / QUO / SO / proforma counters): each company starts at 1.
- Files: storage keys prefixed `companies/<id>/…`; one company's files can be listed, exported or deleted together.
- Emails: sender name per company (one sending account for the platform at first).
- Background worker: runs reminders and the daily and monthly emails for each active company in turn.
- `ReadCache` keys include the company; a change in one company clears only that company.

## Ways a company starts

1. **Created by the platform admin**: name, subdomain, plan, first admin's email. The admin gets an email to set a password.
2. **Demo (2–3 days)**: the platform admin clicks "Demo for…", picks how long, and gets a link and login. The demo is filled with sample data (the current demo seed) and shows a "Demo, ends on…" banner. When it ends it becomes read-only, then is deleted after N days unless turned into a real company.
3. **Self sign-up with a trial**: public page with company name, subdomain, name, email and password. Email verification, rate limits and a bot check. Trial of N days (e.g. 14), starting empty or with sample data (their choice). At the end it becomes read-only until a plan is set. The platform admin is told about every sign-up.

## Plans and limits
- Plan fields: name, max users, max storage (GB), max active inquiries per month (optional), trial days, features on/off (e.g. Insights, multi-currency).
- Each company's usage is counted (users, files, inquiries this month) and shown to its admin (Settings → Plan) and to the platform admin.
- Near a limit: warning banner. At the limit: new users and uploads are refused with a clear message; nothing is deleted.
- No online payment yet; the platform admin changes plans by hand. Payment (e.g. Stripe or a local gateway) comes later.

## Platform admin area
- Companies: list with status (active, trial, demo, read-only, switched off), plan, users, storage, last activity.
- Create company, demo, extend trial, change plan, switch off or on, export a company (database dump + files), delete (after export, with a confirmation).
- Open a company's workspace for support (logged).
- Plans: create and edit.
- Sign-ups waiting, and recent activity.

## Moving Kebo
- Kebo becomes the first company (`co_kebo`, `kebo.rfq.fawadiqbal.dev`). Today's tables move into that schema and the Super Admin becomes Kebo's company admin.
- `rfq.fawadiqbal.dev` redirects to `kebo.rfq.fawadiqbal.dev`, so existing bookmarks keep working.
- **Fix the time zone at the same time:** the live database runs on Asia/Shanghai and Prisma stores timestamps shifted by 8 h. During the move, set every connection to UTC and correct stored timestamps once, so each company's data is clean from the start. The company's own time zone stays in its settings.
- Full backup before, a dry run on a copy, and a tested way back.

## Isolation checks (required before going live)
- Automatic tests create two companies and, signed in to A, try **every** API endpoint and page with B's ids. All must be refused or not found.
- Files: A cannot open B's files by key.
- Background jobs and emails never mix companies.
- Platform admin endpoints refuse company users, and company endpoints refuse a platform session unless support access was opened.

## Phases (rough order)
1. Platform schema, company routing by subdomain, per-company connections and migrations. Kebo moved as the first company; time-zone fix. Isolation tests.
2. Platform admin area: companies, create, switch off, export; support access.
3. Plans and limits with usage counters.
4. Demo accounts (2–3 days) with sample data and automatic ending.
5. Self sign-up with trial (verification, rate limits, bot check).
6. Later: online payment, per-company email senders, custom domains.

## Open questions for later
- Price of each plan, and what each plan includes.
- Trial length and whether a trial starts empty or with sample data.
- How long ended demos and switched-off companies are kept before deletion.
- Whether a company may use its own domain (e.g. `rfq.acme.com`).
- Where company backups go, and how often.
