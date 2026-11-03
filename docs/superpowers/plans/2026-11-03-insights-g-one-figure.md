# PR G · Home, Reports, Leaks on the same calculated tables

Data: PR B #96 facts tables + FactsReadService (/api/insights/facts/*, incl. /now from PR F #98).
Rules: docs/single-source-of-truth.md. UI rules: docs/superpowers/specs/2026-11-03-design-system.md.

1. Home (dashboard / reports.service dashboard(), moneyNow, workload, trend): every money and count figure
   reads the facts tables / FactsReadService (or the shared helpers for single records). Same figure, same
   label as Insights (e.g. "To receive", "Overdue", "Open quotes"). Keep Home's purpose (a person's day:
   what needs them) and its layout; align it to the Dashboard frame where cheap (PageHeader, tiles,
   StatusBadge) without a redesign.
2. Reports (/reports, /reports/money, CSV exports): read the facts tables; remove re-implemented formulas
   (reports.service report(), trend()). CSV columns keep their names (add new ones at the end if needed).
3. Leaks (money/leaks.service.ts): read order_facts / factory_order_facts; remove its own SQL formulas.
4. Old insights.service.ts computeOverview and any other code no longer used after PR F: delete. Reminders
   (reminders-list.service.ts) keep working; switch their money figures to the same source where they show
   amounts.
5. A parity test: for the demo data, Home, Reports, Leaks and Insights give identical numbers for the same
   period and filters. Grep check: no other module computes due/received/profit/margin on its own
   (document any intentional exception).
Screenshots of Home, Reports, Reports › Money before/after into /home/claude/shots/insG/.
