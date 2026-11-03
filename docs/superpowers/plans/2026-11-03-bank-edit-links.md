# Bank step form full width · Edit you can see · checklist items linked to their data

Approved 3 Nov 2026 from canvas page 25 "Fixes" (boards Fix25Bank, Fix25Edit, Fix25Links, Fix25Phone:
/home/claude/canvas/project/Fix25*.dc.html, previews /home/claude/preview/Fix25*.png). Owner's screenshot
of today's problem: /mnt/user-data/uploads/63a1162f-image.png (the "Money reached us" form squeezed inside
the tracker's last column, breaking the card).

## 1. Bank step forms under the tracker
On Documents › Through the banks, a step's button (Done today with courier no., Record it = money reached
us, …) opens its form as a full-width band UNDER the whole tracker (not inside the step's column):
header "n · <step> · <LC/contract no.>" + close; body in 3 columns (Money reached us: credited to us
(currency + amount), on, bank charges; into (account), reference, MT103/bank slip upload) with the money
check on the right (balance due, credited + charges, left due); footer Record and tick / Cancel. Other
steps' forms (courier no., date) use the same band, smaller. Phone: the form opens full screen with the
action pinned at the bottom. Same endpoints and behaviour as today.

## 2. Edit you can see (everywhere in orders and inquiries)
- Cards of details (DetailsCard / view cards): the header action becomes a real secondary button with a
  pencil icon "✎ Edit" (same position on every card). Read-only (no permission) → no button.
- Tables that can be edited (lines cards: packing, received, delivered, factory lines, needs lines, offer
  lines, plan where editable): "✎ Edit lines" secondary button in the header; in read-only mode a hovered
  row is highlighted and shows a pencil at the row end; clicking the row opens editing for that row (or the
  table's edit mode focused on that row if single-row editing isn't available).
- Missing values keep "+ Add"; filled values show a small pencil on hover when editable.
- Make one shared `EditButton` component and use it consistently; replace ghost/text "Edit" links.

## 3. Every checklist item links to its data
- Each checklist row shows a small link chip next to its title naming where its data lives, e.g.
  "Shipment · container →", "Lines · packing →", "Papers · Commercial invoice →", "Costs · Sea freight →".
  Clicking the chip (or the row's data line) scrolls to the target card on the same page and highlights
  the related fields (outline + soft background for ~2 s); a target on another step navigates there
  (URL hash/query) and highlights after load.
- Mapping (auto items by key, see shared AUTO_ITEMS): deposit/balance → Payment › The plan + Payments
  received; LC opened → Payment › How they pay (LC fields); factory ordered / advance → Factory order ›
  details + factory payment plan; ready date / goods received / balance to factory → Production details,
  Lines from the factory, Factory order › plan; booked/loaded/sailed/arrived → Shipping › Shipment (the
  matching fields); packing list → Shipping › Lines · packing; doc:* → Documents › Papers (its row);
  bank:* → Documents › Through the banks (its step); delivered / SAT → Delivery details, Lines delivered,
  SAT results; costs (pay tool) → right panel › Costs (its line). Own items with files → right panel ›
  Files; own items without a target show no chip.
- Implement targets with stable ids/data attributes on cards and fields (e.g. `data-target="shipment.containerNo"`),
  a small client helper `goTo(target)` (scrollIntoView + highlight class), and put the mapping in shared
  (checklist workflow) so web and future mobile agree.

## Non-negotiable
Same data/permissions; LineTable component unchanged; PDF buttons unchanged; mobile 390px; accessible
(links are real links/buttons with labels; highlight also announced via focus).

## Done when
typecheck/lint/test/build green; screenshots (bank form open desktop + phone, edit buttons on a details
card and a lines card with a hovered row, a checklist link before/after click with the highlight, a
cross-step link landing) in /home/claude/shots/fix25/; PR to main; CI green.
