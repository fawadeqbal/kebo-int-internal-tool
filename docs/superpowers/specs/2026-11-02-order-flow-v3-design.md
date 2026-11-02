# Order flow v3 — design

Approved 2026-11-02 from the design canvas "RFQ Desk screens — order flow", pages 16–19
(https://claude.ai/artifact/9bXSortRgmEAtfG2WQSCuu). Page 19 ("Order v3: one page per step") is the
layout; page 17 (Money v2) and page 18 (Documents v2) are the money and paper rules it uses.

Standing rules for every part: element-level permissions (`can()` + `@RequirePermissions`), every new
table is a company table (`company_id default app_company()`, RLS `company_isolation`, grants to
`kebo_app`, `enforce_same_company` triggers), modules stay switchable from the platform admin
(`@RequireFeature`, `MODULE_PRESETS`), mobile works, the PDF View / Print and Download PDF buttons and
the LineTable stay as they are.

## 1. The order is six steps, one page each

Order navigation (replaces the step strip *and* the tabs):

`Overview · 1 Payment · 2 Factory order · 3 Production · 4 Shipping · 5 Documents & bank · 6 Delivery & SAT · Costs · History`

Each step shows a tick (done), its number (filled = current), and `done/total`. On phones the bar
becomes a "Step 3 of 6 ▾" picker. Routes: `/orders/[id]` (overview), `/payment`, `/factory`,
`/production`, `/shipping`, `/documents`, `/delivery`, `/costs`, `/history`. Old routes redirect:
`/money → /payment`, `/goods → /production`, `/packing → /shipping`.

Module switches: Payment, Factory order, Production, Shipping and Documents always exist (goods
received, packing and the papers are core). The parts behind a feature (production timeline items,
shipments, bank papers and bank chain, delivery & SAT, bank contracts) appear only when the company's
plan has the feature; Delivery & SAT disappears with `delivery_sat`.

### Every step page has the same layout
- **Header card:** number badge, name, state (Done / Now / Later / Late), "n of m done", one line on
  where it stands, progress bar, the step's main button.
- **Left:** the checklist (below), then the step's data (lines in the LineTable, editable facts).
- **Right:** Key facts (with Edit), Papers (phase 3), Costs in this step (phase 4), Files,
  Changes in this step (who changed what, when, old value).
- **Bottom:** ← previous step · next step →.

### Overview
"Do this now" bar (first open item of the current step; red when late) → six step cards (state,
progress, a line, 2 key numbers, the next item) → right column Money, Key dates, Recent changes.
Notes and the order details form stay at the bottom. The old stage checkpoints card goes away.

### Stages
The four stages (Confirmed → In production → Shipped → Done) are no longer pressed by people: they
follow the steps (factory ordered → In production, departed → Shipped, delivered + closed → Done). The
stage stays for reports, the board and filters. "Close the order" is the last item of Delivery & SAT
(or Shipping when Delivery is off).

## 2. The checklist

One list per order: `order_checklist_items`.
- **Auto items** (round box) tick themselves from the data, computed every read, never stored as done:
  route chosen, contract/LC opened, deposit in, factory ordered, advance paid to factory, ready date,
  goods received, factory paid in full, packing list, booked, loaded, sailed, arrived, balance in
  (informal), each required paper (`doc:<kind>`), each bank step (`bank:<step>`), delivered, SAT done,
  claims closed, order closed. A stored row with the same `key` holds only overrides: due date,
  person, skip + reason, note.
- **Own items** (square box) come from the company list (Settings › Orders › Order checklist), copied
  into the order the first time its checklist is read (`orders.checklist_seeded_at`), or added on the
  order. Later changes to the company list never touch existing orders. An item can be limited to one
  payment route.
- **Tools** (what the row's button does): `done` (Mark done), `fill` (a small form with the item's
  fields; Save ticks it and keeps the values on the row), `upload` (attach a file; ticks when in),
  `pay` (opens the payment / factory payment / expense form filled in), `make` (makes a paper, phase 3),
  `send` (email/WhatsApp text from the order, phase 3). Auto items open the existing form for their
  data (e.g. "Record payment", "Add the B/L") inside the row.
- **Row anatomy:** box, title, (lock) "from the data", due, tools, ⋯ menu; second line = the data it
  collected as `label value` pairs + who · when; or "Needs: …" when open. ⋯ menu: Change the details,
  Set due date and person, Attach a file, Add a note, Untick, Skip with a reason, Delete (own only).
- **Late** = open with a due date before today: red, on Home and in reminders.
- `production_steps` rows move into the checklist (step `production`, tool `done`).

## 3. Lines: one line table

The order's lines are kept once; each step opens the same LineTable with its own columns:
Order (description, model, qty, unit, price, amount) · Factory (+ factory, factory price, tax %) ·
Received (+ received qty, received on, status) · Packing (+ packed in, packages, gross, net, CBM) ·
Delivered (+ delivered qty, condition). Lines are added/removed on the order only (parts and packing
splits excepted), so every paper agrees. Goods received and packing move from `Sheet` to LineTable.

## 4. Papers

Every paper uses `KeboDoc` and takes its lines from the order's lines. Existing: quotation, proforma,
packing list. New: sales contract, bank contract papers, payment request, payment receipt, purchase
order to the factory, FAT report, inspection report, commercial invoice, shipping advice, bill of
exchange (draft), beneficiary certificate, cover letter to our bank, delivery/handover note, SAT
certificate, customer statement. Numbers follow the order: `PI-2026-0031`, `SC-…`, `CI-…`, `PO-…`.

- **Make** page: left = "Filled from the order" checks (missing data can be typed there and is saved
  where it belongs), options; right = live preview in the template; Make final / Save as draft.
  Final locks the number, snapshots the data, ticks the matching checklist item and the paper set;
  "Make again" creates version 2 and keeps version 1.
- **Not made by the app** (B/L, AWB, certificate of origin, insurance, factory PI, LC copy, customs):
  upload, or **Kept elsewhere** (where, number, date — no file). All three count as done.
- Each step page lists its papers with state (Ready, Draft, Can be made, Waiting for data, Uploaded,
  Missing, Kept elsewhere) and the right button.

## 5. Costs (expenses on the order)

- Costs page: Planned on the quote · Spent · Not planned · Receipts missing; "Planned and spent"
  (order_costs vs expenses by group; freight, transport to port, customs, insurance count against the
  plan first); Expenses (LineTable, filter by step, missing receipts); Profit on this order (sale −
  factory − planned − not planned = expected, vs the quote); To repay (people who paid from their own
  money); Changes.
- Expense gains `step`, `borne_by` (us · customer — added to what they owe · factory — taken off what
  we owe them), `own_money` + `repaid_on`, categories `courier` and `insurance`.
- Each step page has "Costs in this step"; a checklist `pay` tool records an expense filled in.

## 6. Money corrections (page 17)

- **Any currency:** a customer payment records what arrived (amount, currency, account of that
  currency, paid by) and the rate; it counts as order-currency amount; the rate is kept.
- **Split, credit, refunds:** one receipt can pay several orders (oldest due first, editable); the rest
  is customer credit; credit can be used on an order or refunded.
- **One route, bank step = payment:** the route builds the plan (informal: balance before shipment or
  against B/L copy; bank contract; LC at sight or deferred N days counted from "papers reached their
  bank"). "Money reached us" records the payment (credited amount + bank charges) and ticks the step.
- **LC checks:** amount covers the balance, currency, ship-by vs ready date, expiry vs ETA + courier.
- **Factory payment plan:** per order and factory: advance % on order, balance on ready date (moves
  with the ready date), shows on Home, Production and Money › We owe factories.
- **Cancelled with money in:** keep as credit · refund · keep as a fee; factory money: refund expected
  or a loss.

## Build phases (each one PR into main, live after green CI)

1. Step pages, navigation, checklist with tools, company list, overview, changes per step.
2. One line table for goods received, packing and delivered.
3. Papers in KeboDoc: kinds, numbering, versions, Make page, Papers cards, kept elsewhere.
4. Costs: expense fields, Costs page, costs per step, profit.
5. Money corrections.
