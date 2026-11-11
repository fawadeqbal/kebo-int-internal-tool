-- Order split by concern (step 5, architecture review §6.6): how the customer pays (the route and its terms) gets
-- its own one-row table. Every order gets its row (the terms it had); the columns are dropped from orders.

CREATE TABLE "order_payment_terms" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "route" "PaymentRoute",
    "balance_when" VARCHAR(20),
    "lc_terms" VARCHAR(10),
    "lc_days" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "order_payment_terms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_payment_terms_check" CHECK (
      ("balance_when" IS NULL OR "balance_when" IN ('before_shipment', 'against_bl_copy'))
      AND ("lc_terms" IS NULL OR "lc_terms" IN ('at_sight', 'deferred'))
      AND ("lc_days" IS NULL OR ("lc_days" >= 0 AND "lc_days" <= 720)))
);
CREATE UNIQUE INDEX "order_payment_terms_order_id_key" ON "order_payment_terms"("order_id");
CREATE INDEX "order_payment_terms_company_id_idx" ON "order_payment_terms"("company_id");
ALTER TABLE "order_payment_terms" ADD CONSTRAINT "order_payment_terms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_payment_terms" ADD CONSTRAINT "order_payment_terms_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "order_payment_terms" ("id", "company_id", "order_id", "route", "balance_when", "lc_terms", "lc_days", "created_at", "updated_at")
SELECT gen_random_uuid(), o.company_id, o.id, o.payment_route, o.balance_when, o.lc_terms, o.lc_days, o.created_at, o.updated_at
  FROM "orders" o;

ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_balance_when_check";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_lc_terms_check";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_lc_days_check";
ALTER TABLE "orders" DROP COLUMN "payment_route", DROP COLUMN "balance_when", DROP COLUMN "lc_terms", DROP COLUMN "lc_days";

-- The order's facts follow its route (what is due, which papers): recomputed when it changes.
CREATE OR REPLACE FUNCTION facts_mark_row(p_table text, r jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c uuid := (r ->> 'company_id')::uuid;
BEGIN
  CASE p_table
    WHEN 'orders' THEN
      PERFORM facts_enqueue(c, 'order', (r ->> 'id')::uuid);
    WHEN 'order_lines', 'order_costs', 'allocations', 'invoices', 'order_deliveries', 'order_cancellations', 'order_payment_terms',
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
CREATE TRIGGER "facts_mark" AFTER INSERT OR DELETE OR UPDATE ON "order_payment_terms" FOR EACH ROW EXECUTE FUNCTION facts_mark();
CREATE TRIGGER "same_company_order_payment_terms_order_id_fkey" BEFORE INSERT OR UPDATE OF "order_id" ON "order_payment_terms"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('orders', 'order_id');

ALTER TABLE "order_payment_terms" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "order_payment_terms" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_payment_terms" TO kebo_app;
