# Fixes: quotation prices in place, roomy edit panels, papers we use, three bugs

Approved 3 Nov 2026 from canvas page 24 "Fixes" (boards Fix24QuoteEdit, Fix24QuotePhone, Fix24Panels,
Fix24Notes: /home/claude/canvas/project/Fix24*.dc.html, previews /home/claude/preview/Fix24*.png).
User screenshots of today's problems: /mnt/user-data/uploads/d767129f-image.png (option editor in a narrow
panel: sideways scroll), /mnt/user-data/uploads/e677931f-image.png (offer edit panel: squeezed fields,
port list covering others), /mnt/user-data/uploads/352f910c-image.png (⋯ menu cut off inside the Papers card).

## 1. Edit prices in place (Quotation step, inquiry v4)
"Edit prices" no longer opens the revision editor in a side panel. The Quotation page itself switches to
edit mode, full width (right column hidden while editing):
- Header strip "Editing R<n> prices" + hint + "Price all at [15] % · Apply".
- Options as a row of cards (A · factory, total, margin, covers badge) + "+ Add an option" + "Remove option X".
- Selected option's lines table with every column visible at 1440 (no horizontal scroll): No. · Description
  (model / "for item n" / factory as a small second line) · Qty · Cost (landed) · Unit price (input) ·
  Margin (green, amber when below the company's target/low) · Total. Enter → next line; pasting a column of
  prices fills down (keep today's behaviour). Parts indented.
- "Getting it to <basis>" as one internal line (to the port, freight, insurance) with Change.
- Charges as a plain inline table (Charge, Qty, Unit, Our cost, Price, Total) with an "Add a charge…" entry
  row at the bottom and "Paste a list" — no sideways scroll, no long help text.
- "Terms for this option" (lead time, valid until, note).
- Bottom bar fixed to the bottom of the viewport while editing: Subtotal · Discount (input) · Option total ·
  Cost · Profit · Margin · Cancel · Save prices.
- Phone: lines as rows (name, qty · cost · margin, price box), charges summarised, total + Save pinned.
Reuse today's revision-editor logic/endpoints (prices, costing, reasons); only the layout changes. Keep
LineTable unchanged where it is used; if the price editor today uses LineTable, you may render a simpler
read/edit table for this mode as long as Excel paste and Enter-to-next work.

## 2. Edit panels (factory offer, quotation terms, and any other side panel form from v4)
600px wide (full screen on a phone), sections with small caps titles, max 2 columns, label above, hint
below, "optional" marks. Price basis and Port are two separate fields (Port its own select under/next to
basis); selects open under their own field. Sticky footer with Save / Cancel (+ Remove this offer on the
right for offers).

## 3. Settings › Papers we use
Company setting (settings JSON, managers with settings.manage): a list of every paper kind the app makes
or tracks, each with an on/off switch. **Every paper starts switched ON — nothing is hidden by default.**
The company turns any paper off (or back on) here. The three LC papers (bill of exchange, beneficiary
certificate, cover letter to our bank) are ordinary switches in the same list (still only apply to LC orders).
Switched-off papers disappear from Papers lists, counts, the step's numbers, checklist `doc:*` items and
"missing" warnings; papers already made stay visible.

## 4. Fixes
- Checklist: remove "Drawings approved by the customer", "Materials and parts in", "Machining and assembly"
  from DEFAULT_CHECKLIST; a migration (after 20261129000000_order_files) deletes those items from orders
  where they are still open, untouched (no data, no attachment, no note, never ticked); ticked ones stay.
  Also remove them from company lists that still have them unchanged? Only from the built-in default — leave
  company-customised lists alone.
- Recording a payment: the receipt/slip upload in the payment form doesn't save the file. Find why
  (form encoding / action / API) and fix so the file is stored with the payment and shows in Files with the
  file tools; add a test.
- ⋯ menus cut off: every ⋯ menu (papers, files, checklist rows, side panel lists) renders in a floating
  layer above the page (portal, fixed position next to its button, flips up when no room below), so cards
  with overflow/scroll can't clip it.

## Done when
typecheck/lint/test/build green; screenshots (edit prices desktop + phone, offer panel, terms panel,
Settings › Papers we use, a Papers card without hidden papers, a ⋯ menu opening fully from a paper row and
from the side panel, a payment with its uploaded slip) in /home/claude/shots/fix24/; PR to main; CI green.
