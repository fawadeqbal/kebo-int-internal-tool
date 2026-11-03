# Single-source-of-truth audit — RFQ Desk (inquiry → completed order)

Read-only audit of `/home/claude/kebo-int-internal-tool` at branch `feat/overview-panel`. No code was changed.
Paths below are relative to the repo root. Line numbers are from this branch.

**What this covers:** the schema (`packages/database/prisma/schema.prisma`), the API (`apps/api/src/modules/*`), the shared rules (`packages/shared/src/workflows/*`), the money package (`packages/money/src/*`), the order screens (`apps/web/src/components/orders/*` and `apps/web/src/app/(app)/orders/[id]/*`), and both paper systems:
- **Old order documents:** proforma and packing list, built in `apps/api/src/modules/orders/documents.service.ts` and printed by `apps/web/src/app/print/orders/[id]/[kind]/page.tsx`.
- **New papers:** built in `apps/api/src/modules/papers/papers-data.ts` and `papers.service.ts`, using `packages/shared/src/workflows/papers.ts`.

**Overall verdict.** The order checklist is in good shape. Its automatic items are worked out from the data (`workflows/checklist.ts`), and the new papers have a "draft → final + snapshot" model. The rest of the order flow is not, for two reasons:

1. **Two generations of fields live side by side.** The first version kept everything on `Order` (`shippedOn`, `blNo`, `containerNo`, `portOfDischarge`, `readyOn`). Later versions added `Shipment`, `OrderBankContract`, `PaymentPlanItem` and `FactoryPaymentPlan` for the same facts. Both sets are still written, and both are still read, by different screens and papers.
2. **Money formulas are copied, not shared.** "Received / due" is worked out by **17** separate calls to `settle(...)`. "Profit" has **5** formulas. "Factory owed" has **4** places, and one of them, the purchase order, leaves the tax out.

---

## 1. Top 10 findings by business risk

| # | Risk | Finding | Example of the drift |
|---|---|---|---|
| 1 | **Paper to factory is wrong** | The purchase order prints factory prices **without tax** and its total is `price × qty`, yet it says *"Prices include 13% tax"*. Our ledger (`owedByFactory`) owes `price × (1+tax) × qty`. (`papers-data.ts:384,421,429` vs `money/factory-plan.ts:22`) | Line at CNY 100, 13% tax, qty 10. The PO total says **CNY 1,000 "incl. tax"**; the Money tab says we owe **CNY 1,130**. The factory invoices 1,130 against a PO for 1,000. |
| 2 | **Bank papers can disagree with each other** | Packing list vs commercial invoice and shipping advice. The packing list prints `Order.blNo`, `Order.shippedOn`, `Order.containerNo` and the ports worked out from the incoterm (`print/orders/[id]/[kind]/page.tsx:172-191`, `documents.service.ts:83,95,128`). The CI and shipping advice print `Shipment.blNo ?? Order.blNo`, `Shipment.departedOn ?? Order.shippedOn`, `Shipment.containerNo ?? Order.containerNo` and the shipment's ports (`papers-data.ts:314-320,447,460`). | B/L typed on the shipment as `MEDU123` and later corrected to `MEDU124`. `followFlow` only copies the B/L to the order when the order's is empty (`orders.service.ts:820`). The packing list keeps `MEDU123`, the CI prints `MEDU124`, and the LC presentation has a discrepancy. |
| 3 | **Bill of exchange can draw the wrong amount** | `lcAmount()` falls back to the **whole order total** when the LC amount is empty (`papers-data.ts:830-835`). The LC check uses the **balance after deposit** (`route-plan.ts:84-87 lcBalanceMinor`). | 30% deposit already received, LC amount left blank. The bill of exchange and cover letter draw for 100% of the order, while the LC covers 70%. |
| 4 | **Proforma changes after it was issued** | The proforma is a "live" document: its number is frozen, its content is not. It reads `Order.balanceTerms`, which `setRoute` rewrites later (`flow.service.ts:535` → `balanceTermsOf`), and it reads the live bank details, customer and lines. Old order documents have no snapshot (`documents.service.ts`). | PI issued saying *"70% before shipment"*. Later the route is set to LC. Re-printing the same PI number now says *"70% letter of credit"*, which is not what the customer received. |
| 5 | **Deposit % is stored 3 times and can disagree** | `QuotationRevision.depositPercent` → copied to `Order.depositPercent` → turned into amounts in `PaymentPlanItem`. `setPlan` lets a manager change the instalments (`money.service.ts:444-487`), but the deposit gate, "deposit received", the proforma sentence and plan rebuilds all read `Order.depositPercent` (`settle(..., depositPercent)` in 17 places, `routePlan` in `route-plan.ts:44`). | Plan edited to a 50% deposit. The checklist ticks "Deposit received" once 30% arrives, the proforma says 30%, and changing the route **rebuilds the plan back to 30/70**. |
| 6 | **"Still due" differs by screen** | Only the Money tab adds expenses charged to the customer (`money.service.ts:229-231`). The order header, orders list, overview fallback, receipts, payment requests, the statement, reminders and reports use `total − settled` (`workflows/order.ts:38 dueOf`, `papers-data.ts:163-173`, `papers.service.ts:193-223`, `due.ts:12-22`). The overview switches between the two depending on whether the money data loaded (`overview.tsx:82`). | USD 800 inspection charged to the customer. The Money tab shows USD 800 due; the order page, the customer statement and the payment request all say **paid in full**. |
| 7 | **Receipt and payment-request numbers move** | These live papers are numbered by their position in a list: receipts by index among **non-voided payments sorted by date** (`papers.service.ts:469-476`, `papers-data.ts:526-529`), requests by index in the plan (`papers.service.ts:491-498`, `papers-data.ts:594`). Nothing is stored. | The customer holds receipt **RC-2026-0031-2**. Payment 1 is voided, or a back-dated payment is recorded, and RC-…-2 now shows a different payment. A plan rebuild renumbers the PRs the same way. |
| 8 | **Shipment facts in two places, with half-way sync code** | `Order.shippedOn / blNo / containerNo / portOfDischarge` vs `Shipment.departedOn / blNo / containerNo / portOfDischarge`. Copies happen only once: `followFlow` sets them at the stage change (`orders.service.ts:816-821`); a new shipment copies the order's ports (`shipping/page.tsx:195`, `light-actions.ts:77-78`, `papers.service.ts:850`). The Details card still lets people type "Shipped on" and "B/L no." on the order (`orders/[id]/forms.tsx:216-224`). | B/L edited in the Details card after a shipment exists: the CI and shipping advice ignore it (the shipment wins), while the Details card shows it. The payment-plan balance date, the Insights "shipped on time" KPI (`insights.service.ts:299-306`) and the packing list use the stale `Order.shippedOn`. |
| 9 | **Due dates set from a date nobody updates** | The customer balance due date is set **once**, at the stage move, from `readyOn` / `shippedOn` and only when empty (`orders.service.ts:857-865`). Later edits to `readyOn` / `shippedOn` (`setDetails`, paper fix, shipment `departedOn`) never re-date it. The factory plan's "on ready" date is worked out live from `Order.readyOn` (`factory-plan.ts:76-79`). | Ready date moves from 1 Mar to 1 Apr. The factory balance moves to 1 Apr, the customer "before shipment" balance stays due 1 Mar, and reminders call it late. |
| 10 | **"Factory still to pay" differs by screen** | The Money tab's factory rows subtract expenses borne by the factory (`money.service.ts:263-282`). The factory payment-plan card (`factory-plan.ts:83`), the "owing factories" list (`due.ts:35-55`), the Costs page (`costs.service.ts:98-103`) and the purchase order do not. | CNY 5,000 inspection charged to the factory. The factory row says "paid in full"; the plan card says the balance of CNY 5,000 is **late**, and reminders nag. |

