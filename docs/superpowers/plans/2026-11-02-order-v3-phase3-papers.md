# Phase 3 — papers the app makes, in our document template

Spec §4. Boards: OrderV3Papers (catalogue), OrderV3MakePaper (Make page), OrderV3Template (three new
papers in the template), the "Papers" side cards on OrderV3Payment/Production/Shipping, and the
papers list on OrderV3Documents; DocsV2Sources (Kept elsewhere) on canvas page 18. All in
/home/claude/canvas/project/*.dc.html with previews in /home/claude/preview/*.png.
Branch `feat/order-papers` from the latest main.

## Template
Every paper renders with `KeboDoc` (apps/web/src/components/print/kebo-doc.tsx) exactly like
proforma/packing list in `app/print/orders/[id]/[kind]/page.tsx`. Lines come from the order's lines.
Customer-facing papers have no prices beyond what the customer copy shows today.

## Kinds (print slug → what it uses)
- `sales-contract` — lines + totals + payment route/plan, shipment (incoterm, ports, ship by),
  inspection (FAT/SAT), warranty (settings text), signatures (two lines, no stamp duplication).
- `commercial-invoice` — lines + HS codes (if products have them; else omit column) + shipment
  (vessel, B/L no., ports) + LC no. + certification sentence; date = B/L date or today.
- `purchase-order` — to the factory (factory as the "Prepared for" party), factory lines with factory
  prices in factory currency, ready date, payment plan to the factory, our order number.
- `shipping-advice` — shipment: vessel, B/L, container, ETD/ETA, packages/weights totals.
- `payment-receipt` — one customer payment (`?payment=<id>`).
- `payment-request` — one plan item or the balance (`?item=<id>`).
- `fat-report` / `inspection-report` — from the checklist item's `data` (fill tool) of the FAT /
  inspection item; checks table if present.
- `delivery-note` — lines with delivered qty/condition (phase 2 fields), received by.
- `sat-certificate` — SAT checks (sat_checks) with results, signed by, date; "warranty starts".
- `bill-of-exchange`, `beneficiary-certificate`, `bank-cover-letter` — LC route only; LC fields from
  order_bank_contracts; cover letter lists the paper set.
- `customer-statement` — all orders/payments/credit of the order's customer (phase 5 adds credit;
  until then orders + payments).
Register each in the print page's KINDS, in the PDF route `app/pdf/[kind]/[id]/route.ts` KINDS, and in
the API documents endpoint (`documents.service.ts ORDER_DOCUMENTS`) with the data each needs.

## Numbers, drafts, versions
Migration `…_order_papers`: table `order_papers` (company table with RLS like the others):
`id, company_id, order_id, kind text, number varchar(40), version int, status text (draft|final),
options jsonb (e.g. showHs, lcStatement, stamp), snapshot jsonb null (the full data used to render,
stored when final), made_by, made_at, final_at`, unique (order_id, kind, version).
Number = kind prefix + the order number's tail (SO-2026-0031 → SC-2026-0031, CI-…, PO-…, SA-…,
RC-…, PR-…, FAT-…, IR-…, DN-…, SAT-…, BE-…, BC-…, CL-…, ST-…); receipt/request add `-<n>`.
Final: stores the snapshot, locks the number, sets the matching `order_documents` row (kinds that
exist there: commercial_invoice, packing_list, proforma_invoice, sales_contract, inspection) to
ready with `paper_id`, and the checklist auto item `doc:<kind>` is then done. "Make again" creates
version n+1 as draft. Print reads the snapshot when `?v=<version>` of a final paper is requested,
else live data (draft watermark "DRAFT" via KeboDoc's `watermark`).
API: `GET /orders/:id/papers` (list with state per kind: ready/draft/can/wait(needs…)/up/miss/else),
`POST /orders/:id/papers/:kind` (draft), `POST /papers/:id/final`, `POST /orders/:id/papers/:kind/
again`, `GET /orders/:id/papers/:kind/checks` (the "Filled from the order" list: key, label, value,
ok, fixable field). Fixable fields (B/L no., vessel, LC no., HS code on a product…) are saved by the
existing endpoints. Permission `documents.manage` (bank papers also feature `bank_documents`).
Audit `paper.draft|final|again` (step from kind for history).

## Kept elsewhere (docs v2)
`order_documents.status` gains `elsewhere` + columns `kept_where varchar(200)`, `paper_id uuid`
(fk order_papers). Counts as done. UI: "Kept elsewhere…" button on missing papers → small form
(where, number, date).

## Web
- Make page `/orders/[id]/papers/[kind]`: left card (checks with inline fix inputs, options
  checkboxes, Make final / Save as draft / Cancel, note about versions), right: preview = iframe of
  `/print/orders/[id]/[kind]?embed=1` (scaled to fit; reloads after a fix), with the existing View /
  Print + Download PDF buttons above it.
- `components/orders/papers-card.tsx` side card on step pages: the papers of that step with state
  badge and View / Print | Make | Upload | Kept elsewhere. Step mapping: payment (quotation, proforma,
  sales contract, bank contract papers, payment receipt, payment request), factory (purchase order),
  production (FAT, inspection, factory PI upload), shipping (packing list, commercial invoice,
  shipping advice, booking upload, B/L), documents (the paper set + LC papers + cover letter),
  delivery (delivery note, SAT certificate).
- Checklist: `make` tool on items whose key is `doc:<kind>` for app-made kinds and on own items
  configured with tool make (+ kind) → links to the Make page. Shipping advice "Make and send":
  after final, offer mailto:/WhatsApp share text (no email sending infrastructure needed).
- Documents page: papers list rows like OrderV3Documents (source badge Made by the app / Uploaded /
  Kept elsewhere / Missing).

## Tests
API: numbering, draft→final→again, snapshot unchanged after order edit, documents row ready, RLS,
permissions, every-endpoint; every print kind renders (fetch /print pages in a web build smoke test
if feasible, else unit test the data builders).

## Done when
Green checks, screenshots of the Make page, three papers, papers cards at 1440/390 in
/home/claude/shots/phase3/, PR against main, CI green (do not merge).
