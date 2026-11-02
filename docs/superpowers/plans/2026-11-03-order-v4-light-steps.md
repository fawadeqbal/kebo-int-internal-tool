# Order v4 — light checklist, view below (every step)

Approved 3 Nov 2026 from canvas page 20 "Order v4 (draft): light checklist, view below"
(https://claude.ai/artifact/9bXSortRgmEAtfG2WQSCuu). Boards: OrderV4Shipping, OrderV4ShippingEdit,
OrderV4Payment, OrderV4Phone, OrderV4Rules ("What each item asks"), OrderV4Ease ("Enough data, with
ease"). Builds on v3 (#74–#79). Branch `feat/light-steps`.

## Context (from Fawad)
Internal tool: no integration with banks, forwarders, carriers, customs or any AI reading. People type
the data; files are attached as copies. "Send" = the app makes the PDF/text and people send it
themselves. The data must still be complete enough for running the order, customer papers and
pages, factory records, money/profit and history — so entry must be quick and nothing forced.

## The rule on every step page
1. **Header** (as now).
2. **Checklist** — the only place you work. Card description: "Each item asks only what ticks it.
   Everything else: Edit in the view below."
   - Done rows: closed; their data in one plain line ("Sino Trans · NGB-77812 · ETD 14 Jan") + who ·
     when. They don't open by accident (change via ⋯ → Change the details).
   - Only the current item (first open item of the step, or the one the user opens) shows its form.
   - A row's form = the fields that tick it (see table) **pre-filled** with what we know, plus an
     optional field or two, plus "Add if you have it:" `+` chips that reveal more optional fields in
     the same row (seal no., photos, VGM, note, file copies). Hint: "Only the first n are needed to
     tick it."
   - **One-tap** items save at once with today's date: Ordered today, All received, Arrived today,
     bank step Done today, All delivered OK, All passed. Their exceptions (short/damaged delivery,
     a failed SAT check, partial receipt) open the lines instead.
   - Attachments are plain uploads kept with the item and in the order's paper set / files. No file
     reading.
3. **"What this step holds"** divider ("view only · change with Edit"), then read-only cards in this
   order on every step: **Details** → **Lines** (read-only LineTable with "Edit lines") →
   **Papers** and **Costs** side by side (two columns ≥ lg, stacked below).
   - Details card: label/value grid (3 cols desktop, 2 phone), header shows "n of m filled" + a small
     bar; every empty value is a **+ Add** button that edits that one value in place (input + Save,
     Enter saves, Esc cancels); header **Edit** opens the full form for the section in a side panel
     (480px drawer on desktop, full screen on phones) grouped as on OrderV4ShippingEdit, Save/Cancel
     footer, changes show in "Changes in this step".
   - Lines card is read-only until "Edit lines" (then today's LineTable editing for that set).
4. **Side column:** Files, Changes in this step. The "Key facts" side card is removed (its facts live
   in the Details card). Keep the Costs/Papers data but move them into the view (no duplicate side
   cards).
5. Prev/next as now.

## What each item asks (from OrderV4Rules)
| Step | Item | Asks | Pre-filled | One tap |
|---|---|---|---|---|
| Payment | Payment route chosen | route (3 cards) | deposit % and terms from the quote | |
| | Deposit / balance received | amount, account | date today · rate from Settings · allocation oldest due | |
| | LC opened | LC no., amount, expiry | banks from this customer's last LC | |
| Factory order | Ordered from the factory | their order no. | date today · factory and prices from the quote | Ordered today |
| | Advance paid | amount, account | advance of the factory plan · date today | |
| Production | Ready date from the factory | date | lead time from the quote suggests it | |
| | Goods received | nothing | all lines in full, today | All received |
| | FAT / inspection | result, file | date today · witness = me | |
| Shipping | Space booked | forwarder, booking no., ETD | forwarder of the last order on this route (same port pair or factory) | |
| | Loaded | container no. | date today (+ seal no. optional; chips: photos, VGM, note) | |
| | Sailed | B/L no., vessel | date today (chips: B/L copy, note) | |
| | Arrived | nothing | date today | Arrived today |
| Documents & bank | Each paper | nothing (Make) or the file | number and data from the order | |
| | Each bank step | courier no. (courier step only) | date today | Done today |
| Delivery & SAT | Delivered | nothing | all lines in good condition, today | All delivered OK |
| | SAT | signed by | all checks passed, today | All passed |
Own items (company list) keep their tools; a `fill` item's first fields are its required ones and
the rest become chips.

## What each step's view shows
- **Payment:** How they pay (route, deposit, balance terms, LC no./amount/banks/ship by/expiry when
  bank routes) · The plan (lines) · Payments received (lines) · Papers · Costs.
- **Factory order:** Factory (factory, their order no., ordered on, price basis, ready date) · factory
  lines with factory prices (sourcing.manage only) · factory payment plan · Papers · Costs.
- **Production:** Production (factory, ready date, days left, ship by, FAT date/result, inspection) ·
  Lines · from the factory (received) · Papers · Costs.
- **Shipping:** Shipment (way, from → to, forwarder, booking, container + no., seal, vessel, B/L,
  ETD/ETA, ship by, loaded/sailed/arrived) · Lines · packing · Papers · Costs.
- **Documents & bank:** Paper set (each paper with source) · Bank steps (dates, courier no.) · Papers
  (LC papers, cover letter) · Costs.
- **Delivery & SAT:** Delivery (delivered on, condition, received by, SAT planned/done, engineer,
  signed by, claims open) · Lines · delivered · SAT results · Claims · Papers · Costs.
"n of m filled" counts the fields that matter for that step and route (e.g. LC fields only on LC).

## API needs (keep small)
- A field-level PATCH for the single "+ Add" edits where an endpoint doesn't already take partial
  updates (shipments, bank contract, order details, delivery already accept partial bodies — reuse;
  add only what's missing). Same permissions/audit/history mapping as the full forms.
- Defaults: endpoint(s) or data in existing step reads for "last forwarder on this route", "banks of
  this customer's last LC", "lead time from the quote", advance from the factory plan.
- One-tap actions use the existing endpoints with today's date / "all" bodies (all received, all
  delivered good, all SAT passed — add bulk helpers if missing, with audit).
- Tests for any new endpoint/bulk action (permissions, RLS, audit) and the defaults.

## Non-negotiable
LineTable unchanged; PDF View / Print + Download PDF unchanged; mobile 390px (OrderV4Phone: tools
under rows, cards stacked, lines as short text lines on phones); element-level permissions (no edit
rights → no + Add, no Edit, no tools; view still shows); RLS; modules switchable; no AI/OCR; existing
data and the mobile app's endpoints keep working.

## Done when
typecheck/lint/test/build green; screenshots of all six step pages + the Edit panel + "+ Add" in
place + a one-tap item, desktop 1440 and phone 390, in /home/claude/shots/v4/; PR to main; CI green.
