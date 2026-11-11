-- Order split by concern (step 5, architecture review §6.6): delivery & SAT, and the cancellation, get their own
-- one-row tables. Rows are moved (only orders that had something recorded get one); the columns are dropped.

CREATE TABLE "order_deliveries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "delivered_on" DATE,
    "note" TEXT,
    "received_by" VARCHAR(120),
    "sat_engineer" UUID,
    "sat_planned_on" DATE,
    "sat_done_on" DATE,
    "sat_signed_by" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "order_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "order_deliveries_order_id_key" ON "order_deliveries"("order_id");
CREATE INDEX "order_deliveries_company_id_idx" ON "order_deliveries"("company_id");
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_sat_engineer_fkey" FOREIGN KEY ("sat_engineer") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "order_cancellations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "cancelled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "customer_money" VARCHAR(10),
    "factory_money" VARCHAR(12),
    CONSTRAINT "order_cancellations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_cancellations_money_check" CHECK (
      ("customer_money" IS NULL OR "customer_money" IN ('credit', 'refund', 'fee'))
      AND ("factory_money" IS NULL OR "factory_money" IN ('refund_due', 'loss')))
);
CREATE UNIQUE INDEX "order_cancellations_order_id_key" ON "order_cancellations"("order_id");
CREATE INDEX "order_cancellations_company_id_idx" ON "order_cancellations"("company_id");
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- the rows

INSERT INTO "order_deliveries" ("id", "company_id", "order_id", "delivered_on", "note", "received_by", "sat_engineer", "sat_planned_on",
                                "sat_done_on", "sat_signed_by", "created_at", "updated_at")
SELECT gen_random_uuid(), o.company_id, o.id, o.delivered_on, o.delivery_note, o.delivery_received_by, o.sat_engineer, o.sat_planned_on, o.sat_done_on,
       o.sat_signed_by, o.updated_at, o.updated_at
  FROM "orders" o
 WHERE coalesce(o.delivered_on::text, o.delivery_note, o.delivery_received_by, o.sat_engineer::text, o.sat_planned_on::text,
                o.sat_done_on::text, o.sat_signed_by) IS NOT NULL;

INSERT INTO "order_cancellations" ("id", "company_id", "order_id", "cancelled_at", "reason", "customer_money", "factory_money")
SELECT gen_random_uuid(), o.company_id, o.id, coalesce(o.cancelled_at, o.updated_at), o.cancel_reason, o.cancel_customer_money, o.cancel_factory_money
  FROM "orders" o
 WHERE o.status = 'cancelled' OR o.cancelled_at IS NOT NULL;

DROP TRIGGER IF EXISTS "same_company_orders_sat_engineer_fkey" ON "orders";
ALTER TABLE "orders"
  DROP COLUMN "delivered_on", DROP COLUMN "delivery_note", DROP COLUMN "delivery_received_by", DROP COLUMN "sat_engineer",
  DROP COLUMN "sat_planned_on", DROP COLUMN "sat_done_on", DROP COLUMN "sat_signed_by",
  DROP COLUMN "cancelled_at", DROP COLUMN "cancel_reason", DROP COLUMN "cancel_customer_money", DROP COLUMN "cancel_factory_money";

-- ---------------------------------------------------------------- rules

CREATE OR REPLACE FUNCTION facts_mark_row(p_table text, r jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c uuid := (r ->> 'company_id')::uuid;
BEGIN
  CASE p_table
    WHEN 'orders' THEN
      PERFORM facts_enqueue(c, 'order', (r ->> 'id')::uuid);
    WHEN 'order_lines', 'order_costs', 'allocations', 'invoices', 'order_deliveries', 'order_cancellations',
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
CREATE TRIGGER "facts_mark" AFTER INSERT OR DELETE OR UPDATE ON "order_deliveries" FOR EACH ROW EXECUTE FUNCTION facts_mark();
CREATE TRIGGER "facts_mark" AFTER INSERT OR DELETE OR UPDATE ON "order_cancellations" FOR EACH ROW EXECUTE FUNCTION facts_mark();

CREATE TRIGGER "same_company_order_deliveries_order_id_fkey" BEFORE INSERT OR UPDATE OF "order_id" ON "order_deliveries"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('orders', 'order_id');
CREATE TRIGGER "same_company_order_deliveries_sat_engineer_fkey" BEFORE INSERT OR UPDATE OF "sat_engineer" ON "order_deliveries"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('users', 'sat_engineer');
CREATE TRIGGER "same_company_order_cancellations_order_id_fkey" BEFORE INSERT OR UPDATE OF "order_id" ON "order_cancellations"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('orders', 'order_id');

ALTER TABLE "order_deliveries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "order_deliveries" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
ALTER TABLE "order_cancellations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "order_cancellations" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_deliveries", "order_cancellations" TO kebo_app;
