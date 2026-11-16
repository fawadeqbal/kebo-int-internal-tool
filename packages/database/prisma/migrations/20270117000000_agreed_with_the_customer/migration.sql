-- Terms that travel (design "RFQ Desk — terms that travel", step 2): accepting a quotation copies what was agreed
-- with the customer into the order, so the order keeps it when the quotation stays as it was sent, and the order's
-- papers print the order's own copy (an older order has none: its papers read the quotation, as before).
-- - the lead time promised (days from a moment), worked out into the ship-by date unless it was typed by hand;
-- - the warranty (months from a moment, and what it covers);
-- - the conditions printed with the delivery and the payment, and the notes.
-- terms_copied says the order has its own copy (an order made before this has not: false).
ALTER TABLE "orders"
  ADD COLUMN "terms_copied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lead_days" INTEGER,
  ADD COLUMN "lead_from" TEXT,
  ADD COLUMN "ship_by_typed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "warranty_months" INTEGER,
  ADD COLUMN "warranty_from" TEXT,
  ADD COLUMN "warranty_words" VARCHAR(300),
  ADD COLUMN "delivery_conditions" TEXT,
  ADD COLUMN "payment_conditions" TEXT,
  ADD COLUMN "conditions_notes" TEXT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_agreed_terms_check" CHECK (
  ("lead_days" IS NULL OR ("lead_days" >= 0 AND "lead_days" <= 3650))
  AND ("lead_from" IS NULL OR "lead_from" IN ('after_payment', 'after_order', 'after_drawings'))
  AND ("warranty_months" IS NULL OR ("warranty_months" >= 0 AND "warranty_months" <= 240))
  AND ("warranty_from" IS NULL OR "warranty_from" IN ('shipment', 'delivery', 'sat'))
);

-- A customer's instalment can fall due some days after the site acceptance test (a quotation's "10% after the site
-- test"): the receivable side takes the rule 'after_sat' with its days. Everything else is as it was.
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_side_check";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_side_check" CHECK (
  ("order_id" IS NOT NULL AND "purchase_order_id" IS NULL AND "supplier_id" IS NULL AND "currency" IS NULL
     AND "percent" IS NULL AND "supplier_ref" IS NULL
     AND ("part" IS NULL OR "part" IN ('deposit', 'balance'))
     AND ("due_rule" IS NULL OR "due_rule" IN ('fixed', 'on_ready', 'on_ship_plus_days', 'after_papers', 'after_sat'))
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
