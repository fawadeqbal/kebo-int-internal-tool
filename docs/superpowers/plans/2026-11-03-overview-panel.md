# Order overview for a manager · roomier right panel

Approved 3 Nov 2026 from canvas page 27 (boards /home/claude/canvas/project/Fix27Overview.dc.html and
Fix27Panel.dc.html; previews /home/claude/preview/Fix27Overview.png, Fix27Panel.png). Owner's screenshot of
today's panel: /mnt/user-data/uploads/070d47aa-image.png. The approved v5 overview board this builds on:
/home/claude/preview/OrderV5Overview.png.

## 1. Order overview (apps/web/src/app/(app)/orders/[id]/page.tsx)
Top to bottom:
1. "Do this now" banner as today (keep).
2. The order in one sentence + journey: a card with a generated sentence (customer + city bought <what:
   main line descriptions> for <total + incoterm>; <factory> made it; shipping state with vessel/dates;
   payment: received % and how the rest is paid) and an "On time / Late" badge + "Day n since the order";
   below it the journey: Inquiry · Quotation · Payment · Factory · Production · Shipping · Bank · Delivery & SAT
   (only the steps this order has; skip switched-off modules), each with state dot, date and a short sub-line.
   Build the sentence and sub-lines from data already loaded; missing facts are just left out.
3. Six figures (one card, 6 columns; 3×2 on tablets, 2×3 on phones): Order value (+ incoterm, discount),
   Received % (bar; amount + what's left and how), Paid to the factory % (bar; amount, factory), Expected
   profit (amount · margin, vs quoted margin) — only with expenses/costs permission, else hide that tile,
   Next deadline (date + what + "in n days", warn/bad tone), Progress (n of m steps, bar, current step).
4. Main column: What happens next (next up to 3 open items with their step + button to open the step) and
   Keep an eye on (deadlines within 30 days, missing papers, profit vs quoted), then Money (bars: from the
   customer, to the factory/factories, costs) and What they bought (lines, read-only, total).
   Right column (400px): **Details at the top** (the existing DetailsForm card, with the shared EditButton
   "✎ Edit" from #85, values wrapping, 2 columns), then Who's involved (customer + contact, handled by,
   factory + their order no., forwarder + booking, banks + LC/contract no. — whatever exists), then Key dates.
5. Notes (full width) as today.
6. **Recent changes last, full width**: rows with avatar, who + what (one line, ellipsis, full text on
   hover/title), step name, when; 5 rows then scroll; "All history" link.
Remove the old grid of step cards (the journey replaces it) — keep their facts available in the journey
sub-lines. Same permissions (hide money for people who can't see it, as today).

## 2. Right panel, roomier (components/orders/step-page.tsx StepFrame, side-panel.tsx, side-panel-parts.tsx)
- Width 420px at ≥1280 (xl), 380px from 1024 (lg), under the page below lg as today. Apply the same to
  the inquiry step pages that use the panel.
- Papers rows: two lines — name (14px, medium, wraps, never truncated) and under it the number or status
  ("SC-2026-0007", "can be made" linking to make it, "recorded"), status mark on the left, ⋯ on the right.
- Files rows: two lines — file name (wraps / breaks anywhere) and "<what it belongs to> · <who> · <when>"
  under it; view and ⋯ buttons size sm.
- Changes rows: avatar, the whole sentence wrapping (14px), time under it. Keep "5–6 rows then scroll":
  raise max-heights so about 6 rows show (Papers ≈ 330px, Changes ≈ 300px), thin scrollbar visible.
- Section titles 15px semibold with count; header actions size sm (not xs). Row padding 8px.
- Same everywhere the panel is used.

LineTable unchanged; PDF buttons unchanged; 390px phones fine.

## Done when
typecheck/lint/test/build green; screenshots (overview 1440 full page, overview 390, a step page with the
panel at 1440 and 1024, inquiry step with the panel) in /home/claude/shots/fix27/; PR to main; CI green.
