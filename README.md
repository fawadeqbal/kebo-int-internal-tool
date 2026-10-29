# RFQ Desk

Made for **Shandong Kebo International Trade Co., Ltd.**, now for any trading company: run every RFQ from first message to closed order: sourcing from factories, quotations with revisions, and orders in four simple stages (Confirmed → In production → Shipped → Done) with the money received and the documents (proforma, invoice, packing list) as PDFs.

> **Status:** the rebuild is complete on `main`. The live server still runs the previous app until the switch-over in [docs/switch-over.md](docs/switch-over.md); the previous app's code is in the git history (before this cleanup), not in the tree.

## Layout

```
apps/
  api/        NestJS REST API — every business rule runs here (web and mobile are clients)
  mobile/     Flutter app
packages/
  config/     tsconfig and ESLint presets, typed environment loader
  database/   Prisma schema, migrations, client, seed, and the import of the previous app's data
  money/      all money maths in integer minor units: totals, VAT, FX, margins, deposits, profit
  shared/     the domain: statuses, labels, permissions, workflows (inquiry stages, quotation revisions, order stages), input schemas
  ui/         design system for the web app (tokens, components, status badges)
  utils/      dates, errors, ids, document numbers, amounts in words
```

Dependencies only point downwards: `utils` and `money` know nothing about the business; `shared` holds the business rules as pure functions; `database` stores them; `api` enforces them; `ui`/`web` show them.

## Companies

Many companies run in one installation, each in its own space: one database, every row tagged with its company, and the database itself (row-level security) refusing anything of another company. A platform admin runs the companies at `/platform`: client inquiries, demos, plans, payments. Kebo is the first company. How it works, the automatic rules for demos and payments, and how to run it: [docs/companies.md](docs/companies.md).

## How an inquiry flows

1. **Inquiry** (`RFQ-2026-0001`) — stage **New → Sourcing → Quoted → Won / Lost**. Moves happen by themselves (assigning someone, adding a factory price, sending or accepting the quotation); people only *mark as lost* (with a reason) or *put on hold*.
2. **Factory prices** — one or more factory quotes per inquiry, in their currency, with VAT and export rebate, giving our landed cost.
3. **Quotation** (`QUO-2026-0007`) — revisions R1, R2…; a revision is frozen once sent, sending a newer one marks the older *superseded*, acceptance is final.
4. **Order** (`SO-2026-0001`) — created on acceptance, then **Confirmed → In production → Shipped → Done**, one button at a time (or one stage back). Nothing blocks: a move with something off (no deposit yet, money still due) asks the person to confirm, and every move is kept in the order's history. Each goods line shows how many came in from the factory (and which factory), and the packing list (packages, weights, CBM, container, marks) is filled in before shipping. Payments from the customer give *received* and *still due*. The proforma invoice (`PI-…`, the one invoice sent to the customer) and the packing list (`PL-…`) are made from the order whenever they are opened, to print or download as PDF, each with a customer copy (one total) and an internal copy (every price, cost and payment). PDF downloads use Google Chrome, Microsoft Edge or Chromium, found on the computer by itself (or `CHROME_PATH`). Reminders nudge when an order waits too long for its deposit, the goods are past the factory's ready date, or the balance is still due after shipping.

## Develop

Needs Node 22+, Docker (for PostgreSQL) and Git. First time:

```bash
corepack enable                                   # pnpm, pinned in package.json (or: npm i -g pnpm@10.18.0)
pnpm install
docker compose -f docker-compose.dev.yml up -d    # PostgreSQL on localhost:5433
cp .env.example .env                              # one .env at the root; the API and database scripts read it
pnpm build                                        # builds the packages (and generates the Prisma client)
pnpm db:deploy && pnpm db:seed --demo             # schema + sample inquiries
pnpm dev                                          # API http://localhost:4000/api (docs /api/docs) + web http://localhost:3000
```

