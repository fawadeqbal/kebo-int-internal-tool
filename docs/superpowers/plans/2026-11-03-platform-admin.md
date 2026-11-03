# Platform admin on the design system

Approved 3 Nov 2026: canvas page 30 (boards /home/claude/canvas/project/Plat30*.dc.html, previews
/home/claude/preview/Plat30*.png). Rules: docs/superpowers/specs/2026-11-03-design-system.md. Built on the
design-system components (#95: PageHeader, SectionNav, SidePanel/useSidePanel, MoreMenu, RowMenu,
DataTable, ListToolbar, Pager, StatusBadge, EmptyState, toast, EditButton/AddButton) and the lists (#97,
platform Companies and Client inquiries already on the list frame).

1. Company page (apps/web/src/app/platform/(admin)/companies/[id]): record frame with a visible section list
   (URL ?section=): Overview · People · Plan & modules · Billing · Details · History (phone: chip row).
   Header: name, status badge (Active / Demo / Trial / Overdue / Off), summary (kind · plan · paid until ·
   people used of limit · web address); ONE primary "Open company" (disabled with reason when off);
   Export secondary; ⋯: Switch off… / Switch on…, Delete… (last, red, confirm). No Delete card.
   - Overview: tiles (people used of limit, files used of limit, last active, paid until with bar), Needs
     attention (renewal soon/overdue, two-step off for people, near a limit, demo ending), What they do
     (inquiries, orders, sign-ins 30 days, customers · factories, modules on), recent history (5).
   - People: table (person, role + Tenant admin badge, sign-in status, two-step, last signed in, ⋯ with
     "Send a link to set a new password" for tenant admins).
   - Plan & modules: plan card (plan, price, limits) + Change plan (side panel); modules as one switch list
     with "not in plan" badges; the reason a module is off shown under it.
   - Billing: paid-until bar + status, payments table with ⋯ (Remove… confirm), + Record payment (side panel).
   - Details: grouped cards each with ✎ Edit → side panel for that group: Company (name, short name, kind,
     country, time zone, main currency) · Main contact · Address and papers · Web address · Limits.
     Remove the long inline Details form.
   - History: list with kind filter + Excel.
   Demo/trial: shown in Overview attention + a card in Plan & modules (ends, extend…); Client inquiry link
   in the summary/⋯. Keep every current action and permission.
2. Platform overview (/platform): Dashboard frame — tiles (paying companies, income this month, renewals in
   30 days, demos and trials, new client inquiries) + Needs attention (overdue, demos ending, backup age,
   new inquiries) + renewals/demos ending table; ONE primary "New company" (side panel or its page).
3. Client inquiry page: record frame — status progress (New → Contacted → Demo given → Client / Lost) with
   next follow-up date, Who and What they need group cards with ✎ Edit (side panel), Demo card, Notes;
   ONE primary "Make a company", "Give a demo" secondary, ⋯ (Mark as lost…, Delete…).
4. Plans: list (row opens the side panel to edit price, limits, modules), "New plan" primary.
5. Platform settings: Settings frame with a section list (Website, Sign-up and demos, Emails, Backups, My
   account, Platform admins) and group cards with ✎ Edit; move Website and Account pages into it (old
   URLs redirect).
6. Platform log: list frame (already close — align).
Tests (incl. redirects, permissions, axe 1440/390, one primary) + screenshots into /home/claude/shots/plat/.
Ship as TWO PRs: PR 1 = company page (1); PR 2 = overview, client inquiry, plans, settings, log (2–6).
