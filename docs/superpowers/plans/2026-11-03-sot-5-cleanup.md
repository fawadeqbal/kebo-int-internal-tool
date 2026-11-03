# Single source of truth · PR 5 of 5: mirrors and dead weight

Audit §3.11, §5, §7, §8 "PR 5". Builds on PR 1–4.

1. Remove the revision → option mirror (QuotationRevision.subtotal/discount/total/leadTime): read the
   option (accepted, else option A for drafts, labelled). Reports and leaks sum the accepted option (or
   show the min–max of a sent revision's options, labelled). Drop the columns after switching reads.
2. Delivery condition worked out from the lines (worst line condition); the delivery form offers "all
   lines good" only. Drop Order.deliveryCondition (keep deliveryNote) after backfilling lines.
3. Drop the unused ProductionStep model/table (check 0 rows in migration; refuse otherwise).
4. Payment.currency: add a DB check payment.currency = order.currency (or drop the column), and remove the
   17 currency filters left after PR 1.
5. Bind the FAT / inspection report to its checklist item by `paper` key, not a regex on the title
   (migration sets `paper` on matching items).
6. One packing-list number helper. Leaks SQL already uses BASIS_COST_CATEGORIES (PR 1) — verify.
Tests; numbers unchanged on demo data.
