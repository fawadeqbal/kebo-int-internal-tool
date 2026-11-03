# PR B · Insights data: three calculated tables

Design: canvas page 28 board "Ins28Schema" (/home/claude/preview/Ins28Schema.png) and the KPI boards
Ins28*.png. Single-source-of-truth rules: docs/single-source-of-truth.md (orderPosition, factoryPosition,
orderMoney, primaryShipment, ready per factory…). NO screen changes in this PR.

Tables (company tables: company_id default app_company(), RLS company_isolation, grants to kebo_app,
enforce_same_company where they link; never written by people; `computed_at`):
- `order_facts` (one per order): customer_id, handled_by, country, channel, category, ordered_on,
  shipped_on, delivered_on, closed_on, status/stage, currency + main-currency figures (total, received,
  due, overdue, cost, profit_expected, margin, expenses, costs_over_plan), on_time, days_quote_to_order,
  days_to_ship.
- `inquiry_facts` (one per inquiry): customer_id, handled_by, channel, country, category, received_on,
  first_quote_on, got_prices, quoted_value_main, outcome (open/won/lost), lost_reason,
  days_to_first_quote, days_to_close.
- `factory_order_facts` (one per order × factory): factory_id, order_id, ready_promised, ready_actual,
  days_late, on_time, owed, paid, to_pay (main currency + own currency), offers_sent/offer_won (for the
  factory on that inquiry), claims.
A `FactsService.refreshOrder/Inquiry(id)` computes rows ONLY through the shared helpers; called after every
write that can change them (hook it where audit/history records changes, or explicit calls in services) —
debounced/async is fine but must be reliable; the worker runs a nightly full rebuild that also compares and
logs (and fixes) differences. Backfill: the migration creates tables; the API/worker fills them on start
if empty (safe on an empty DB).
Read API (for PR F/G): `GET /insights/facts/...` minimal endpoints or a service other modules call:
grouped sums by period × (company, customer, factory, person, channel, country, category), funnel counts,
aging buckets (receivables from order_facts; payables from factory_order_facts), cash in/out by month
straight from payments/factory payments/expenses (indexed queries). Permission: money figures only with
the money permission (as Insights today).
Tests: parity — for every demo order/inquiry, facts == shared helpers; refresh after payment / shipment /
expense / plan change; nightly rebuild finds and fixes a planted drift; empty DB.
