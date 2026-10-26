# Revamp plan

Move from the single Next.js + Drizzle app to a pnpm/Turborepo monorepo with a NestJS API, Prisma, and shared packages, built around the new domain model (deal stages, quotation revisions, orders with a guided checklist, two-way payments).

Production keeps running `main` until the switch. Each step ends with tests passing in CI.

| Step | Scope | Status |
|---|---|---|
| 1 | Monorepo; `config`, `utils`, `money`, `shared`, `ui` packages; Prisma schema and migrations; NestJS skeleton with auth, settings, orders checklist and "my to-do" | Done |
| 2 | API: users (incl. two-step sign-in), customers + contacts, factories, inquiries (stages, hold, assign, notes, files), website form intake | Next |
| 3 | API: factory quotes and costing, quotations with revisions and PDFs, acceptance → order (lines + checklist), factory orders | |
| 4 | API: payments in/out, proforma and commercial invoices, shipments and packing lists, reports, reminders and notifications (worker) | |
| 5 | `apps/web`: Next.js UI on `@kebo/ui`, calling the API | |
| 6 | Legacy data import script (stages mapped, superseded revisions, orders created for accepted quotations); mobile app moved to the new API | |
| 7 | Switch-over: deploy, import, retire `legacy/` | |

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
