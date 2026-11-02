# Phase 1 — one page per step, checklist with tools

Spec: `docs/superpowers/specs/2026-11-02-order-flow-v3-design.md` (§1, §2). Design boards:
OrderV3Overview, OrderV3Production, OrderV3Payment, OrderV3Shipping, OrderV3Documents, OrderV3Phone,
OrderV3Item on canvas page 19. Branch `feat/order-steps`.

## A. Data (packages/database)

Migration `20261122000000_order_checklist`:
- `order_checklist_items`: `id uuid pk`, `company_id uuid not null default app_company()`, `order_id`
  (fk orders, cascade), `step text` (one of FLOW_STEPS), `key text null` (auto key, unique per order
  when not null), `title varchar(200)` (own items; null for auto overrides), `tool text not null
  default 'done'` (done | fill | upload | pay | make | send), `fields jsonb not null default '[]'`
  (fill tool: `[{key,label,type:text|date|number|file}]`), `data jsonb not null default '{}'`
  (collected values), `route text null` (only for this payment route), `due_on date null`,
  `assignee_id uuid null` (fk users), `done_at timestamptz null`, `done_by uuid null`, `skipped_at
  timestamptz null`, `skip_reason text null`, `note text null`, `attachment_id uuid null` (fk
  attachments), `sort_order int not null default 0`, `created_by uuid not null`, `created_at`,
  `updated_at`. Indexes: (order_id, step, sort_order), company_id, unique (order_id, key) where key is
  not null.
- `checklist_templates` (the company list): `id`, `company_id`, `step`, `title`, `tool`, `fields
  jsonb`, `route text null`, `due_days int null` (days after the order date), `sort_order`,
  `created_at`, `updated_at`. Plus `companies.checklist_hidden text[] not null default '{}'` (auto
  keys the company hides).
- `orders.checklist_seeded_at timestamptz null`.
- Copy every `production_steps` row into `order_checklist_items` (step 'production', tool 'done',
  title, due_on = planned_on, done_at = done_on, sort_order, created_by = the order's creator or the
  first company admin) and set those orders' `checklist_seeded_at`. Keep the `production_steps` table
  for now (drop in a later release) but stop reading/writing it.
- RLS for both tables exactly like `20261118000000_order_flow` (enable RLS, `company_isolation`
  policy, grants to kebo_app, `enforce_same_company` triggers for order_id, assignee_id, done_by,
  attachment_id, created_by). Update the "order flow tables are company tables" test list and
  `packages/database` migration-order test if needed. Prisma models + `pnpm build` of database.

## B. Shared (packages/shared)

`workflows/checklist.ts`:
- `CHECKLIST_TOOLS`, `ChecklistTool`, `TOOL_LABEL`.
- `AUTO_ITEMS: Record<FlowStep, AutoItemDef[]>` with `{ key, title, tool, needs?, route? }` and
  `autoChecklist(facts: ChecklistFacts, features): { step, key, title, done, doneAt?, data: [label,
  value][], needs?, tool }[]`. Keys (route-limited where noted): payment: `route`, `contract`
  (bank_contract/LC: bank contract status opened+), `deposit_in`; factory: `factory_ordered`,
  `factory_advance`; production: `ready_date`, `goods_received`, `factory_paid`; shipping:
  `packing_list`, `booked`, `loaded`, `sailed`, `arrived`, `balance_in` (informal); documents:
  `doc:<kind>` for `requiredDocuments(route, mode)` (bank_documents feature) and `bank:<step>` for
  `bankStepsFor(route)`; delivery: `delivered`, `sat_done`, `claims_closed`, `closed`.
  When a feature is off its items are not returned (shipping off → no booked/loaded/sailed/arrived;
  delivery_sat off → `closed` moves to shipping).
- `DEFAULT_CHECKLIST: { step, title, tool, fields?, route? }[]` (used when the company list is empty):
  production: Drawings approved by the customer (fill: approved by, file), Materials and parts in,
  Machining and assembly, Factory test run (FAT) with video (fill: date, result, video file),
  Pre-shipment inspection (fill: inspector, date, result; route LC and bank_contract); shipping:
  Shipping advice to the customer; payment: Sales contract signed by both (upload; bank routes).
- `stepState(items)` → done | now | late | todo; `stepProgress`; `doNow(steps)` = first open item of
  the current step.
- `STEP_OF_ACTION(action, newValues)` → FlowStep | null for history filtering (see D).
- zod: `checklistItemInput` (title, tool, fields, route, dueOn, assigneeId, note), `checklistTickInput`
  (data record, attachmentId?), `checklistSkipInput` (reason), `checklistTemplateInput`.
- Export everything from the package index. Add unit tests in `packages/shared` for autoChecklist,
  stepState and doNow.

## C. API (apps/api)

New module `checklist` (or inside `flow`):
- `GET /orders/:id/steps` → `{ steps: [{ key, label, state, done, total, line, next }], doNow,
  items: ChecklistItemView[] }` — merges auto items (computed from the same facts FlowService uses:
  move `factsOf` + payments/factory payments/shipments/documents/bank steps reads into a reusable
  `orderFacts(tx, orderId)`), stored overrides, own items; seeds own items from the company list (or
  DEFAULT_CHECKLIST) when `checklist_seeded_at` is null; hides route-limited items of other routes and
  `checklist_hidden` keys. Views carry who/when names, `late`, `canEdit`.
