# Phase 5 — money corrections

Spec §6. Boards on canvas page 17: MoneyV2Record, MoneyV2Split, MoneyV2Route, MoneyV2Bank,
MoneyV2Factory, MoneyV2Cancel, MoneyV2Overview (/home/claude/canvas/project/*.dc.html, previews
/home/claude/preview/*.png if present; otherwise open the HTML with Playwright to screenshot).
Branch `feat/money-v2` from the latest main.

## 1. Pay in any currency
`payments` today: amount + currency must equal the order's currency and an account of that currency.
Add `received_amount numeric(14,2)`, `received_currency char(3)`, `rate numeric(24,14)` (units of
received currency per 1 order currency), `paid_by_name varchar(120)` (someone paying for the
customer). `amount` stays the order-currency amount (= received / rate, 2 dp). Backfill existing rows
(received = amount, currency, rate 1). Account must match `received_currency`. Form per
MoneyV2Record: what was paid (amount + currency), into (accounts filtered by that currency), paid on,
how, paid by, rate (default from settings rates; editable), "Counts as" preview, what it pays (plan
items, see 2), receipt file. Cash book entries use the received amount/currency.

## 2. Split, credit, refunds
New company tables (RLS): `customer_receipts` (one transfer: customer_id, received_amount, currency,
rate to main?, account_id, paid_on, method, reference, file*, recorded_by, void*) — each `payments`
row gets `receipt_id` null; `customer_credits` ledger (customer_id, kind: in | used | refund | fee,
amount, currency (customer's credit currency = the receipt's order currency, keep one currency per
row), receipt_id, payment_id (when used on an order), account_id (refund), on, note, by).
Recording a receipt: allocate to the customer's open orders (oldest due first, editable rows: order,
what for, due, takes); the remainder becomes a credit `in`. "Use credit" on an order creates a
payment with method `credit` and a credit `used` row; "Refund" creates `refund` (account, date).
Customer page + Money › Customers owe us show credit (as a minus). Overpaying an order without
splitting goes to credit instead of being rejected.

## 3. One route; bank step = payment
Route (informal | bank_contract | letter_of_credit) builds the payment plan: deposit (depositPercent)
+ balance part per route: informal → "before shipment" or "against the B/L copy" (choice stored on
the order: `balance_when`), bank contract → "through the banks", LC → `lc_terms` at_sight | deferred
`lc_days`. The old `balance_terms` free text is derived/kept for papers. Changing route rebuilds
unpaid plan items (payments stay). Deferred LC balance due = date of bank step
`customer_bank_received`/`couriered_to_customer_bank` done + lc_days (choose the step meaning
"papers reached their bank"; add it to BankStepKind if missing). Bank step `bank_paid_us` ("Money
reached us") is recorded through the payment form (credited amount + bank charges (existing
`payments.bank_charges`) + account + MT103 file) and links `order_bank_steps.payment_id`; ticking it
without a payment is no longer possible.

## 4. LC checks
Shared `lcChecks(order, contract, plan, shipment)` → list of {label, ok, detail}: amount ≥ balance,
currency = order currency, latest ship date ≥ factory ready date (else "ask for an amendment"),
expiry ≥ ETA (or ship by) + courier days (setting, default 4), presentation days if stored. Show on
Payment step's LC row ("n of m match") and in the LC panel; failing checks → late-style warning item.

## 5. Factory payment plan
Table `factory_payment_plans` (RLS): order_id, factory_id, label, percent null, amount, currency,
due_rule (on_order | on_ready | fixed), due_on (fixed), sort_order. Default when the factory is
ordered: advance (company setting, default 30%) on_order + balance on_ready. Status from
factory_payments (paid / part / due / late). Due on_ready follows `orders.ready_on`. Shows on the
Factory order page (plan table, LineTable), Production checklist "Balance paid to the factory" (pay
tool → factory payment form prefilled), Home reminders, Money › We owe factories (due dates).

## 6. Cancelled with money in
Cancel form: if customer money received > 0, choose keep as credit (credit `in`) | refund (record
now or later) | keep as a fee (income, credit `fee`); if factory money paid > 0: refund expected from
the factory (a receivable row on factory_payments kind `refund_due` or a simple flag + amount) | a
loss on this order (expense category other, borne by us). Order history records the choice.

## Tests
Every rule above in apps/api/test/money-v2.test.ts: currency conversion and rounding, account
currency check, split allocation + credit, credit use/refund, route rebuild keeps paid items,
deferred LC due date, money reached us = payment + step, LC checks, factory plan due on ready date
moves, cancel choices. RLS for new tables, permissions (payments.record, orders.manage for cancel,
sourcing.manage for factory), every-endpoint.

## Done when
Green checks, screenshots in /home/claude/shots/phase5/, PR against main, CI green (do not merge).
