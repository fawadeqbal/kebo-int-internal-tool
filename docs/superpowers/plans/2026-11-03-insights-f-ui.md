# PR F · New Insights + Performance cards

Design (approved, canvas page 28): /home/claude/preview/Ins28Overview.png, Ins28Money.png, Ins28Customers.png,
Ins28Factories.png, Ins28Funnel.png, Ins28Phone.png (HTML /home/claude/canvas/project/Ins28*.dc.html).
Data: PR B #96 — FactsReadService / GET /api/insights/facts/* (orders/groups, inquiries/groups, funnel,
factories/groups, aging, cash, orders, status). Design system (PR A #95): PageHeader, SectionNav,
StatusBadge, EmptyState, DataTable, Pager, toast; spec docs/superpowers/specs/2026-11-03-design-system.md
(Dashboard frame: section list left, period picker in the header's action place, tiles, one chart one
axis, short lists). Chart rules: the dataviz skill's method — app chart colours --chart-1..5 (validated),
one axis per chart, thin marks, legend for ≥2 series, hover tooltip per month/mark, a "Table" view for
every chart, text in text colours.

1. /insights becomes the Dashboard frame with six sections (visible list; phone: chip row):
   Overview · Money · Customers · Factories · People · Funnel (URL ?section=…). One period picker
   (Month · Quarter · Year · Custom) + "vs previous" and Excel of the visible tables.
   - Overview: 8 tiles with change vs previous (sales, gross profit + margin, cash in, cash out, to receive
     + overdue, to pay factories, open quotes + likely value, win rate); 12-month sales bars + gross profit
     line; Needs attention (overdue customers, late factories, margin < 10%, quotes expiring) with links;
     top 5 customers, top 5 factories.
   - Money (money permission only): net cash, profit expected, profit so far, costs over plan; cash in/out
     by month with net line; owed to us by age; we owe factories by age (sequential one-hue ramp); profit
     by month expected vs now; costs by kind; money by currency; where money leaks.
   - Customers: tiles (ordered, repeat share, average order, sleeping); table with chips All/New/Repeat/
     Sleeping/Owe money; columns orders, sales, margin, paid on time, still owed, overdue, 6-month sparkline;
     row opens the customer.
   - Factories: table (orders, spend, ready on time, avg days late, offers won, to pay, claims).
   - People: table (inquiries, days to first quote, win rate, sales, target this month bar, profit); link
     to set targets (existing targets feature).
   - Funnel: inquiries → got prices → quoted → won (counts + value), lost reasons, by channel/country/product.
   Old Insights sections that the new design doesn't have: keep their data reachable (fold into the
   nearest section) — list anything dropped in the PR body.
2. `PerformanceCard` component (Year · All time switch) on the customer, factory and user pages (place it
   at the top of the current page's main column; PR D moves pages into the record frame later):
   customer: orders, sales, profit/margin, win rate, paid on time, still owed/overdue, last order, days to
   pay; factory: orders, spend, ready on time, avg days late, offers won, to pay, claims, last order;
   user: inquiries, days to first quote, win rate, sales vs target, profit.
3. Permissions as today (reports.view to see Insights; money figures only with the money permission).
4. Tests (API/web) + axe check on each section; screenshots of every section (1440 + 390) and the three
   Performance cards into /home/claude/shots/insF/; compare with the Ins28 PNGs.