- `POST /orders/:id/checklist` (add own item), `PATCH /checklist/:id` (title, due, person, note,
  fields), `POST /checklist/:id/tick` (data, attachment), `POST /checklist/:id/untick`,
  `POST /checklist/:id/skip`, `DELETE /checklist/:id` (own only); for auto keys:
  `PUT /orders/:id/checklist/auto/:key` (due, person, note, skip/unskip) upserting the override row.
  Permission: `orders.update`; reads need order access like `GET /orders/:id`. Every change writes an
  AuditLog row on the order with action `checklist.add|edit|tick|untick|skip|delete` and
  `newValues.step`.
- Company list: `GET/PUT /settings/checklist` (`settings.manage`) — replace-all of template rows +
  hidden keys.
- FlowService `log()`: give each change its own action: `flow.route`, `flow.bank_contract`,
  `flow.factory_order`, `flow.shipment`, `flow.document`, `flow.bank_step`, `flow.delivery`,
  `flow.sat`, `flow.claim` (production timeline endpoints become checklist; keep `PUT
  /orders/:id/production` working by writing checklist rows, or remove it with its web caller).
- History: `GET /history?type=order&id=…&step=<step>` filters with `STEP_OF_ACTION` (payments,
  payment_plan → payment; factory payments, flow.factory_order → factory; goods_received,
  checklist with step production → production; packing_list, flow.shipment → shipping;
  flow.document, flow.bank_step → documents; flow.delivery/sat/claim → delivery; expense → its step
  or none; stage_change → none).
- Reminders (`reminders-list.service.ts flowItems`) and `/me/todo`: add late/due-soon checklist items
  of my orders.
- Tests (`apps/api/test/order-checklist.test.ts`): seeding from DEFAULT and from a company list;
  auto items tick from data (record deposit → deposit_in done); own item add/tick with data/untick/
  skip/delete; auto override due/skip; route-limited items; feature off hides items; RLS — another
  company can't read/write items (follow existing company-table tests); history step filter; every
  new read endpoint < 500 (`every-endpoint`).

## D. Web (apps/web)

- `orders/[id]/layout.tsx`: new header (← Orders, number, stage badge, customer · total · route ·
  person, View / Print + Download PDF unchanged) and `StepNav` (component `components/orders/
  step-nav.tsx`): Overview, the six steps with tick/number + `done/total`, Costs (phase 4 — leave out
  until then), History; horizontal scroll on md; on phones a "Step n of 6 ▾" disclosure listing the
  same links. Remove ProgressSteps strip and OrderTabs.
- Shared step page frame `components/orders/step-page.tsx`: StepHeader (badge, name, state, n of m,
  line, progress, actions), two-column grid (`lg:grid-cols-[minmax(0,1fr)_340px]`), PrevNext.
- Checklist UI `components/orders/checklist.tsx` (client): rows exactly like board OrderV3Item: box
  (square own / round auto), title, lock + "from the data", due, tool buttons, ⋯ menu (FloatingMenu),
  second line of `label value` pairs + who · when or "Needs: …"; the tool opens inline in the row
  (fill form from `fields`; upload uses the existing attachment upload; auto items embed the existing
  form for their data — e.g. PaymentForm, DateForm for ready date, ShipmentForm, DocumentForm,
  BankStepForm, DeliveryForm — via a `toolFor(key)` map rendered server-side and passed as slots);
  "Add an item to <step>…" input at the bottom; late rows red; now row highlighted. Server actions in
  `orders/checklist-actions.ts` (revalidate the order path).
- Step pages (move content from the old tabs, keep their forms/panels):
  - `/payment`: checklist + plan + payments received + route/bank contract (from money/page.tsx
    `#customer`); side: key facts (total, received, due, route, credit), Files, Changes.
  - `/factory`: checklist + FactoryOrderPanel + factories/what we owe (from money/page.tsx `#factory`)
  - `/production`: checklist (own items incl. ex production timeline) + goods received (existing
    GoodsReceipt for now; LineTable in phase 2); side: key facts (factory, their order no, ready,
    days left, ship by).
  - `/shipping`: checklist + ShipmentsPanel + packing list (existing PackingList); side key facts.
  - `/documents`: checklist (doc:* and bank:* items) + PaperSetPanel/BankChainPanel + made-from-the-
    order list + deal files (existing documents page content).
  - `/delivery`: checklist + DeliveryPanel + SatPanel + ClaimsPanel.
  - `/history`: unchanged plus a step filter (seg control).
  - Redirect pages: `/money`, `/goods`, `/packing` → new paths (keep `#costs` content reachable on
    `/payment` until phase 4 adds `/costs`).
- Overview `page.tsx`: Do this now bar, six step cards (link to step page), Money, Key dates, Recent
  changes (history limit 3), then Notes + DetailsForm. Remove OrderProgressCard/StageActions usage
  (keep files if used elsewhere; delete when unused).
- Settings: a "Order checklist" section on the orders/sales settings tab: per step (seg control) the
  company items with tool, route, due days, reorder, rename, remove, add; auto items listed with a
  Hide toggle. Uses `settings.manage`.
- Orders board/list: card shows its current step + do-now item (if cheap from list data; otherwise
  leave as is).
- Mobile: verify 390px widths for step pages, checklist rows (tools wrap under the row), step picker.

## E. Done when
`pnpm -w turbo typecheck lint test` green locally (DB via docker compose), API tests added pass,
manual click-through on the dev server (admin@example.com / Admin@12345) of every step page on
desktop and 390px, PR opened against main with screenshots list in the body.
