# Revamp plan

Move from the single Next.js + Drizzle app to a pnpm/Turborepo monorepo with a NestJS API, Prisma, and shared packages, built around the new domain model (deal stages, quotation revisions, orders with a guided checklist, two-way payments).

Production keeps running `main` until the switch. Each step ends with tests passing in CI.

| Step | Scope | Status |
|---|---|---|
| 1 | Monorepo; `config`, `utils`, `money`, `shared`, `ui` packages; Prisma schema and migrations; NestJS skeleton with auth, settings, orders checklist and "my to-do" | Done |
| 2 | API: users (incl. two-step sign-in), customers + contacts, factories, inquiries (stages, hold, assign, notes, files), website form intake | Done |
| 3 | API: factory quotes and costing, quotations with revisions and PDFs, acceptance → order (lines + checklist), factory orders | Done |
| 4 | API: payments in/out, proforma and commercial invoices, shipments and packing lists, reports, reminders and notifications (worker) | Done |
| 5 | `apps/web`: Next.js UI on `@kebo/ui`, calling the API; print pages and PDF download | Done |
| 6 | Legacy data import script (stages mapped, superseded revisions, orders created for accepted quotations); mobile app moved to the new API | Done (the app needs a new release before the switch) |
| 7 | Switch-over: deploy, import, retire the old app — see [switch-over.md](switch-over.md) | Ready, to be run by the team (the old code is already out of the tree; it is in the git history) |

## Data import mapping (step 6)

| Old | New |
|---|---|
| query `pending` | inquiry `new` (`sourcing` if assigned) |
| query `processing` | `quoted` if a quotation was sent, else `sourcing` |
| query `completed` | `won` if a quotation was accepted, else `lost` (reason `other`, note kept) |
| query `not_completed` | `lost`, free-text reason kept as the note |
| quotations v1, v2… | one quotation with revisions; older sent versions → `superseded` |
| accepted quotation | order with lines; checklist steps marked done from what exists (invoice → proforma sent, payments → deposit/balance, packing list → shipped) |
| invoice payments | payments `in` against the order (deposit first, then balance) |
| customers | customer + one primary contact; country to be filled in (unknown → asked on first edit) |

### Running the import

`packages/database/scripts/import-legacy.ts` copies everything from the old database into a new, empty one in a single transaction (a failure or a totals mismatch writes nothing). The mapping rules are pure functions in `scripts/import-legacy/map.ts`, tested in `tests/import-map.test.ts`.

```bash
pnpm install && pnpm turbo run build --filter @kebo/database...
cd packages/database
export DATABASE_URL=postgres://…/kebo        # the NEW database
pnpm db:deploy                                # migrations only: do not run the seed first
pnpm db:import-legacy --from postgres://…/qms --dry-run   # full import, report, rolled back
pnpm db:import-legacy --from postgres://…/qms             # the real thing
```

- The old database is only read (one read-only snapshot). The import refuses to run if the new database already has inquiries, or users with the same emails.
- Old ids become the new ids, and old numbers (RFQ, QUO, INV, PL) are kept; the counters continue after the highest imported numbers. Orders are numbered SO-… in order of acceptance. Later quotation versions become R2, R3… of the first version's number (their old number is kept in the audit log).
- It also writes the five settings groups and the website-form system account, so the seed is not needed afterwards.
- The report lists counts per table, totals checks (invoices, payments, quotations, orders) and every judgement call. Afterwards: fill in each customer's country (imported as `ZZ`; the report suggests one from the phone number), and tick or skip the open orders' remaining checklist steps.
- Sessions, notifications and phone tokens are not copied: everyone signs in again. Uploaded files keep their storage keys, so the new app must use the same storage bucket.

