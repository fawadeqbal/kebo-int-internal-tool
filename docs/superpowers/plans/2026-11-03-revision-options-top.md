# New revision: organised, options on top

Approved 3 Nov 2026 from canvas page 26 (boards /home/claude/canvas/project/Fix26Revision.dc.html and
Fix26Phone.dc.html; previews /home/claude/preview/Fix26Revision.png, Fix26Phone.png). Owner screenshot of
today's screen: /mnt/user-data/uploads/eb0c7532-image.png.

Code: apps/web/src/components/deals/revision-editor.tsx (the "New revision" / revision edit form with
"Options for the customer"), plus price-editor.tsx / quotation-step.tsx where the same option list appears.

## Changes
1. Title block: "New revision Rn" with the start note as its subtitle ("Starts with <factory>: covers
   everything asked for, cost …, priced at your default n%. Add more offers as Options B, C…"). The separate
   grey "Rn WILL START WITH" box goes away.
2. "1 · Terms — for every option in this revision": Currency, Incoterm, Place (optional), Valid until,
   Deposit %, Balance in one row of 6 on wide screens (3 / 2 / 1 columns as it narrows). Printed terms and
   notes behind a "More: printed terms and notes" toggle (keep all fields; open automatically if any has a
   value or an error).
3. "2 · Options for the customer": the option cards become a horizontal row ABOVE the option, at every
   width (no left column, remove the 2xl side layout). Each card: Option X + total, factory · lead time,
   margin badge + Ready / n to check; selected = primary border + soft fill; "+ Add an option" as a dashed
   card at the end of the row (shows "n more offers to add"); the add list opens under the row. On phones the
   row scrolls sideways (snap), Add card at the end. Keep keyboard/ARIA (tablist/tab or listbox semantics
   as today, selected state announced).
4. The chosen option takes the full width: header "Option A · <factory>" + coverage line; on the right
   "Price all at [n] % [Apply]" (the margin control moves here from above), a divider, ← → move, and a red
   ghost "Remove". Then the ready/checks box, then the price table full width WITHOUT sideways scroll at
   ≥1024px (drop the min-w forcing scroll where room allows; phones may keep the existing phone layout),
   the hint line, "Getting it to <basis>", charges — all inside the option card.
5. Bottom bar (sticky, as today): option total, cost, profit, margin (costs only for users who may see
   them) + Cancel + "Save Rn as a draft".

Same data, behaviour, permissions (showCosts), validation and server actions. LineTable unchanged. PDF
buttons unchanged. Works at 390px.

## Done when
typecheck/lint/test/build green; screenshots (desktop 1440 with 2 options, Add list open, 1024px, phone
390) in /home/claude/shots/fix26/; PR to main; CI green.
