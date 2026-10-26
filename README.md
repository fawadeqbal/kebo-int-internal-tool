# Kebo deal tracker

Internal tool for **Shandong Kebo International Trade Co., Ltd.** to run every RFQ from first message to closed order: sourcing from factories, quotations with revisions, the order checklist (deposit, factory order, production, inspection, balance, shipping, documents), and money in and out.

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
  shared/     the domain: statuses, labels, permissions, workflows, the order checklist and next-step engine, input schemas
  ui/         design system for the web app (tokens, components, status badges)
  utils/      dates, errors, ids, document numbers, amounts in words
```

Dependencies only point downwards: `utils` and `money` know nothing about the business; `shared` holds the business rules as pure functions; `database` stores them; `api` enforces them; `ui`/`web` show them.

## How a deal flows

1. **Inquiry** (`RFQ-2026-0001`) — stage **New → Sourcing → Quoted → Won / Lost**. Moves happen by themselves (assigning someone, adding a factory price, sending or accepting the quotation); people only *mark as lost* (with a reason) or *put on hold*.
2. **Factory prices** — one or more factory quotes per deal, in their currency, with VAT and export rebate, giving our landed cost.
3. **Quotation** (`QUO-2026-0007`) — revisions R1, R2…; a revision is frozen once sent, sending a newer one marks the older *superseded*, acceptance is final.
4. **Order** (`SO-2026-0001`) — created on acceptance with a 12-step checklist ordered by the payment terms. The API always answers *what is next, who, by when*, and enforces the gates: no factory payment before the customer's deposit, no shipping before inspection (and the balance, when it is due before shipment), no original documents before the balance. A manager can override with a written reason.

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

The API tests run against a real database: migrate and seed with `--demo` first (CI does this).
