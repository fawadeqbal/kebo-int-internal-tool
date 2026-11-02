# Phase 2 — one line table for goods, packing and delivery

Spec: `docs/superpowers/specs/2026-11-02-order-flow-v3-design.md` §3. Board: OrderV3Lines
(/home/claude/canvas/project/OrderV3Lines.dc.html, preview /home/claude/preview/OrderV3Lines.png),
plus the "Lines · from the factory" card on OrderV3Production and "Lines · packing" on
OrderV3Shipping. Branch `feat/order-lines` from the latest main (phase 1 merged).

## Goal
Goods received (Production page), the packing list (Shipping page) and what was delivered (Delivery
page) are edited in the existing `LineTable` (components/lines/line-table.tsx, unchanged), on the
order's own lines, each with its column set. Today goods/packing use `components/lines/sheet.tsx` +
bulk `PUT /orders/:id/receipt` and `PUT /orders/:id/packing` (goods.tsx). Keep Excel in/out working
(ExcelMenu / sheet-spec / line-sheets).

## Data
Migration `…_order_line_delivery`: `order_lines.delivered_qty numeric(12,2) not null default 0`,
`delivered_condition text null` (good | minor_damage | damaged | missing), `delivery_note
varchar(200) null`. No new tables (RLS unchanged).

## API
- `PATCH /order-lines/:id` with a `set` discriminator: `received` {receivedQty, receivedOn},
  `packing` {packages, packageType, netWeightKg, grossWeightKg, cbm}, `delivered` {deliveredQty,
  condition, note}. Permissions: received/packing `orders.update`; delivered `delivery.manage` +
  feature `delivery_sat`. Same validation and audit actions as the bulk endpoints
  (`goods_received`, `packing_list`, new `delivered`), same reason prompt where the bulk ones ask
  (after shipping). Returns the updated line + order goods summary.
- Keep the bulk endpoints (Excel import uses them).
- Lines cannot be added or removed here (the LineTable's add/remove handlers are not passed; rows
  readOnly where the column set says so). Packing splits stay as today if they exist; otherwise skip.
- Tests in apps/api/test/orders.test.ts or a new order-lines.test.ts: each set, permissions, RLS
  (another company's line is 404), audit rows, received > quantity rejected like the bulk endpoint.

## Web
- `components/orders/order-lines.tsx`: a client wrapper around LineTable that takes `set:
  "factory" | "received" | "packing" | "delivered"` and builds the columns: base (No. via
  lineNumbers, description first line, qty, unit) + the set's columns (Received: received qty
  (number input), received on (date text), status badge; Packing: packed in, packages, gross kg,
  net kg, CBM; Delivered: delivered qty, condition (select), note; Factory: factory, factory price,
  tax %, read only). `onEdit` calls a server action → PATCH; footer = totals (packages, gross, net,
  CBM / received n of m / factory total).
- Production page: "Lines · from the factory" card (received set) replaces GoodsReceipt; Shipping
  page: "Lines · packing" card (packing set) replaces PackingList's grid, keeping its View / Print +
  PDF (FileActions) and Excel; Delivery page: "Lines · delivered" card (delivered set) when
  delivery_sat is on. The checklist auto items `goods_received` and `packing_list` keep working.
- Remove `goods.tsx` pieces that become unused; keep `sheet.tsx` if anything else uses it.
- 390px: LineTable's phoneHidden on secondary columns.

## Done when
typecheck/lint/test green, build OK, screenshots of the three cards at 1440 and 390 in
/home/claude/shots/phase2/, PR against main, CI green (do not merge).

## Polish carried over from phase 1 review
- Step header second line: it repeats the old flow sub-line ("2 of 2 steps", "0 of 6 steps") under
  "n of m done", which reads as a contradiction. Replace it with one plain line about where the step
  stands (e.g. "Ready 07 Jan 2027 · day 24 of 60", "Deposit received · balance through the LC"), or
  drop it when there is nothing useful.
- Phone (390px): on rows with no tools the ⋯ button wraps onto its own line under the row; keep it on
  the title line at the right.
