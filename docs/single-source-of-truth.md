# Single source of truth

Every business fact lives in **one** place. Everything else either reads it through the shared helper
named below, or is a **frozen snapshot** of it (a copy taken on purpose at a moment that matters, never
kept in step afterwards, and labelled as such on screen). There is no sync code: nothing copies a fact
from one row to another to "keep them the same".

This is the outcome of the single-source-of-truth refactor (audit:
`docs/superpowers/specs/2026-11-03-single-source-of-truth-audit.md`, PRs 1–5). Keep it true.

## Rules for new work

1. Before adding a column, look the fact up below. If it is there, read it with the helper; do not store a copy.
2. If a value is worked out (a sum, a worst case, a date from a rule), work it out where it is read, with the
   one helper. If SQL needs it too, the SQL twin sits next to the helper and a test holds them equal.
3. A copy is allowed only as a frozen snapshot: what the customer accepted, what a final paper printed, a
   cash fact at its own rate. Say on screen that it is one ("as accepted", "final", "bought at").
4. The database holds what it can (triggers, unique keys) so a second truth cannot appear by accident.
5. Numbers given to the outside (receipts, requests, papers) are stored once and never worked out again.
6. Insights' calculated tables are not copies to keep in step: a new figure there is worked out in `compute.ts`
   with the helper named below (never a formula of its own), and the nightly check holds them to it.
7. A figure over many orders or inquiries (a month's sales, what customers owe, a win rate, profit and margin of a
   span) is read from those tables through `FactsReadService`, never added up again elsewhere. Home, the report
   (print, PDF, CSV, Excel), Leaks, targets and the summary emails do; `test/one-figure.test.ts` holds them equal
   to Insights for the same period and filters. Exceptions, on purpose (each built on the helpers below):
   Profit and loss month by month (`money.service.ts profitAndLoss`: by the day each cost and payment fell, which
   the tables do not date), one customer's account (`accounts.service.ts`), and lists that need "still owes" as a
   filter (`ordersWithMoneyDue`, the SQL twin). Leaks adds up only plain expenses (a deal's selling cost, factory
   visits), each at its own rate with `convert`, as Insights' cash does.

## Where each fact lives

