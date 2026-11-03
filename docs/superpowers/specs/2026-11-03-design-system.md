# RFQ Desk design system — one way to build every page

Approved 3 Nov 2026 (canvas page 29; boards /home/claude/canvas/project/DS29*.dc.html, previews
/home/claude/preview/DS29*.png). Owner decisions from the brainstorm:
- One way to edit everywhere: the side panel (responsive, accessible). Create uses the same panel
  (except a new inquiry, which keeps its full page). No separate /new and /edit pages.
- One primary (purple) button per page: the next step. Everything else secondary / ghost / ⋯.
- Lists: clicking a row opens the record (or edits the line in editable tables); other row actions in one
  ⋯ menu at the end of the row; delete only in ⋯, last, red, with a confirm.
- Customer, factory and user pages use the same frame as orders (header, main column of cards, right
  panel with Files · Changes). No tabs.
- Names by job: sidebar "Money" → "Cash & accounts"; Insights › Money and the order's Money tab keep "Money".

## The ten principles
1 One page, one next step · 2 Same place, every page · 3 Edit in a side panel · 4 Click a row to open it ·
5 Always visible, never hidden (sections are visible lists / numbered steps, never faint tabs) ·
6 Status = word + colour (five meanings: neutral Draft, info Sent/In progress, ok Done/Paid, warn Due
soon/Check, bad Late/Failed) · 7 Enter once, read everywhere (elsewhere: read-only + link "from X →") ·
8 Empty is a starting point (says what goes here + the one way to add it) · 9 Works on a phone (390 px) ·
10 Everyone can use it (labels, keyboard order, visible focus, dialogs trap focus, Esc closes).

## Page header
← back link · title (22 px) · status badge (word + dot) · summary line (who · what · how much · how paid ·
handled by). Right: paper buttons (View / Print, Download PDF — unchanged) · the one primary · ⋯ more
(duplicate, export, cancel; delete last, red). Phone: primary + ⋯, paper buttons move into ⋯.

## Section navigation
Numbered steps (orders, inquiries) or a section list (Insights, Settings), always visible, counts show
progress. Phone: a chip row that scrolls sideways, current one filled.

## Card
Title + one-line description (what it holds / how to change it); actions in its own header, right:
✎ Edit (opens the panel) for details, + Add for lists, Excel ghost + ✎ Edit lines for tables; read-only
cards show none. Values: missing → "+ Add" in place; filled → pencil on hover; lives elsewhere → read-only
with "from Shipment 1 →".

## Side panel (create · edit)
600 px desktop, 520 px ≤1279, full screen <768 with Save pinned. Title says "New customer" / "Edit
customer · Lahore Pharma". Fields in titled groups, 2 columns (1 on phones), required first, "optional"
written (no stars), visible labels, hint under, errors next to the field + summary at top on save.
Keyboard: focus first field, Tab follows groups, Ctrl+Enter saves, Esc closes. role=dialog, aria-modal,
labelled by its title, focus trapped and returned to the opener. Closing with changes asks "Discard
changes?". After save: closes, page updates in place, "Saved" toast (Undo where possible), changed card
highlighted 2 s.

## Page frames
List (search + filter chips with counts + Excel in one row; table: row opens, ⋯ at row end, sticky header;
25 per page; filters in the URL) · Record (Performance, Details ✎ Edit, their lists; right: Files, Changes)
· Record with steps (as today) · Dashboard (section list left, period picker in the header's action place,
tiles, one chart one axis, short lists) · Settings (section list, group cards with ✎ Edit, switch lists) ·
Side panel.

## Components
Buttons by role (primary one per page; secondary; ghost; edit; ⋯; danger only inside a confirm) · status
badge · card header actions · values in a card · row menu · empty state · toast · banner in the card it
concerns.