Sign in at http://localhost:3000 with admin@example.com / Admin@12345, manager@example.com / Manager@12345, staff@example.com / Staff@12345, or the demo staff bilal@example.com / sana@example.com (Demo@12345).
The platform area (`http://localhost:3000/platform`): make yourself a platform admin with `cd apps/api && pnpm build && node dist/cli/platform-admin.js add you@example.com "Your Name"` and open the link it prints. Request a demo as a visitor at `/request-a-demo`.
Next time: start Docker's database (`docker compose -f docker-compose.dev.yml up -d`) and run `pnpm dev`. After changing code in `packages/`, run `pnpm build` (the API and web pick it up).

| Command | |
|---|---|
| `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm test` | Every package and app, through Turborepo (also run in CI) |
| `pnpm db:migrate` | Create a migration after changing `packages/database/prisma/schema.prisma` |
| `pnpm db:deploy` | Apply migrations |
| `pnpm db:check-migrations [base]` | The migration rules below, against `origin/main` (or `base`); CI runs it |
| `pnpm db:seed [--demo]` | Starting accounts and settings (`--demo` adds sample inquiries; refused on a non-local database) |
| `pnpm db:reset` | Empty the local database, apply all migrations and seed it again with the demo data |
| `pnpm db:load-data [-- --years N --deals N --people N]` | A year (or N years) of realistic history on top of the seed, to see Insights, Home and the money pages with a working company's data: about 1,200 inquiries a year, growing month by month, targets, accounts. Adds, never deletes; local databases only. Sales people sign in as sales1@example.com… with Demo@12345 |

The API tests run against a real database: migrate and seed with `--demo` first (CI does this).

### Migrations

Production applies them to real data, in name order. So:

- **Name**: Prisma's, `YYYYMMDDHHMMSS_what_it_does` (UTC timestamp, lowercase words), as `pnpm db:migrate` makes it.
- **Order**: a new migration sorts **after every migration already on `main`**. A branch that has been open a while may need its migration renamed to a later timestamp before it is merged (CI fails otherwise: a database that has the later ones would get the new one after them, a fresh one before).
- **Never edit, rename or remove** a migration that is on `main`: production has applied it. Fix it with a new one.
- **Safe on data**: fill new columns before making them required, never drop data that is still needed. CI's `upgrade` job migrates and seeds with the base's code, then applies the change's migrations on that database and runs the API tests.

## Deploy

Merging into `main` deploys by itself: when the **CI** workflow passes for the new commit on `main`, the **Deploy** workflow (`.github/workflows/deploy.yml`) logs into the server over SSH and runs `deploy/ci-deploy.sh` for exactly that commit. It copies the database, builds the new images, applies the migrations with the new image while the site keeps running the old one, and only then replaces the containers and waits until they are healthy. Then the workflow checks the site answers.

| Fails at | Then |
|---|---|
| CI | nothing is deployed |
| the build | nothing changes |
| the migrations | the old version keeps running; the log says how to put the database back (`docs/restore.md`) |
| the new containers' health | the previous images (`:previous`) are started again; the workflow shows red |

- See every deploy on the Actions tab › Deploy. **Run workflow** (from `main`) deploys main's latest commit, or the commit given (to go back to an older one); only a commit of `main` whose CI passed.
- Secrets (Settings › Secrets and variables › Actions): `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (a key used only for this), `DEPLOY_KNOWN_HOSTS` (the server's host key line).
- On the server, that key may only run the deploy: its line in `~/.ssh/authorized_keys` has a forced command (see the top of `deploy/ci-deploy.sh`). A log of deploys is in `~/kebo-deploys.log`.
- Deploy by hand: `cd /opt/kebo-desk && bash deploy/ci-deploy.sh [commit]` (main's latest, or that commit of main).
- Backups: nightly, checked, and off-site to your own S3 store once set up; the worker emails the platform admins when one is late or failed. Restoring, and setting up the off-site copy: `docs/restore.md`.
- Disk: a nightly job on the server (`docker-cleanup.timer`, 03:30 GMT) keeps Docker's build cache to the most recent 20 GB and removes images no container uses after 7 days; volumes are never touched. It logs what it freed (`journalctl -u docker-cleanup`) and, at 80% full, warns (syslog, and an email to the platform admins through the worker). RFQ Desk's `:previous` images are kept. Files and setup: `deploy/server/` (run `install.sh` again after a change).
