# Single source of truth · PR 3 of 5: the shipment is the shipment

Audit §1 #2 #8, §3.3, §3.4, §4, §5, §7, §8 "PR 3"; owner decisions §10 (ship-by vs LC: warn). Builds on
PR 1–2 (papers already frozen, so old papers don't move when shipping data moves).

1. Shipment holds B/L, departed (shipped) on, container, seal, vessel, ports, ETD/ETA. Backfill: for each
   order with Order.blNo/shippedOn/containerNo/portOfDischarge and no shipment, create one (mode sea unless
   known, status from the order stage). Where both exist and differ, keep the shipment's and write the
   order's old value into the audit/history. Orders without the shipping module still get their shipment
   row (implicit, edited from the Details card in that case).
2. One `primaryShipment(order)` rule (shared) used by papers, overview, checklist, LC checks and insights;
   "shipped on" = earliest departedOn. Remove followFlow's copy and every order→shipment / shipment→order
   copy. Drop Order.shippedOn / blNo / containerNo (or keep as generated read-only columns if Insights SQL
   needs them — prefer switching Insights to the shipment).
3. Packing list, CI, shipping advice, cover letter read the same shipment values. The B/L document row's
   number is the shipment's B/L (no separate typing for app-known kinds).
4. Order Details card: Shipped on, B/L no., container shown read-only "from Shipment 1 · edit in
   Shipping" (link with the #85 checklist-link highlight); editable there only when the shipping module is
   off. Packing form: container read-only from the shipment.
5. Port of discharge: Order.portOfDischarge stays only as the contract destination (default for the
   shipment POD); new shipments take ports from the shared `portsOf` (E/F terms → loading = incoterm
   place; C/D terms → discharge = incoterm place) — fixes the CFR/CIF loading-port prefill.
6. Ship-by: Order.shipBy is our promise; with an LC, show both "Ship by 1 Apr · LC latest 15 Apr" on the
   Details card, the shipping page and the sales contract Make page, and WARN (LC check + Keep an eye on)
   when shipBy is later than the LC's latestShipOn. Ship-by default suggestion from Inquiry.requiredBy.
Tests: backfill on mixed data, papers agree after a B/L correction, ports per incoterm, ship-by warning.
