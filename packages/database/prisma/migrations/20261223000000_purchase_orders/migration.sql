-- Purchase orders as their own records (decided 12 Nov, claude/purchase-orders-design.md, step 1a): one per
-- sales order × supplier, numbered on their own (PO-2026-0001). They take over order_factories (the supplier's
-- ready date) and, per supplier, the order's "placed with the factory" date and the factory's own number.
-- The ready date of an order whose lines name no supplier stays on the order (goods_ready_on).

CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "currency" CHAR(3),
    "ready_on" DATE,
    "sent_on" DATE,
    "sent_by" UUID,
    "sent_early_reason" VARCHAR(300),
    "supplier_ref" VARCHAR(60),
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_orders_number_check" CHECK ("number" ~ '^PO-[0-9]{4}-[0-9]{4,}$')
);
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");
CREATE INDEX "purchase_orders_company_id_idx" ON "purchase_orders"("company_id");
CREATE UNIQUE INDEX "purchase_orders_order_id_supplier_id_key" ON "purchase_orders"("order_id", "supplier_id");
CREATE UNIQUE INDEX "purchase_orders_company_id_number_key" ON "purchase_orders"("company_id", "number");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders" ADD COLUMN "goods_ready_on" DATE;

-- One purchase order per order × supplier named on its lines, numbered in the order they were ordered, per
-- company and year.
WITH pairs AS (
  SELECT o.company_id, o.id AS order_id, l.factory_id AS supplier_id, max(l.factory_currency) AS currency,
         o.ordered_on, o.created_at, o.factory_ordered_on, o.factory_order_no, o.status,
         extract(year FROM o.ordered_on)::int AS yr
    FROM "orders" o JOIN "order_lines" l ON l.order_id = o.id
   WHERE l.factory_id IS NOT NULL
   GROUP BY o.company_id, o.id, l.factory_id
), numbered AS (
  SELECT p.*, row_number() OVER (PARTITION BY p.company_id, p.yr ORDER BY p.ordered_on, p.created_at, p.order_id, p.supplier_id) AS seq
    FROM pairs p
)
INSERT INTO "purchase_orders" ("id", "company_id", "order_id", "supplier_id", "number", "currency", "ready_on", "sent_on",
                               "supplier_ref", "cancelled_at", "created_at", "updated_at")
SELECT gen_random_uuid(), n.company_id, n.order_id, n.supplier_id, 'PO-' || n.yr || '-' || lpad(n.seq::text, 4, '0'), n.currency,
       f.ready_on, n.factory_ordered_on, n.factory_order_no,
       CASE WHEN n.status = 'cancelled' THEN coalesce(c.cancelled_at, n.created_at) END,
       n.created_at, now()
  FROM numbered n
  LEFT JOIN "order_factories" f ON f.order_id = n.order_id AND f.factory_id = n.supplier_id
  LEFT JOIN "order_cancellations" c ON c.order_id = n.order_id;

-- The counters go on from there (PO-<year>), so the next one made in the app follows.
INSERT INTO "counters" ("company_id", "key", "value")
SELECT company_id, 'PO-' || substr(number, 4, 4), max(substr(number, 9)::int)
  FROM "purchase_orders" GROUP BY company_id, substr(number, 4, 4)
ON CONFLICT ("company_id", "key") DO UPDATE SET "value" = greatest("counters"."value", EXCLUDED."value");

UPDATE "orders" o SET "goods_ready_on" = f.ready_on FROM "order_factories" f WHERE f.order_id = o.id AND f.factory_id IS NULL;

DROP TABLE "order_factories";
ALTER TABLE "orders" DROP COLUMN "factory_ordered_on", DROP COLUMN "factory_order_no";

-- The order's facts follow its purchase orders (as they followed order_factories).
CREATE OR REPLACE FUNCTION facts_mark_row(p_table text, r jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c uuid := (r ->> 'company_id')::uuid;
BEGIN
  CASE p_table
    WHEN 'orders' THEN
      PERFORM facts_enqueue(c, 'order', (r ->> 'id')::uuid);
    WHEN 'order_lines', 'order_costs', 'allocations', 'invoices', 'order_deliveries', 'order_cancellations', 'order_payment_terms',
         'shipments', 'purchase_orders', 'order_claims', 'order_bank_steps', 'expenses' THEN
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
CREATE TRIGGER "facts_mark" AFTER INSERT OR DELETE OR UPDATE ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION facts_mark();
CREATE TRIGGER "same_company_purchase_orders_order_id_fkey" BEFORE INSERT OR UPDATE OF "order_id" ON "purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('orders', 'order_id');
CREATE TRIGGER "same_company_purchase_orders_supplier_id_fkey" BEFORE INSERT OR UPDATE OF "supplier_id" ON "purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('parties', 'supplier_id');
CREATE TRIGGER "same_company_purchase_orders_sent_by_fkey" BEFORE INSERT OR UPDATE OF "sent_by" ON "purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('users', 'sent_by');

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "purchase_orders" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_orders" TO kebo_app;
