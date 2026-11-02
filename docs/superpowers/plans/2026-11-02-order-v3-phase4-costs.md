# Phase 4 — costs and expenses on the order

Spec §5. Boards: OrderV3Costs, OrderV3AddExpense, OrderV3PhoneExpense, and the "Costs in this step"
cards on OrderV3Payment/Production/Shipping, the Money card on OrderV3Overview
(/home/claude/canvas/project/*.dc.html, previews /home/claude/preview/*.png).
Branch `feat/order-costs` from the latest main.

## Today
`Expense` (expenses table) already has orderId, category (EXPENSE_CATEGORIES in
packages/shared/src/enums.ts), amount, currency, rate (units of currency per 1 main currency),
spentOn, paidById, receipt*, accountId, void*. `OrderCost` (order_costs) = planned basis costs from
the quote (step BasisStep: to_port, freight, insurance, delivery, duties; cost in order currency).
`BASIS_COST_CATEGORIES` count against planned costs. Money: `GET /orders/:id/money` returns plan,
factories, expenses, profit (MoneyService); web money-cards.tsx ProfitView / FactoriesView;
NewExpense form in components/money/forms.tsx; expense actions in money/actions.ts.

## Data
Migration `…_expense_order_fields`: `expenses.step text null` (FlowStep), `expenses.borne_by text not
null default 'us'` (us | customer | factory), `expenses.own_money boolean not null default false`,
`expenses.repaid_on date null`, `expenses.repaid_account_id uuid null` (fk money_accounts, same-company
trigger). Categories: add `courier`, `insurance` to EXPENSE_CATEGORIES; insurance joins
BASIS_COST_CATEGORIES mapping to the `insurance` basis step; mapping category → basis step:
inland_transport→to_port, freight→freight, insurance→insurance, customs→duties.

## Rules
- borne_by customer: the amount (in order currency) is added to what the customer owes on that
  order (order money `due` includes recharged expenses; show as an extra line "Charged to you:
  <description>" in the plan/due and on the customer statement/payment request later).
- borne_by factory: taken off what we owe that factory (factory payable). Expense must have
  factoryId.
- borne_by us: counts in profit. Planned vs spent: per basis step, spent = sum of expenses in its
  categories; difference left/over; other categories are "Not planned".
- Profit now expected = sale − factory cost (at the order's rates) − max(planned, spent per basis
  step) − not planned spent … keep it simple and explainable: sale − factory − planned − not planned
  so far (as on the board), plus "On the quote" figure.
- own_money: shows in "To repay" until repaid; `POST /expenses/:id/repay` {repaidOn, accountId}.
- Default step when created from a step page = that step; from a checklist `pay` tool = item's step
  + category (freight → shipping, inspection → production, to the port → shipping).

## API
Extend expense create/edit inputs (step, borneBy, ownMoney, factoryId when borne by factory) and
`GET /orders/:id/money` (or new `GET /orders/:id/costs`): totals {planned, spent, notPlanned,
receiptsMissing}, `planned` rows, `expenses` rows with names, `profit` {sale, factory, planned,
notPlanned, expected, margin, onQuote}, `toRepay` by person. Permissions: expenses.manage + feature
`expenses` (the whole Costs page hides without it); profit needs the same rule as ProfitView today.
History: expense actions mapped to their step (phase 1 STEP_OF_ACTION). Tests: recharge raises due,
factory-borne lowers payable, planned vs spent math, repay, permissions, RLS of the new FK.

## Web
- `/orders/[id]/costs` page + "Costs" in the step nav (with "USD 456"-style total): four numbers
  header (Planned on the quote · Spent so far · Not planned (red) · Receipts missing) with Excel +
  Add expense; "Planned and spent" LineTable (read-only); "Expenses" LineTable with step filter (seg)
  and "Missing receipts (n)"; side: Profit on this order, To repay (Repay button), Changes.
- `components/orders/costs-card.tsx` "Costs in this step" on every step page (list, total, planned
  note, Add expense) — only with expenses permission + feature.
- Expense form (dialog/drawer) per OrderV3AddExpense: What for chips, description, amount +
  currency + rate (from settings rates, editable) → "Counts as USD x", spent on, step, paid by +
  from (accounts + "own money · we repay"), who bears it (3 cards), receipt upload, warning when not
  planned with the profit change, Save / Save and add another. Phone layout per OrderV3PhoneExpense
  (receipt photo first: `<input type=file accept="image/*" capture="environment">`).
- Checklist `pay` tool on freight/to-port/inspection items opens this form prefilled.
- Overview Money card: "Costs spent" and "Expected profit" after costs.

## Done when
Green checks, screenshots in /home/claude/shots/phase4/, PR against main, CI green (do not merge).
