# Step pages — one right panel: Papers · Costs · Files · Changes (all visible)

Approved 3 Nov 2026 from canvas page 23 boards OrderV5Payment, OrderV5Step, OrderV5Side
(/home/claude/canvas/project/OrderV5*.dc.html, previews /home/claude/preview/OrderV5Payment.png,
OrderV5Step.png, OrderV5Side.png). **Only the right side changes.** The Overview redesign on that page
(OrderV5Overview) is NOT part of this work. The Documents & bank page keeps its own layout (Papers /
Through the banks / Files are its main content) — only its "Changes in this step" side card gets the
compact list below.

## Today (main after #82)
On every step page Papers (papers card) and "Costs in this step" sit in the main column under the
step's data; Files and "Changes in this step" are separate side cards; each change takes 3–4 lines.

## New
Every step page except Documents: main column = checklist + "What this step holds" (details, lines) only.
Right column = ONE card (`StepSidePanel`), no tabs, four stacked sections, in this order:
1. **Papers · n** — "All papers" link (→ Documents › Papers). One line per paper: ✓ / • mark, name,
   number or next action ("Make", "missing"), ⋯ paper menu (same paper tools as today).
2. **Costs · n** — "+ Add expense" (opens today's expense form with this step preset). One line per
   expense: description, when/who, amount; "Spent in this step" total; empty: "No expense on this step
   yet · USD 0.00". Hidden without expenses permission/feature (as today).
3. **Files · n** — "+ Upload". One line per file: icon, name (ellipsis), what it's attached to, 👁, ⋯
   (the shared file tools from #82).
4. **Changes · n** — "All history". One line per change: avatar initial, **who** short what, when
   (right aligned). Paper drafts/versions fold into one line. Full text on hover (title attribute).
Each section shows at most 5 one-line rows (row height ~34px), then scrolls inside (thin scrollbar),
so the panel keeps a steady size. The card is sticky (top offset) on desktop when shorter than the
viewport. Phone (390px): the panel goes below the main column, same sections; lists show 5 rows then
"Show all n".
Remove the "Papers of this step" strip and the separate papers/costs/files/changes cards on these pages
(no duplicates). Keep counts in sync with today's data.

## Non-negotiable
Same data and permissions as today; LineTable unchanged; PDF buttons unchanged; mobile 390px; no API
changes unless a compact history summary needs one (prefer formatting on the web side).

## Done when
typecheck/lint/test/build green; screenshots of Payment, Production, Shipping, Delivery step pages
(1440 + 390) and the Documents page side card in /home/claude/shots/side-panel/; PR to main; CI green.
