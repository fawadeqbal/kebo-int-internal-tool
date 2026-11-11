-- Billing (claude/billing-4-design.md): one table for every instalment, the customer's (receivable, on order_id)
-- and each supplier's (payable, on purchase_order_id, from supplier_id). Replaces payment_plan_items and
-- factory_payment_plans; ids and payment request numbers are kept. Paid, due and late stay worked out.

CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID,
    "purchase_order_id" UUID,
    "supplier_id" UUID,
    "label" VARCHAR(80) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3),
    "percent" DECIMAL(5,2),
    "due_on" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "part" VARCHAR(10),
    "due_rule" VARCHAR(20),
    "due_days" INTEGER,
    "request_no" INTEGER,
    "supplier_ref" VARCHAR(60),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    -- A customer's (on the order) or a supplier's (on the order it buys for, with the supplier and its currency).
    CONSTRAINT "invoices_side_check" CHECK (
      ("order_id" IS NOT NULL AND "purchase_order_id" IS NULL AND "supplier_id" IS NULL AND "currency" IS NULL
         AND "percent" IS NULL AND "supplier_ref" IS NULL
         AND ("part" IS NULL OR "part" IN ('deposit', 'balance'))
         AND ("due_rule" IS NULL OR "due_rule" IN ('fixed', 'on_ready', 'on_ship_plus_days', 'after_papers'))
         AND ("due_on" IS NULL OR "due_rule" IS NULL OR "due_rule" = 'fixed')
         AND ("request_no" IS NULL OR "request_no" >= 1)
         AND "amount" > 0)
      OR
      ("order_id" IS NULL AND "purchase_order_id" IS NOT NULL AND "supplier_id" IS NOT NULL AND "currency" IS NOT NULL
         AND "part" IS NULL AND "due_days" IS NULL AND "request_no" IS NULL
         AND "due_rule" IN ('on_order', 'on_ready', 'fixed')
         AND ("percent" IS NULL OR ("percent" >= 0 AND "percent" <= 100))
         AND "amount" >= 0)
    )
);

CREATE UNIQUE INDEX "invoices_order_id_request_no_key" ON "invoices"("order_id", "request_no");
CREATE INDEX "invoices_order_id_idx" ON "invoices"("order_id");
CREATE INDEX "invoices_purchase_order_id_supplier_id_idx" ON "invoices"("purchase_order_id", "supplier_id");
CREATE INDEX "invoices_supplier_id_idx" ON "invoices"("supplier_id");
CREATE INDEX "invoices_due_on_idx" ON "invoices"("due_on");
CREATE INDEX "invoices_company_id_idx" ON "invoices"("company_id");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- the rows, ids kept

INSERT INTO "invoices" ("id", "company_id", "order_id", "label", "amount", "due_on", "sort_order", "part", "due_rule", "due_days",
                        "request_no", "created_at", "updated_at")
SELECT p.id, p.company_id, p.order_id, p.label, p.amount, p.due_on, p.sort_order, p.part, p.due_rule, p.due_days, p.request_no,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "payment_plan_items" p;

INSERT INTO "invoices" ("id", "company_id", "purchase_order_id", "supplier_id", "label", "amount", "currency", "percent", "due_on",
                        "sort_order", "due_rule", "created_at", "updated_at")
SELECT f.id, f.company_id, f.order_id, f.factory_id, f.label, f.amount, f.currency, f.percent, f.due_on, f.sort_order, f.due_rule,
       f.created_at, f.updated_at
  FROM "factory_payment_plans" f;

DROP TABLE "payment_plan_items";
DROP TABLE "factory_payment_plans";

-- ---------------------------------------------------------------- rules

-- A customer invoice's payment request number: the order's next, never reused (as before).
CREATE OR REPLACE FUNCTION number_request() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  ELSIF NEW.request_no IS NULL THEN
    UPDATE orders SET last_request_no = last_request_no + 1 WHERE id = NEW.order_id RETURNING last_request_no INTO NEW.request_no;
  ELSE
    UPDATE orders SET last_request_no = greatest(last_request_no, NEW.request_no) WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "invoices_request_no" BEFORE INSERT ON "invoices" FOR EACH ROW EXECUTE FUNCTION number_request();

CREATE OR REPLACE FUNCTION facts_mark_row(p_table text, r jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c uuid := (r ->> 'company_id')::uuid;
BEGIN
  CASE p_table
    WHEN 'orders' THEN
      PERFORM facts_enqueue(c, 'order', (r ->> 'id')::uuid);
    WHEN 'order_lines', 'order_costs', 'allocations', 'invoices',
         'shipments', 'order_factories', 'order_claims', 'order_bank_steps', 'expenses' THEN
      IF coalesce(r ->> 'order_id', r ->> 'purchase_order_id') IS NOT NULL THEN
        PERFORM facts_enqueue(c, 'order', coalesce(r ->> 'order_id', r ->> 'purchase_order_id')::uuid);
      END IF;
    WHEN 'inquiries' THEN
      PERFORM facts_enqueue(c, 'inquiry', (r ->> 'id')::uuid);
    WHEN 'factory_quotes', 'quotations' THEN
      PERFORM facts_enqueue(c, 'inquiry', (r ->> 'inquiry_id')::uuid);
    WHEN 'quotation_revisions' THEN
      PERFORM facts_enqueue(c, 'inquiry', (SELECT q."inquiry_id" FROM "quotations" q WHERE q."id" = (r ->> 'quotation_id')::uuid));
    WHEN 'quotation_options' THEN
      PERFORM facts_enqueue(c, 'inquiry', (SELECT q."inquiry_id" FROM "quotation_revisions" v JOIN "quotations" q ON q."id" = v."quotation_id"
                                             WHERE v."id" = (r ->> 'revision_id')::uuid));
    ELSE
      NULL;
  END CASE;
END $$;
CREATE TRIGGER "facts_mark" AFTER INSERT OR DELETE OR UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION facts_mark();

-- Same company on every link; row-level security; the app's rights.
CREATE TRIGGER "same_company_invoices_order_id_fkey" BEFORE INSERT OR UPDATE OF "order_id" ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('orders', 'order_id');
CREATE TRIGGER "same_company_invoices_purchase_order_id_fkey" BEFORE INSERT OR UPDATE OF "purchase_order_id" ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('orders', 'purchase_order_id');
CREATE TRIGGER "same_company_invoices_supplier_id_fkey" BEFORE INSERT OR UPDATE OF "supplier_id" ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('parties', 'supplier_id');

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "invoices" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO kebo_app;
