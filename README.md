# Kebo deal tracker

Internal tool for **Shandong Kebo International Trade Co., Ltd.** to run every RFQ from first message to closed order: sourcing from factories, quotations with revisions, and orders in four simple stages (Confirmed → In production → Shipped → Done) with the money received and the documents (proforma, invoice, packing list) as PDFs.

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
  shared/     the domain: statuses, labels, permissions, workflows (deal stages, quotation revisions, order stages), input schemas
  ui/         design system for the web app (tokens, components, status badges)
  utils/      dates, errors, ids, document numbers, amounts in words
```

Dependencies only point downwards: `utils` and `money` know nothing about the business; `shared` holds the business rules as pure functions; `database` stores them; `api` enforces them; `ui`/`web` show them.

## How a deal flows

1. **Inquiry** (`RFQ-2026-0001`) — stage **New → Sourcing → Quoted → Won / Lost**. Moves happen by themselves (assigning someone, adding a factory price, sending or accepting the quotation); people only *mark as lost* (with a reason) or *put on hold*.
2. **Factory prices** — one or more factory quotes per deal, in their currency, with VAT and export rebate, giving our landed cost.
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
pnpm db:deploy && pnpm db:seed --demo             # schema + sample deals
pnpm dev                                          # API http://localhost:4000/api (docs /api/docs) + web http://localhost:3000
```

Sign in at http://localhost:3000 with admin@example.com / Admin@12345, manager@example.com / Manager@12345, staff@example.com / Staff@12345, or the demo staff bilal@example.com / sana@example.com (Demo@12345).
Next time: start Docker's database (`docker compose -f docker-compose.dev.yml up -d`) and run `pnpm dev`. After changing code in `packages/`, run `pnpm build` (the API and web pick it up).

| Command | |
|---|---|
| `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm test` | Every package and app, through Turborepo (also run in CI) |
| `pnpm db:migrate` | Create a migration after changing `packages/database/prisma/schema.prisma` |
| `pnpm db:deploy` | Apply migrations |
| `pnpm db:seed [--demo]` | Starting accounts and settings (`--demo` adds sample deals; refused on a non-local database) |
| `pnpm db:reset` | Empty the local database, apply all migrations and seed it again with the demo data |
| `pnpm db:load-data [-- --years N --deals N --people N]` | A year (or N years) of realistic history on top of the seed, to see Insights, Home and the money pages with a working company's data: about 1,200 deals a year, growing month by month, targets, accounts. Adds, never deletes; local databases only. Sales people sign in as sales1@example.com… with Demo@12345 |

The API tests run against a real database: migrate and seed with `--demo` first (CI does this).
