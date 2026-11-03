# PR A · Design-system building blocks

Spec: docs/superpowers/specs/2026-11-03-design-system.md (read it all). Boards: canvas page 29.

Build the shared components (apps/web + packages/ui where the existing primitives live), with stories-free
but real usage on ONE page each as a proof (no page-wide rollout yet — that is PRs C/D/E):
1. `PageHeader` (back, title, badge, summary, paper slot, one primary, ⋯ MoreMenu; phone folding) — enforce
   "at most one primary" by API (a single `primary` prop).
2. `SectionNav` (steps or sections; counts; phone chip row) — the order/inquiry step nav keeps its look,
   reuse/align it.
3. `CardHeader` actions: reuse #85 EditButton; `AddButton`; consistent placement.
4. `SidePanel` (create/edit) replacing the ad-hoc edit panels: sizes 600/520/full-screen, header/body/
   pinned footer, focus trap + return, Esc, Ctrl+Enter, aria, "Discard changes?" confirm when dirty,
   `useSidePanel` with URL state (?panel=edit-customer&id=…) so links and back work. Migrate the existing
   side panels (order step Edit panels from #80/#84) to it with no visual regression.
5. List pieces: `ListToolbar` (search, filter chips with counts, Excel), `DataTable` row behaviour (click
   opens, hover, keyboard Enter, ⋯ RowMenu at row end, sticky header) — do NOT change LineTable; `Pager`
   (25 per page, URL).
6. `StatusBadge` with the five meanings (map existing tones), `EmptyState` (text + one action), `Toast`
   ("Saved" + Undo), `Banner`.
7. Sidebar: "Money" → "Cash & accounts" (label + page title of that module; route can stay).
Proof pages: Customers list uses ListToolbar/DataTable/Pager; "New customer" opens SidePanel (keep the old
/customers/new route working by redirecting to the panel). Everything else unchanged.
Tests: component tests (focus trap, Esc, dirty confirm, one-primary), Playwright a11y check (axe if
available) on the proof page. Screenshots before/after.
