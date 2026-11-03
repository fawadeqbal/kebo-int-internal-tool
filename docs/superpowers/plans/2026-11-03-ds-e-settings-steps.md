# PR E · Settings frame + step pages follow the rules

Spec: docs/superpowers/specs/2026-11-03-design-system.md · boards DS29Frames (Settings frame), DS29Anatomy,
DS29Components (/home/claude/preview/DS29*.png). Built on PR A (#95): PageHeader (one primary + ⋯ +
papers), SectionNav, SidePanel/useSidePanel, MoreMenu, StatusBadge, EmptyState, Banner, toast.

1. Settings, Security (and its sub-pages: roles, sessions, sign-ins), Account, Platform settings/admin
   pages that are settings-like: the Settings frame — a visible section list on the left (phone: chip row),
   group cards with title + one-line description; values read-only with ✎ Edit opening the SidePanel for
   that group (switch lists stay inline switches); no page-long forms with a Save at the bottom. Keep every
   setting and permission; keep URLs (sections can be ?section= or sub-routes).
2. Step pages (order Overview + steps, inquiry Overview/Needs/Factory prices/Quotation, Costs, History,
   Documents): apply the header rules — at most ONE primary (the next step for that page), the rest
   secondary/ghost, extra actions into the PageHeader ⋯ MoreMenu; PDF View/Print + Download PDF unchanged
   (they're the `papers` slot). Inquiry Factory prices goes from 4 purple buttons to 1. Cards: actions in
   the card header (EditButton / AddButton / Excel ghost). Empty cards use EmptyState with one action.
   Statuses use StatusBadge (five meanings). Do not change LineTable or the step flow itself.
3. A small `check-one-primary` dev test (Playwright) that visits each step page and settings page and
   fails if more than one primary button is visible.
Screenshots before/after (1440 + 390) into /home/claude/shots/dsE/.
