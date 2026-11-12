-- Purchase order numbers (claude/purchase-orders-design.md: "their own sequence, PO-2026-0001"). One purchase order
-- per sales order × supplier named on its lines, with its number, when it was sent and by whom, the reason when it
-- was sent before the customer's deposit was verified, and the supplier's own number for it.
-- Additive: order_factories (ready dates) and orders.factory_ordered_on / factory_order_no stay as they are; they
-- move here in step 1a of the design.

CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "sent_on" DATE,
    "sent_by" UUID,
    "sent_early_reason" VARCHAR(300),
    "supplier_ref" VARCHAR(60),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

-- The ones there are: numbered in the order they were ordered, per company and year; sent when the order was
-- placed with the factory, with the factory's number.
WITH pairs AS (
  SELECT o.company_id, o.id AS order_id, l.factory_id AS supplier_id, o.ordered_on, o.created_at,
         o.factory_ordered_on, o.factory_order_no, extract(year FROM o.ordered_on)::int AS yr
    FROM "orders" o JOIN "order_lines" l ON l.order_id = o.id
   WHERE l.factory_id IS NOT NULL
   GROUP BY o.company_id, o.id, l.factory_id
), numbered AS (
  SELECT p.*, row_number() OVER (PARTITION BY p.company_id, p.yr ORDER BY p.ordered_on, p.created_at, p.order_id, p.supplier_id) AS seq
    FROM pairs p
)
INSERT INTO "purchase_orders" ("company_id", "order_id", "supplier_id", "number", "sent_on", "supplier_ref", "created_at")
SELECT n.company_id, n.order_id, n.supplier_id, 'PO-' || n.yr || '-' || lpad(n.seq::text, 4, '0'), n.factory_ordered_on, n.factory_order_no, n.created_at
  FROM numbered n;

-- The counters go on from there (PO-<year>), so the next one made follows.
INSERT INTO "counters" ("company_id", "key", "value")
SELECT company_id, 'PO-' || substr(number, 4, 4), max(substr(number, 9)::int)
  FROM "purchase_orders" GROUP BY company_id, substr(number, 4, 4)
ON CONFLICT ("company_id", "key") DO UPDATE SET "value" = greatest("counters"."value", EXCLUDED."value");

-- A supplier named on an order line for the first time gets its purchase order, with the next number of the
-- order's year.
CREATE OR REPLACE FUNCTION purchase_order_for_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  yr text;
  n integer;
BEGIN
  IF NEW.factory_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM "purchase_orders" WHERE order_id = NEW.order_id AND supplier_id = NEW.factory_id) THEN RETURN NEW; END IF;
  SELECT extract(year FROM ordered_on)::int::text INTO yr FROM "orders" WHERE id = NEW.order_id;
  INSERT INTO "counters" (company_id, key, value) VALUES (NEW.company_id, 'PO-' || yr, 1)
    ON CONFLICT (company_id, key) DO UPDATE SET value = "counters".value + 1
    RETURNING value INTO n;
  INSERT INTO "purchase_orders" (company_id, order_id, supplier_id, number)
    VALUES (NEW.company_id, NEW.order_id, NEW.factory_id, 'PO-' || yr || '-' || lpad(n::text, 4, '0'))
    ON CONFLICT (order_id, supplier_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER "purchase_order_for_line" AFTER INSERT OR UPDATE OF "factory_id" ON "order_lines"
  FOR EACH ROW EXECUTE FUNCTION purchase_order_for_line();

CREATE TRIGGER "same_company_purchase_orders_order_id_fkey" BEFORE INSERT OR UPDATE OF "order_id" ON "purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('orders', 'order_id');
CREATE TRIGGER "same_company_purchase_orders_supplier_id_fkey" BEFORE INSERT OR UPDATE OF "supplier_id" ON "purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('parties', 'supplier_id');
CREATE TRIGGER "same_company_purchase_orders_sent_by_fkey" BEFORE INSERT OR UPDATE OF "sent_by" ON "purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('users', 'sent_by');

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "purchase_orders" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_orders" TO kebo_app;