Close behind: the CI / sales contract / proforma take the customer's name and address from the quotation snapshot, merged field by field (§3.6). The LC route is asked for again although the quotation already said LC (§4). The "ship by" date has three sources (§3.4). The profit formulas differ by screen (§5).

---

## 2. Inventory: every business fact stored more than once

Key to the "Kind" column:
- **SNAP**: a legitimate frozen snapshot (keep it, label it).
- **DUP**: a live duplicate that can drift (fix it).
- **MIRROR**: a derived copy kept in step by sync code.
- **DEAD**: unused.

| Fact | Stored in | Written by | Read by | Kind | Note |
|---|---|---|---|---|---|
| Customer name / address / tax / reg no. | `Customer.*`; `QuotationRevision.customerSnapshot` (schema 929) | snapshot on send (`quotations.service.ts:725`) | quotation PDF (web `print/data.ts:customerOr`, all-or-nothing); order papers (`papers.service.ts:184-190`, `documents.service.ts:46-51`) **merge snapshot over live, field by field** | SNAP for the quotation; **DUP for order papers** | A fixed address never reaches the contract, CI or proforma. The web and the API merge differently. |
| Company letterhead | `Settings.company`; `QuotationRevision.companySnapshot`; `OrderPaper.snapshot.company` | — | quotation (snapshot); proforma and packing list (live); new papers (live until final) | SNAP (quotation, final papers) / live (proforma) | The stamp is never frozen (`quotations.service.ts:75-79`). |
| Currency | `QuotationRevision.currency` → `Order.currency` → `Payment.currency` (always equals the order's), `OrderBankContract.currency` (typed) | `createFromRevision:234`; bank contract form | everywhere; every `settle` filters `p.currency === o.currency` | SNAP (order) / redundant (payment) / **DUP (LC currency typed)** | `Payment.currency` cannot differ from the order's, yet 17 call sites filter on it. |
| Incoterm + place | `QuotationRevision.incoterm/incotermPlace` → `Order.incoterm/incotermPlace` | `createFromRevision:238-239` | papers, overview, `portsOf` | SNAP | Not editable on the order: fine. Label it "as accepted in R2". |
| Port of loading | `Shipment.portOfLoading`; derived from `Order.incotermPlace` for E/F terms | shipment form, **prefilled from `incotermPlace` regardless of the term** (`shipping/page.tsx:195`, `light-actions.ts:77`) | papers `portsOf` (`papers-data.ts:176-183`), forwarder defaults (`flow.service.ts:1184`) | **DUP** + bug | On CFR/CIF, `incotermPlace` is the *destination*, and it is pre-typed as the loading port. |
| Port of discharge | `Order.portOfDischarge`; `Shipment.portOfDischarge`; `Inquiry.requirements` (free text) | Details card (`forms.tsx:222`), paper fix (`papers.service.ts:880`), shipment form, copied into new shipments | proforma and packing list (order), CI and shipping advice (shipment first), overview (`overview.tsx:70`, shipment first), checklist "Arrived at …" (`checklist.ts:411`, shipment) | **DUP** | |
| Deposit % | `QuotationRevision.depositPercent` → `Order.depositPercent`; implied by `PaymentPlanItem.amount` (+ label text "Deposit 30%") | `createFromRevision:236`; `setPlan` changes only the plan | `settle(...)` ×17, proforma and contract sentence, `routePlan` | SNAP (order) + **DUP (plan)** | See top #5. |
| Balance terms | `QuotationRevision.balanceTerms` → `Order.balanceTerms`; `Order.balanceWhen / lcTerms / lcDays / paymentRoute` | `createFromRevision:237,291`; **`setRoute` overwrites `Order.balanceTerms` from the route** (`flow.service.ts:535`, `money-route.ts:174`) | proforma (`documents.service.ts:105-107`), sales contract (`papers-data.ts:295`), order Details "Payment terms", `datePlan` (`orders.service.ts:860-862`) | **MIRROR** | One field is half snapshot (from the quote), half live (from the route). |
| Payment terms / delivery terms / notes text | `QuotationRevision.paymentTerms/deliveryTerms/notes` only | revision editor | quotation, proforma (`documents.service.ts:150-157`), sales contract bullets (`papers-data.ts:297,304`), payment request (`papers-data.ts:625`) | SNAP | It contradicts the route once the route differs: the quotation said "By T/T", the route is LC, and the contract prints both. |
| Lead time | `FactoryQuote.leadTime` → `QuotationOption.leadTime` (prefilled in `draft`) → `QuotationRevision.leadTime` (mirrors option A, then the accepted option: `quotations.service.ts:555,753`) | revision save, accept | proforma (`rev.leadTime`), sales contract (`rev.leadTime`), `defaults()` (`option.leadTime ?? rev.leadTime`, `flow.service.ts:1232`) | SNAP (option) + **MIRROR (revision)** | |
| Revision subtotal / discount / total | `QuotationOption.*` and `QuotationRevision.*` (mirror of option A, then the accepted option) | `quotations.service.ts:555-558,753-756` | reports "quoted" (`reports.service.ts:156`), leaks (`leaks.service.ts:342`), `linesOf` discount (`papers-data.ts:152`, `documents.service.ts:67`) | **MIRROR** | A sent multi-option revision counts as option A's value in the pipeline. |
| Order total | `Order.total` (= option total); recomputed from `OrderLine` + `revision.discount` in papers | `createFromRevision:235` | money (`o.total`); papers and proforma (`documentTotals(lines, rev.discount)`) | SNAP + **two formulas** | They agree today only because the order's lines and the revision's discount never change. |
| Line description / qty / price | `QuoteLine` → `OrderLine` | `createFromRevision:249-264` | everywhere | SNAP (legitimate) | |
| Unit cost | `FactoryQuoteLine.unitPrice/taxRate` → `QuoteLine.unitCost` (+ `fxRate`) → `OrderLine.unitCost` (no `fxRate`) | `quotations.service.ts:474`, `createFromRevision:258` | profit everywhere | SNAP | Label it "cost at quote FX". |
| Factory price / tax / currency | `FactoryQuoteLine.*` → `OrderLine.factoryUnitPrice/TaxRate/Currency` | `createFromRevision:260-263` | owed (×3 with tax), **PO without tax** | SNAP + **two formulas** | See top #1. |
| Factory plan amounts | `FactoryPaymentPlan.percent` **and** `.amount` (copied from owed when seeded) | `seedFactoryPlans` (`factory-plan.ts:112-128`), plan editor | factory plan card (`differs`) | SNAP-ish | Two ways of saying one number; `differs` is shown when they no longer match. |
| Factory payment terms | `FactoryQuote.paymentTerms` (typed text); `Settings.sales.factoryAdvancePercent`; PO bullet hard-coded (`papers-data.ts:431`) | — | the plan is seeded from Settings, not from the offer | **DUP / ignored fact** | |
| Ship-by (promised) | `Order.shipBy`; `OrderBankContract.latestShipOn`; `Inquiry.requiredBy` | Details card, paper fix, bank contract form | sales contract (`shipBy`), overview deadlines (both), shipping page (`latestShipOn ?? shipBy`, `shipping/page.tsx:91`), Insights on-time (`shipBy`) | **DUP** (3 sources, 3 reading rules) | |
| Ready date | `Order.readyOn` (one date for every factory); dead `ProductionStep` table | `moveStage:747`, `setDetails:1100`, paper fix | PO (per factory, same date), factory plan "on ready", customer `datePlan` (once), LC check | DUP across time (see top #9) | |
| Shipped on | `Order.shippedOn`; `Shipment.departedOn` | `moveStage`, `followFlow` (once), `setDetails`, Details card | CI and shipping advice (shipment first), packing list (order), checklist (shipment if the module is on, else order), payment plan, Insights | **DUP + sync** | |
| B/L number | `Order.blNo`; `Shipment.blNo`; `OrderDocument(bill_of_lading).number` | Details card, `moveStage`, `followFlow` (only if empty), shipment form, document form, paper fix (either) | CI, shipping advice, cover letter (`doc.number → shipment → order`, `papers-data.ts:934-940`), packing list (order), checklist `doc:bill_of_lading` (`f.blNo`, `checklist.ts:474`) | **DUP ×3** | |
| Container no. | `Order.containerNo` (packing form); `Shipment.containerNo` | `savePacking:950`, `setDetails:1105`; shipment form | packing list (order), shipping advice (shipment first), checklist "Loaded" (shipment) | **DUP** | |
| Packing (packages, weights, CBM) | `OrderLine.*` only; `Order.packedAt` | packing form / line edit | packing list, shipping advice, checklist | single source | It assumes one shipment per order: splitting into two shipments cannot split the packing. |
| Proforma number / status | `Order.proformaNo/IssuedOn`; optional `OrderDocument(proforma_invoice).number/status` | `issueProforma`; document form | flow `documentIn` **prefers document rows if any exist** (`flow.service.ts:89-93`); cover letter prefers the row number (`papers-data.ts:935-937`) | **DUP** | A hand-made row can hide the issued PI. |
| Packing-list number | worked out in 3 places: `documents.service.ts:80`, `papers.service.ts:449`, `papers-data.ts:938` | — | — | three formulas (same result today) | |
| Paper numbers (SC / CI / IR) | `OrderPaper.number`; `OrderDocument.number` (copied at final, `papers.service.ts:752-760`; can also be typed in the document form); checklist item `data.number` (`papers.service.ts:765`) | final | paper list, cover letter, checklist | SNAP (at final) + **DUP (typed)** | |
| Receipt / payment-request numbers | not stored; worked out from list position | — | live papers | **unstable** | See top #7. |
| Payment kind | `Payment.kind` (deposit/balance, typed); the plan allocation (oldest first) | payment form | receipt "Deposit for order …" (`papers-data.ts:553`) | **DUP** | The receipt can say "Balance" while the money settled the deposit. |
| LC / contract amount | `OrderBankContract.amount` (typed); `lcBalanceMinor` (derived) | bank contract form | LC checks (derived balance), bill of exchange and cover letter (typed, else the **order total**) | **DUP + inconsistent fallback** | See top #3. |
| LC clauses | `OrderBankContract.note` (free text) | contract form | beneficiary certificate bullets (`papers-data.ts:874`) | overloaded field | |
| Delivery condition | `Order.deliveryCondition/Note`; `OrderLine.deliveredCondition/deliveryNote` | delivery form; line edit; "all good" writes both | delivery note (line first, else order) | **DUP** | The order can say "good" while a line says "damaged". |
| FAT / inspection results | `OrderChecklistItem.data` (JSON), found by `paper` or by a **regex on the title** (`papers-data.ts:634-641`) | checklist fill | FAT / inspection report | single, but fragile | Renaming the item loses the report. |
| Order customer / inquiry | `Order.customerId`, `Order.inquiryId` (both derivable from the revision); `Expense.customerId/inquiryId`; `Payment.customerId` | creation | lists, filters | redundant foreign keys, guarded (`inquiries.service.ts:409-414`, `money.service.ts:896-903`) | Low risk. |
| Production timeline | `ProductionStep` (table) — **unused**; checklist `step=production` rows are the truth | — | — | **DEAD** | |

---

## 3. Detailed findings

### 3.1 Factory owed: four formulas, one of them on a paper (top #1, #10)

| Where | Formula | Tax | Takes off expenses the factory bears |
|---|---|---|---|
| `money/factory-plan.ts:15-29 owedByFactory` (Money tab, factory plan, seeding) | Σ round(price×(1+t)) × qty | ✔ | Money tab rows ✔ (`money.service.ts:263-282`); plan card ✘ (`factory-plan.ts:83-90`) |
| `money/due.ts:28-55 ordersOwingFactories` (SQL) | the same, in SQL | ✔ | ✘ |
| `money/costs.service.ts:98-103` | the same, per currency | ✔ | ✘ |
| `papers/papers-data.ts:384,421` (purchase order) | Σ price × qty (JS floats) | **✘**, but prints "Prices include X% tax" | ✘ |

Other problems on the purchase order:
- The currency falls back to `"CNY"` (`:382`).
- The "balance before the goods leave the factory" sentence is hard-coded (`:431`). It ignores both `FactoryPaymentPlan` and `FactoryQuote.paymentTerms`.

### 3.2 Customer money: 17 copies of `settle()`, one with charged expenses (top #5, #6)

`settle(total, payments.filter(currency), depositPercent)` is called in:
- `orders.service.ts:469`
- `flow.service.ts:134`
- `checklist-facts.ts:43`
- `route-plan.ts:39`
- `documents.service.ts:69`
- `papers.service.ts:201`
- `papers-data.ts:165` (with the total **re-computed from lines**)
- `payments.service.ts:34,96,192`
- `reminders.service.ts:119,171`
- `reports.service.ts:150`
- `insights.service.ts:407,828`
- `costs.service.ts:89`
- `money.service.ts:196`

There is also an SQL version in `due.ts:12-22`.

Only `money.service.ts:229-231` adds `borneBy='customer'` expenses to what is due. The plan must add up to `Order.total` (`money.service.ts:451-455`), so charged expenses can never be in the plan either.

"Deposit received" and the deposit gate are worked out from `Order.depositPercent` in `flow.service.ts:128-142` and `checklist-facts.ts:51` (the same formula, copied). The plan's deposit item is never consulted.

### 3.3 Shipment facts in two generations (top #2, #8)

**Write paths for B/L and ship date:**
- `Order.blNo`: `moveStage:751`, `followFlow:820` (only when empty), `setDetails:1102`, paper fix when there is no shipment (`papers.service.ts:845`).
- `Shipment.blNo`: shipment form, light rows, paper fix (`papers.service.ts:844`).
- `Order.shippedOn`: `moveStage:750`, `followFlow:819` (only on the stage change; once the order is "shipped" it returns early, `:813`), `setDetails:1101`.

**Read paths that disagree:**

| Reader | B/L | Date | Container | Ports |
|---|---|---|---|---|
| Packing list (old print page) | `o.blNo` | `o.shippedOn` | `o.containerNo` | incoterm place + `o.portOfDischarge` |
| Commercial invoice | `s.blNo ?? o.blNo` | `s.departedOn ?? o.shippedOn` | — | shipment, else derived |
| Shipping advice | `s.blNo ?? o.blNo` | `s.etd / eta` | `s.containerNo ?? o.containerNo` | shipment, else derived |
| Cover letter | `doc.number ?? s.blNo ?? o.blNo` | — | — | — |
| Overview (`overview.tsx:69`) | shipment with dates (**not** `shipments[0]`) | — | — | `ship?.pod ?? o.pod` |
| Papers, checklist | `shipments[0]` by `createdAt` | | | |
| LC check (`route-plan.ts:111`) | first shipment with an ETA | | | |
| Details card | `o.blNo` / `o.shippedOn` (editable) | | | |
| Insights on-time KPI | — | `o.shippedOn` vs `o.shipBy` | | |

With two shipments, the overview, the papers and the LC check can each pick a different one.

### 3.4 Ship-by: three sources, three reading rules

- `Order.shipBy`: typed in the Details card or the paper fix.
- `OrderBankContract.latestShipOn`: typed in the LC form.
- `Inquiry.requiredBy`: typed at the inquiry and never offered as the default.

How each screen reads them:
- Sales contract: `shipBy` only (`papers-data.ts:247,279,298`).
- Shipping page: `latestShipOn ?? shipBy` (`shipping/page.tsx:91`).
- Overview deadlines: both, separately (`overview.tsx:160-161`).
- LC check: compares `latestShipOn` with `readyOn`, never with `shipBy` (`money-route.ts:202+`).

So the contract can promise a date later than the LC allows, and nothing flags it.

### 3.5 Terms: snapshot vs live route

`Order.balanceTerms` starts as a snapshot of the accepted revision. Then `setRoute` overwrites it from `paymentRoute/balanceWhen/lcTerms` (`flow.service.ts:533-536`, `money-route.ts:174-180`). So the "Payment terms" row in Details, the proforma sentence and the sales contract sentence quietly change after the customer accepted.

At the same time, the quotation's free-text `paymentTerms` (for example "By T/T") is still printed under the new route. The proforma and contract can print three contradictory payment statements:
- `paymentSentenceOf`,
- `routeLine`,
- `rev.paymentTerms`.

`after_arrival` (`BalanceTerms`) has no route at all, so `balanceWhenOf` gives null and the order starts with no route terms.

### 3.6 Customer on the papers

`papers.service.ts:184-190` and `documents.service.ts:46-51` read `{...customerNow, ...snapshotNonEmpty}`: values from the quotation (frozen at send) win, and only blanks come from the current customer. A corrected legal name or address never reaches the sales contract, CI or proforma. Nothing on the Make page says the buyer comes "as on Quotation R2".

The web quotation print (`apps/web/src/components/print/data.ts:customerOr`) uses a different rule: the whole snapshot if it has a name, otherwise the whole live record, and it drops `regNo`.

### 3.7 Payment plan dating (top #9)

`datePlan` (`orders.service.ts:857-865`) dates only rows with `dueOn: null, dueRule: null`, only on a forward stage move, and from the date given at that moment. Nothing re-dates when:
- `setDetails` changes `readyOn` or `shippedOn`,
- a shipment's `departedOn` changes.

`rebuildRoutePlan` (`route-plan.ts:54-62`) uses a slightly different rule ("informal or none, and not against the B/L copy" vs `balanceTerms === "before_shipment"` in `datePlan`). The factory plan's "on_ready" row reads `Order.readyOn` live (`factory-plan.ts:76`). So the customer and factory balance dates follow different rules.

### 3.8 Live papers without stored numbers (top #7)

`payment-receipt`, `payment-request` and `customer-statement` are in `LIVE_PAPERS` (`workflows/papers.ts:185`). They are never stored, and their number is `paperNumber(refNo, kind, index+1)`:
- the receipt index comes from `payments where voidedAt null orderBy paidOn`,
- the request index comes from the plan's `sortOrder`.

A receipt is a document the customer keeps, so its number must never change.

### 3.9 The proforma is not snapshotted (top #4)

The new papers freeze `snapshot` on final (`papers.service.ts:745-746`). The proforma, once its number is issued, keeps re-reading the order, the revision, the live route (`balanceTerms`), the live bank details and the live customer merge (`documents.service.ts:53-160`). The packing list is the same: it is dated `shippedOn ?? today` and never frozen.

### 3.10 Profit: five formulas with different names

| Screen | Formula | Source |
|---|---|---|
| Money tab "Earned" | costed revenue − goods (unitCost) − basis − (our expenses − covered) − bank charges | `money.service.ts:302-321` → `orderProfit` |
| Costs page "Expected" | costed revenue − goods − planned − not planned − bank charges | `costs.service.ts:95-96` (`plannedAndSpent`) |
| Reports "Profit" | line revenue − line cost − basis as an extra line (no expenses) | `reports.service.ts:255-279` (re-implements `orderCosting`) |
| Insights gross profit | `orderProfit` with expenses = 0 | `insights.service.ts:262` |
| Leaks "planned vs actual" | `orderProfit`, plus its own SQL with **hard-coded basis categories** `('freight','inland_transport','customs','insurance')` instead of `BASIS_COST_CATEGORIES` | `leaks.service.ts:159-161` |

"Cash" comes in two versions: `orderProfit.cashMinor` (received excluding bank charges, minus factory paid at payment rate, minus *all* expenses) and the leaks SQL (`receivedMinor` *including* bank charges, `leaks.service.ts:155-156`). "Received" in Reports excludes bank charges (`reports.service.ts:159-167`); "Received" on the order page includes them (`settledMinor`).

### 3.11 Smaller items

- **Revision mirrors option A.** `QuotationRevision.subtotal/discount/total/leadTime` are copied from Option A on save and from the chosen option on accept (`quotations.service.ts:554-558,748-757`). Reports and leaks sum `revision.total`, so a 3-option revision counts as option A only.
- **Delivery condition on two levels** (`flow.service.ts:978`, `orders.service.ts:1067-1070`). "All good" writes both; a later line edit to "damaged" leaves the order saying "good".
- **Factory plan stores percent and amount** (`factory-plan.ts:117-125`).
- **`PaymentPlanItem.label` holds the percent as text** ("Deposit 30%"), so it goes stale after `setPlan`.
- **`Payment.currency` duplicates the order's currency.** Every reader filters on it; a mismatch would silently drop money from "received".
- **Two order-document tables for one kind.** `OrderDocument(proforma_invoice | packing_list)` rows can exist next to `Order.proformaNo/packedAt` (`flow.service.ts:89-93`, `papers.service.ts:392-394`, `checklist.ts:461-467`). The rule "rows win if any exist" means a hand-made "missing" proforma row hides an issued PI.
- **The PL number is worked out three ways** (`documents.service.ts:80`, `papers.service.ts:449`, `papers-data.ts:938`).
- **The dead `ProductionStep` model** (schema 1312-1330): no reads or writes in `apps/api/src`.

---

## 4. Places the user re-types something the system knows

| Screen / form | Asks for | Already known as | Fix |
|---|---|---|---|
| Order Details card (`orders/[id]/forms.tsx:216-224`) | Shipped on, B/L no. | `Shipment.departedOn/blNo` once the shipping module is on | Show them read-only, "from Shipment 1 · edit there". Keep them editable only without the shipping module. |
| Order Details card | Port of discharge | quotation `incotermPlace` (C/D terms), shipment POD, inquiry requirements | Default it from the incoterm for C/D terms; show the shipment's value read-only once a shipment exists. |
| Order Details card | Ship by | `Inquiry.requiredBy`, quote lead time + order date, LC `latestShipOn` | Pre-fill it with a suggestion; warn when it is later than the LC's latest ship date. |
| Shipment form, new (`shipping/page.tsx:195`, `light-actions.ts:77-78`) | Port of loading / discharge | derived (`portsOf`) | Use the shared `portsOf` (E/F terms → loading, C/D → discharge); the current prefill is wrong for C/D terms. |
| Payment route (after acceptance) | Route = LC / informal, balance when | `revision.balanceTerms` (`letter_of_credit`, `against_bl_copy`…) | Start the order with the route implied by the accepted terms (`createFromRevision` sets `route: null` at `:277`). |
| Bank contract form (`flow-forms.tsx:217-224`) | Amount + currency | `lcBalanceMinor` + order currency | Pre-fill both; show the difference as an LC check (it already exists). |
| Bank contract form | Our bank | `Settings.company.bankDetails`, the last contract (`defaults()`) | Pre-fill (partly done through `defaults.banks`). |
| Packing form (`savePacking`) | Container no. | `Shipment.containerNo` | Remove it from the packing form when shipping is on; read it from the shipment. |
| Payment form | Kind (deposit / balance) | the plan allocation | Work it out from which instalment the money settles; keep a manual override only for "other". |
| Factory payment plan seed | Advance % | `FactoryQuote.paymentTerms` (text) | Add a structured `advancePercent` to the factory offer, use it for the seed, and print it on the PO. |
| Document form (`flow-forms.tsx:398-437`) | Number for CI / SC / proforma / packing list | `OrderPaper.number`, `Order.proformaNo` | Hide the number field for kinds the app makes (read-only from the paper). |
| Checklist "Sales contract signed by both" (upload, ticked by hand) | — | `OrderDocument(sales_contract)` + attachment | Tick it when a signed copy is uploaded on the `sales_contract` document row (new status `signed`), or keep it and link the two. |
| Checklist "FAT / Pre-shipment inspection" (fill: date, result) | free-text result | — | Fine as the single source, but bind the paper to the item by `paper` key, not by a regex on the title. |

---

## 5. Sync code (where a copy is kept in step)

| Code | What it copies | Verdict |
|---|---|---|
| `orders.service.ts:816-821 followFlow` | shipment `departedOn/blNo` → `Order.shippedOn/blNo` (once, and the B/L only when empty) | Remove: read from the shipment. |
| `flow.service.ts:533-536 setRoute` → `balanceTermsOf` | route → `Order.balanceTerms` | Remove: print terms from the route; keep `balanceTerms` frozen as accepted. |
| `quotations.service.ts:554-558, 748-757` | option → revision subtotal/discount/total/leadTime | Remove the mirror: read the accepted option (or option A for drafts). |
| `orders.service.ts:291` | `balanceWhenOf(rev.balanceTerms)` → `Order.balanceWhen` | Keep as the starting value. Also set `paymentRoute`. |
| `orders.service.ts:857-865 datePlan` | ready/ship date → `PaymentPlanItem.dueOn` (once) | Replace with a due rule (`on_ready`, `on_ship+N`) worked out live, like `FactoryPaymentPlan` already does. |
| `papers.service.ts:745-766 final` | paper number → `OrderDocument.number`, checklist `data.number` | Acceptable (it is the act of making it final); make `OrderDocument.number` read-only for app papers. |
| `papers.service.ts:847-851` paper fix | `o.portOfDischarge`, `o.blNo` → new shipment | Remove once the order-level columns are gone. |
| `shipping/page.tsx:195`, `light-actions.ts:77-78` | order ports → new shipment | Replace with derived defaults (`portsOf`), shown as suggestions. |
| `factory-plan.ts:112-128 seedFactoryPlans` | owed → plan amounts | Acceptable as the agreement; store the percent as the truth and work out the amount, or keep the amount and show `differs` (already done). |

---

## 6. Snapshots to keep (legitimate, but label them)

| Snapshot | Why it is legitimate | Label to add |
|---|---|---|
| `Order.currency/incoterm/incotermPlace/depositPercent/balanceTerms/total` | what the customer accepted | "As accepted · QUO-… R2 Option A" with a link to the revision (no edit). |
| `OrderLine.description/qty/unit/unitPrice/lineTotal` | the accepted lines | the same |
| `OrderLine.factoryUnitPrice/TaxRate/Currency` | the price we bought at | "Bought at · offer FQ-… dd mmm" (`differs` flag when the offer changed) |
| `OrderLine.unitCost`, `OrderCost.*`, `Order.mainRate` | the costing at quote time / the FX rate when ordered | "Cost at quote rate" |
| `QuotationRevision.customerSnapshot/companySnapshot` | what the quotation was sent to and from | — (quotation only; see PR 2 for papers) |
| `OrderPaper.snapshot` (final) | exactly what was printed | the version list already shows it |
| `Payment.receivedAmount/rate`, `FactoryPayment.rate`, `Expense.rate` | cash facts | — |

---

## 7. Proposed fix for each finding

| # | Truth becomes | The others become | Migration | UI |
|---|---|---|---|---|
| 1 Factory owed | one shared `owedByFactory` (with tax, minus factory-borne expenses), in `@kebo/money` and the SQL helper | the PO uses it (shows net, tax and total); `factoryPlansOf`, `ordersOwingFactories` and the Costs page use the same function | none | The PO shows "Unit price (excl. tax) · Tax · Amount incl. tax". The plan card and factory rows show the same "to pay". |
| 2, 8 Shipment facts | `Shipment` (B/L, departed, container, ports, vessel). An order with no shipping module gets one implicit shipment row. | Drop `Order.blNo`, `shippedOn` and `containerNo` (or make them views: `shippedOn = min(departedOn)`). `portOfDischarge` stays on the order only as the "contract destination", used to default the shipment POD. | Backfill: for each order with `blNo/shippedOn/containerNo` and no shipment, create a shipment (`mode=sea`, status from the stage). Where both exist and differ, keep the shipment's and record the order's in an audit row. | Details card: those rows become read-only, "Shipment 1 · edit in Shipping". The packing list reads the shipment. One shared `primaryShipment(o)` rule for papers, overview and checklist. |
| 3 LC amount | `lcBalanceMinor` (the plan's LC part) | `OrderBankContract.amount` stays as "amount on the LC" for checking only; the bill of exchange and cover letter draw `min(LC amount, LC balance)`, or the LC balance when it is empty | none | The LC form pre-fills the amount; a mismatch is a required check on the bill of exchange. |
| 4 Proforma | `OrderPaper` (kind `proforma`), final on issue with a snapshot | `Order.proformaNo/IssuedOn` stay as an index (or become views of the final paper) | Backfill: for each issued PI, build a snapshot now (mark it "re-built from data on migration") | "Issue" = make final; "Make again" for a v2 with the same number. The same for the packing list once the goods are shipped. |
| 5 Deposit % | the plan's `part='deposit'` amount | `Order.depositPercent` stays as the accepted snapshot only; `settle()` takes the deposit amount from the plan; `routePlan` keeps hand-edited amounts (rebuild only rows with `part != null` and unchanged) | none (plans already exist; check that each order's deposit row matches its percent and list the ones that don't) | The Details row "Deposit 30% (as accepted) · plan: 50%" when they differ. Plan labels are built from the amount, not stored text. |
| 6 Due | one function `orderPosition(o)` = total + charged − settled, in `@kebo/money` / `order-money.ts` | all 17 call sites and the `due.ts` SQL use it | none | The order page, statement, payment request and reminders all show "incl. USD 800 charged". |
| 7 Receipt / PR numbers | stored: `Payment.receiptNo` and `PaymentPlanItem.requestNo` (or an `OrderPaper` row on first print) | numbering by position is removed | Backfill numbers in the current order (paidOn, createdAt), skipping voided payments | none |
| 9 Plan dates | due rules on `PaymentPlanItem` (`on_ready`, `on_ship_plus`, `after_papers`, `fixed`), worked out live like the factory plan | `datePlan` is removed; a date set by hand becomes `fixed` | Backfill: items with `part='balance'` and a date set by `datePlan` become `on_ready` / `on_ship_plus` (taken from `balanceTerms`); others `fixed` | The plan shows "on the ready date (1 Apr)". |
| 10 Factory to pay | see #1 | | | |
| 3.4 Ship-by | `Order.shipBy` (the promise) | `latestShipOn` stays an LC field; LC check: `shipBy ≤ latestShipOn`; the shipping page shows both, labelled | none | Details: "Ship by 1 Apr (LC latest 15 Apr)". |
| 3.5 Terms | the route (`paymentRoute` + terms) for the order; the revision's `balanceTerms` frozen as accepted | `Order.balanceTerms` frozen (stop writing it in `setRoute`); papers print the sentence from the route; `rev.paymentTerms` text is printed only when the route is still the accepted one (or the Make page asks) | none | Make page check: "Quotation said 'By T/T'; route is LC: print the quotation text? [ ]". |
| 3.6 Customer | a `Order.buyerSnapshot` taken at order creation (or on the first final paper), refreshable with a reason | papers read it; `customerOf` merge removed; the web `customerOr` uses the same shape | Backfill from `revision.customerSnapshot` | Make page: "Buyer as on R2 · refresh from customer". |
| Revision mirror | `QuotationOption` | revision totals and lead time removed (or kept as a DB view) | Drop the columns after reading from options; reports sum the accepted option, or the max/min of the sent options, labelled | none |
| Route at creation | `revision.balanceTerms` → initial `paymentRoute` | — | Optional: backfill orders with `balanceTerms='letter_of_credit'` and `paymentRoute null` | The route step pre-selected, "from the quotation". |
| Payment kind | the plan allocation | `Payment.kind` → shown as worked out; stored only for `other` | none | The receipt says what the money paid. |
| Proforma / PL rows | `Order.proformaNo` / paper; `packedAt` | block `OrderDocument` rows of kinds the app makes (the API refuses them) | Merge or delete existing hand-made rows of those kinds (keep the file attachments) | The document form hides those kinds. |
| Container on the packing form | `Shipment.containerNo` | `Order.containerNo` removed | in the shipment backfill | Packing form: container read-only from the shipment. |
| Delivery condition | lines | order condition = the worst line condition (worked out) | backfill no-op | The delivery form drops the order-level condition, or only offers "all lines good". |
| Profit | one `orderMoney(o)` used by the Money tab, Costs page, Reports, Insights and Leaks, returning named figures (`grossOnQuote`, `expected`, `earned`, `cash`) | the five formulas become calls to it; the leaks SQL uses `BASIS_COST_CATEGORIES` | none | Every screen shows the same label for the same figure. |
| Dead table | — | drop `ProductionStep` | `DROP TABLE` after checking that the rows count is 0 | none |

---

## 8. PR grouping (shippable, in order)

### PR 1 — "One money truth" (no schema change, highest risk first)

- Fix the purchase order: tax columns and total from `owedByFactory`; currency from the lines with no CNY fallback; payment terms from `FactoryPaymentPlan`, not a hard-coded sentence.
- Fix the LC amount fallback (`lcAmount` → LC balance) and add a required "LC amount ≠ LC balance" check.
- One `orderPosition()` (total + charged − settled, deposit from the plan) in `order-money.ts`, used by all 17 `settle` sites and the `due.ts` SQL.
- One `factoryPosition()` (owed with tax − paid − factory-borne expenses), used by the Money tab, factory plan, `ordersOwingFactories` and the Costs page.
- The leaks SQL uses `BASIS_COST_CATEGORIES`; the profit labels are unified (same names for the same figure).
- The overview reads the same `due` whether or not the money loaded.
- Tests: golden cases for "charged expense", "50% hand-edited deposit", "factory-borne expense", "LC without amount".

### PR 2 — "Papers that never move"

- Stored numbers for receipts and payment requests (`Payment.receiptNo`, `PaymentPlanItem.requestNo` + backfill).
- The proforma (and packing list) become `OrderPaper` kinds with a final snapshot (backfill snapshots for issued PIs, marked as rebuilt).
- A buyer snapshot on the order (from `revision.customerSnapshot`), shown on the Make page with "refresh from customer (reason)"; the web `customerOr` aligned.
- Route-aware terms: stop `setRoute` writing `Order.balanceTerms`; sentences built from the route; a Make-page check when the quotation's free-text terms contradict the route.
- `OrderDocument` refuses rows of kinds the app makes; existing ones are merged.

### PR 3 — "Shipment is the shipment" (schema + backfill)

- Backfill a `Shipment` for every order with order-level shipping facts; reconcile conflicts into the audit log.
- One `primaryShipment(o)` helper used by papers, overview, checklist and LC checks.
- The packing list reads the shipment (B/L, date, container, ports).
- Remove `followFlow`'s copy and the shipment-prefill copies; new-shipment ports from `portsOf` (fixes CFR/CIF loading-port prefill).
- The Details card: Shipped on / B/L / container read-only with a "edit in Shipping" link; `Order.shippedOn/blNo/containerNo` dropped (or kept as generated columns for Insights; switch Insights to `min(departedOn)`).
- Ship-by: the LC check compares `shipBy` with `latestShipOn`; both are shown, labelled.

### PR 4 — "Plans follow the dates" (schema)

- Due rules on `PaymentPlanItem` (`on_ready`, `on_ship_plus`, `after_papers`, `fixed`), worked out live; `datePlan` removed; backfill rules from today's data.
- `routePlan` rebuild keeps hand-edited instalments; plan labels built from amounts.
- The initial `paymentRoute` comes from the accepted `balanceTerms`.
- The factory offer gets a structured advance %, used to seed `FactoryPaymentPlan`.
- `Payment.kind` worked out from the allocation.

### PR 5 — "Quotation mirrors and dead weight" (cleanup)

- Remove the revision → option mirror (`subtotal/discount/total/leadTime`); reports and leaks read options (accepted, else option A, labelled).
- Delivery condition worked out from the lines.
- Drop `ProductionStep`; drop the redundant `Payment.currency` filter, or add a DB check `payment.currency = order.currency`.
- Bind the FAT/inspection paper to its checklist item by `paper` key (migration: set `paper` on the matching items).
- One PL-number helper.

**Order rationale.** PR 1 fixes money and papers without schema risk. PR 2 freezes what customers and banks hold before PR 3 changes the shipping data underneath it (otherwise re-printed old papers would move). PR 4 depends on PR 3's single ship date. PR 5 is cleanup.

---

## 9. Open questions for the owner

1. **Buyer details on papers:** frozen at the quotation (today's behaviour), frozen at the order, or always current? (The recommendation is: frozen at the order, refreshable with a reason.)
2. **Purchase order prices:** should the factory see prices including tax or excluding tax? The PO and the ledger must agree either way.
3. **Customer-borne expenses:** invoiced separately (then they should not be in "due" anywhere), or added to the order balance (then the plan and papers must include them)?
4. **Ship-by:** must the contract's "ship by" be the LC's latest ship date when there is an LC?
5. **Multi-factory orders:** should `readyOn` be per factory? Today one date drives every factory's PO and plan.

## 10. Owner decisions (3 Nov 2026)

1. Buyer details on papers: **frozen at the order**, refreshable from the customer with a reason.
2. Purchase order prices: follow the offer's tax choice (done in #88: tax sentence and totals match what we owe).
3. Expenses charged to the customer: **added to the order balance** (count in "still due" everywhere).
4. Ship-by with an LC: keep our own ship-by, show both, **warn when ship-by is later than the LC's latest shipment date**.
5. Multi-factory orders: **one ready date per factory**; the order's ready date is the latest of them.
