-- A supplier's part can fall due some days after the goods leave (design "one plan editor"): the payable side
-- takes the rule 'on_ship_plus_days' with its days, as the customer's side already does. Its other rules keep
-- no days. The customer's side is as it was.
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_side_check";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_side_check" CHECK (
  ("order_id" IS NOT NULL AND "purchase_order_id" IS NULL AND "supplier_id" IS NULL AND "currency" IS NULL
     AND "percent" IS NULL AND "supplier_ref" IS NULL
     AND ("part" IS NULL OR "part" IN ('deposit', 'balance'))
     AND ("due_rule" IS NULL OR "due_rule" IN ('fixed', 'on_ready', 'on_ship_plus_days', 'after_papers'))
     AND ("due_on" IS NULL OR "due_rule" IS NULL OR "due_rule" = 'fixed')
     AND ("request_no" IS NULL OR "request_no" >= 1)
     AND "amount" > 0)
  OR
  ("order_id" IS NULL AND "purchase_order_id" IS NOT NULL AND "supplier_id" IS NOT NULL AND "currency" IS NOT NULL
     AND "part" IS NULL AND "request_no" IS NULL
     AND "due_rule" IN ('on_order', 'on_ready', 'fixed', 'on_ship_plus_days')
     AND ("due_days" IS NULL OR ("due_rule" = 'on_ship_plus_days' AND "due_days" >= 0))
     AND ("percent" IS NULL OR ("percent" >= 0 AND "percent" <= 100))
     AND "amount" >= 0)
);