| Fact | The one place | Read it with | Notes |
|---|---|---|---|
| What the customer owes, the deposit, what came in, paid / part paid / overdue | worked out from `Order.total`, the plan's deposit row, live `Payment` rows and expenses charged to the customer | `orderPosition` (`packages/money/src/position.ts`) through `positionOf` and `chargedOf` (`apps/api/src/modules/money/position.ts`); SQL twin `positionsSql` (`apps/api/src/modules/money/due.ts`) | Every screen, paper, list, reminder and report uses these. Never sum payments by hand. |
| A payment's currency | `Order.currency` | `payment.currency` always equals it | A database trigger refuses a payment in another currency and an order currency change under its payments, so readers do not filter on currency. What really arrived is `Payment.receivedAmount / receivedCurrency / rate` (a cash fact). |
| What we owe a factory, and what is left to pay | the factory price frozen on each `OrderLine` (`factoryUnitPrice`, tax rate, tax included), factory payments, expenses the factory bears | `factoryUnitCostMinor` (`packages/money/src/costing.ts`) → `factoryPosition` (`packages/money/src/position.ts`) through `factoryPositionOf` (api `money/position.ts`) and `owedByFactory` (api `money/factory-plan.ts`); SQL twin `factoryPositionsSql` | The PO, factory plan, Costs page and factory lists all read this. |
| Profit (on the quote, expected, earned, cash) | the order's costing | `orderCosting` and `orderMoney` (`packages/money/src/plan.ts`) through `costingsOf` (api `money/order-money.ts`) | Basis costs paid by expenses are the categories in `BASIS_COST_CATEGORIES`, in TypeScript and SQL. |
| What an LC draws | the plan's LC part | `lcBalanceMinor` (api `money/route-plan.ts`) | `OrderBankContract.amount` is only the amount on the LC, checked against it. |
| A quotation revision's total, discount and lead time | its `QuotationOption` rows | `revisionOption` / `revisionWorth` (`packages/shared/src/workflows/quotation.ts`); api `figuresOf` / `worthOf` / `optionFigures` (`apps/api/src/modules/quotations/revision-figures.ts`) | The accepted option, else Option A (labelled "Option A of 2"). A sent revision with several options is worth "lowest–highest" in reports and lists. The revision keeps no figures of its own. |
| How the customer pays (route, balance when, LC terms) | `Order.paymentRoute`, `balanceWhen`, `lcTerms`, `lcDays` | `routePaymentSentence`, `balanceTermsOf`, `routeAsAccepted` (`packages/shared/src/workflows/money-route.ts`) | The order starts on the route the accepted terms imply ("from the quotation"). |
| The payment plan and its due dates | `PaymentPlanItem` (amount, part, `dueRule`, `dueDays`; a date only for `fixed`) | `planItemDue`, `planItemLabel`, `livePlan`, `routePlan`, `rebuildPlan` (`money-route.ts`) | Due dates and labels are worked out live from the rule and today's dates; a rebuild keeps hand-edited rows. Factory plans: `FactoryPaymentPlan` with `factoryDueOn`. |
| A payment's kind (deposit / balance) | what the money settles (deposit still open → deposit) | `payments.service.ts` when recording | Only "other" is chosen by hand. |
| Ready date | `OrderFactory.readyOn`, one per factory | `factoryReadyOn` / `orderReadyOn` / `readyByFactory` (`packages/shared/src/workflows/ready.ts`); api `factoryReadyOf` / `readyOnOf` (`apps/api/src/modules/orders/ready.ts`) | The order's ready date is the latest of its factories'. |
| Ship by | `Order.shipBy` (our promise) | `shipByVsLc` | The LC's latest ship date stays on the bank contract and is shown beside it. |
| Shipped on, B/L or AWB, container, vessel, ports | `Shipment` | `primaryShipment` (Shipment 1 for the papers) and `portsOf` for a new shipment's ports from the incoterm (`packages/shared/src/workflows/shipment.ts`) | `Order.portOfDischarge` is only the contract destination (default for a new shipment). Shipped on = the earliest day a shipment left. |
| The buyer on the papers | `Order.buyerSnapshot` (`BuyerSnapshot`) | `buyerFrom` / `partyOf` (`apps/api/src/modules/orders/buyer.ts`), `buyerChanges` | Taken when the order is made; "Refresh from customer" (with a reason) takes it again. |
| Paper, receipt and request numbers | stored: `OrderPaper.number`, `Payment.receiptNo`, `PaymentPlanItem.requestNo` (counters `Order.lastReceiptNo / lastRequestNo`), `Order.proformaNo` | `paperNumber` when a paper is first made; `packingListNo` for the packing list (`packages/shared/src/workflows/papers.ts`); `nextReference` for references (`packages/database/src/counters.ts`) | Given once, never worked out again, never reused (voiding moves no other number). `Order.proformaNo` is an index of the final proforma paper. |
| What a paper printed | `OrderPaper.snapshot` (final) | the papers service | Final papers never move; "Make again" is a new version with the same number. |
| The condition the goods arrived in | the goods `OrderLine.deliveredQty / deliveredCondition` | `deliveryConditionOf` (`packages/shared/src/workflows/flow.ts`) | The worst line: damaged, then partly delivered, then minor damage, then good. "All delivered OK" marks the lines. The order keeps only a delivery note. |
| The factory test (FAT) | `OrderFactory.fatPlannedOn / fatDoneOn / fatResult / fatRemarks / fatAttendedBy` (one row per factory of the order) | `fatOf` (`apps/api/src/modules/papers/papers-data.ts`), the sections service (`PUT /orders/:id/factory-facts`) | The FAT report prints from it. There is no inspection report: an inspection certificate from outside is uploaded on Documents. |
| Where each stage of an order stands | the order's own data (payments, the factory order, ready dates, goods received, shipments, papers, delivery) | `stageWords` / `stageStands` (`packages/shared/src/workflows/order-sections.ts`), read by `GET /orders/:id/sections` | Never ticked and never stored: there is no checklist and no production timeline. |
| Packing (packages, weights, CBM) | `OrderLine` packing fields; `Order.packedAt` | the packing list paper | |
| Shipped on time | `Order.shipBy` and the shipments | `shippedOnTime` (`packages/shared/src/workflows/shipment.ts`) | Shipped by the ship-by date; unknown before shipping or without one. |
| A factory's goods actually ready, and late or not | the factory's goods lines (`receivedQty`, `receivedOn`) and the shipments | `factoryReadyActual` / `readyDelay` (`packages/shared/src/workflows/ready.ts`) | The day its last line came in full, or the day the order first shipped, whichever is earlier; against that factory's ready date. |
| Insights' figures per order, inquiry and order × factory | **calculated tables** `order_facts`, `inquiry_facts`, `factory_order_facts` (never typed, never kept in step by hand) | written only by `FactsService` (`apps/api/src/modules/insights/facts/compute.ts`) through the helpers above; read by `FactsReadService` (`GET /insights/facts/...`; Home, Reports, Leaks, targets and the emails call it too) | Triggers on the source tables queue what changed (`facts_queue`); the API works it off after each change and before each read; the worker rebuilds everything every night, compares, logs and fixes. Money in the main currency at the order's rate (factory money and quotations at today's Settings rates). They can always be thrown away and made again. |

## Frozen snapshots (copies on purpose) and their labels

| Snapshot | Frozen when | Label on screen |
|---|---|---|
| `Order.currency / total / depositPercent / balanceTerms / incoterm / incotermPlace` | the quotation is accepted | "as accepted" (the plan's deposit wins when edited: "50% plan; 30% as accepted") |
| `OrderLine` description, quantity, unit, prices | the order is made | the accepted lines |
| `OrderLine.factoryUnitPrice / taxRate / currency`, `OrderLine.unitCost`, `OrderCost` | the order is made | "bought at" / cost at the quote's rate |
| `Order.mainCurrency / mainRate` | the order is made | figures "at the order's rate" (Settings rates never move past months) |
| `QuotationRevision.customerSnapshot / companySnapshot` | the revision is sent | the quotation PDF |
| `Order.buyerSnapshot` | the order is made (or refreshed with a reason) | "Buyer as on the order · refresh from customer" |
| `OrderPaper.snapshot` | a paper is made final | the paper's version list ("final", "version 2") |
| `Payment.receivedAmount / rate`, `FactoryPayment.rate`, `Expense.rate` | the money moved (an expense: the day the cost is dated) | cash facts, at their own rate |

## One record made from another, on purpose

| Record | Made from | Kept in step by | Until |
|---|---|---|---|
| The order's freight and insurance costs (`Expense` with `source` = `shipment:<id>:freight` or `shipment:<id>:insurance`, `payLater`) | the shipment's `freightAmount` (unless the terms are "collect") and `insurancePremium` | `ShipmentCosts.sync` (`apps/api/src/modules/money/shipment-costs.service.ts`), called in the same transaction as every shipment save and removal; nothing else writes these rows, and the API refuses to change or remove one by hand | it is paid: from then on it is a cash fact (what was paid, at its rate) and the shipment no longer moves it |

Why this one exists: a cost counts in the order's profit, the reports, the cash book and the ledger through one
path, the expenses. Reading freight from the shipment in each of those would be several second truths; one
record made in one place is the smaller risk. `test/cost-sheet.test.ts` holds the two equal.

## Gone (do not bring back)

- `QuotationRevision.subtotal / discount / total / lead_time` — read the options.
- `Order.delivery_condition` and its `DeliveryCondition` database type — read the lines.
- `Order.blNo / shippedOn / containerNo` — read the shipment.
- `production_steps`, `order_checklist_items`, `checklist_templates`, `orders.checklist_seeded_at` — an order's stages read its own data.
- `datePlan` (plan dates copied once) — due rules, worked out live.
- Payment filters on `currency = order.currency` — the database holds it.
- Finding the FAT / inspection item by a regex on its title — bound by `paper`.
- Three packing-list number formulas — `packingListNo`.
- Insights' old overview (`GET /insights`, `computeOverview`), Reports' own funnel, profit and trend, Home's
  `moneyNow`, Leaks' own sums of payments and order expenses — the Insights tables (rule 7).
