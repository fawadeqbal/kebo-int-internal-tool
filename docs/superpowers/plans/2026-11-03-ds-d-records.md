# PR D · Record pages + side-panel create/edit

Spec: docs/superpowers/specs/2026-11-03-design-system.md · boards DS29Record.png, DS29Panel.png, DS29Phone.png
(/home/claude/preview). Built on PR A #95 (PageHeader, SidePanel/useSidePanel/OpenPanelButton, MoreMenu,
EditButton/AddButton, StatusBadge, EmptyState, toast) and PR C #97 (lists). PR F (#98, Insights) adds a
`PerformanceCard` to these pages — if #98 is merged when you start, place it; if not, leave a clear slot at
the top of the main column and merge main later.

1. Customer, Factory and User record pages in the record frame: PageHeader (back, name, status badge worked
   out from data, summary line, ONE primary — customer: "New inquiry"; factory: "Ask for prices" or the
   most useful next action; user: none or "Reset password" as secondary — ⋯ with the rest); main column:
   Performance (slot/card), Details card with ✎ Edit (opens the SidePanel edit form), then their lists
   (customer: orders, inquiries; factory: offers, orders; user: their inquiries/orders as relevant) using
   DataTable-like compact tables with row → record and ⋯; right panel: Files (where the entity has files)
   and Changes (history) in the side-panel style from #87. No tabs (old tabs → sections on the page).
2. Create and edit for customers, factories and users use the SidePanel (customers already do since #95 —
   align its edit to open from Details ✎ Edit). Remove the separate /customers/[id]/edit, /factories/new,
   /factories/[id]/edit, /users/new, /users/[id] edit-only pages: their URLs redirect to the record/list
   with the panel open (?panel=…), so old links and bookmarks still work. "New factory" / "New user"
   buttons on the lists open the panel.
3. Phone: as DS29Phone (header actions fold to primary + ⋯; sections as chips; right panel below).
4. Same data, validation, permissions. Tests (incl. redirects, panel open via URL, axe on each page) and
   screenshots (each record 1440 + 390, each create/edit panel 1440 + 390) into /home/claude/shots/dsD/.
