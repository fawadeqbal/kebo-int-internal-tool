-- Single source of truth, PR 4: plans follow the dates (3 Nov 2026).
-- 1. One ready date per factory (owner, 3 Nov 2026): order_factories keeps each factory's ready date on an
--    order (factory_id null: the goods of an order whose lines name no factory). The order's ready date is the
--    latest of them, worked out; orders.ready_on goes.
-- 2. The customer's payment plan dates itself like the factory plan: each instalment has a due rule
--    (fixed | on_ready | on_ship_plus_days | after_papers) and its date is worked out from the order's dates
--    each time it is read; only a fixed row keeps a date (typed by hand, or the deposit's).
-- 3. An order whose quotation said "letter of credit" and has no route yet gets the LC route (at sight).
-- 4. A factory's offer can say the advance it asks (factory_quotes.advance_percent; empty: Settings' default).
--
-- What happens to existing data (every due date shown today stays as it is):
-- - Each factory on an order with a ready date gets that date (an order without factories: one row).
-- - An instalment dated the way the old stage moves dated it, and still on that date, gets the rule that
--   date came from: a balance "before shipment" on the ready date (or the ship date when there was none)
--   becomes on_ready; another balance on the ship date + the company's balance days becomes
--   on_ship_plus_days. An LC part keeps after_papers when its date is the papers' date + its days.
--   Every other dated instalment becomes fixed on the date it has.
-- - An instalment with no date yet gets the rule the next stage move would have dated it by (LC route:
--   after_papers; balance before shipment: on_ready; else on_ship_plus_days with the company's balance days),
--   so it is dated as soon as that date is known. A deposit without a date stays without one.
-- Company tables as usual: company_id from the connection, row-level security, same-company triggers.
-- Everything here is set-based and safe on an empty database.

-- The offer's advance.
ALTER TABLE "factory_quotes" ADD COLUMN "advance_percent" DECIMAL(5,2);
ALTER TABLE "factory_quotes" ADD CONSTRAINT "factory_quotes_advance_percent_check" CHECK ("advance_percent" IS NULL OR "advance_percent" BETWEEN 0 AND 100);

-- CreateTable
CREATE TABLE "order_factories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "factory_id" UUID,
    "ready_on" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_factories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (nulls not distinct: one "no factory" row per order)
CREATE UNIQUE INDEX "order_factories_order_id_factory_id_key" ON "order_factories"("order_id", "factory_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "order_factories_factory_id_idx" ON "order_factories"("factory_id");

-- CreateIndex
CREATE INDEX "order_factories_company_id_idx" ON "order_factories"("company_id");

-- AddForeignKey
ALTER TABLE "order_factories" ADD CONSTRAINT "order_factories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_factories" ADD CONSTRAINT "order_factories_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_factories" ADD CONSTRAINT "order_factories_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Kept apart per company like every company table.
ALTER TABLE "order_factories" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "order_factories" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_factories" TO kebo_app;

-- Every new link between company tables may only point inside the company.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT cl.relname AS child, pa.relname AS parent, a.attname AS col, k.conname
      FROM pg_constraint k
      JOIN pg_class cl ON cl.oid = k.conrelid
      JOIN pg_class pa ON pa.oid = k.confrelid
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      JOIN pg_attribute pk ON pk.attrelid = k.confrelid AND pk.attnum = k.confkey[1]
     WHERE k.contype = 'f' AND cl.relrowsecurity AND pa.relrowsecurity
       AND array_length(k.conkey, 1) = 1 AND pk.attname = 'id' AND a.attname <> 'company_id'
       AND cl.relnamespace = current_schema()::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = k.conrelid AND tg.tgname = left('same_company_' || k.conname, 63))
     ORDER BY 1, 3
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_company(%L, %L)',
                   left('same_company_' || r.conname, 63), r.col, r.child, r.parent, r.col);
  END LOOP;
END $$;

-- 1. Each factory of an order gets the order's ready date (no factory on its lines: one row for the order).
INSERT INTO "order_factories" ("id", "company_id", "order_id", "factory_id", "ready_on", "created_at", "updated_at")
SELECT gen_random_uuid(), o."company_id", o."id", f."factory_id", o."ready_on", now(), now()
  FROM "orders" o
  JOIN LATERAL (SELECT DISTINCT l."factory_id" FROM "order_lines" l WHERE l."order_id" = o."id" AND l."factory_id" IS NOT NULL) f ON true
 WHERE o."ready_on" IS NOT NULL;

INSERT INTO "order_factories" ("id", "company_id", "order_id", "factory_id", "ready_on", "created_at", "updated_at")
SELECT gen_random_uuid(), o."company_id", o."id", NULL, o."ready_on", now(), now()
  FROM "orders" o
 WHERE o."ready_on" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "order_lines" l WHERE l."order_id" = o."id" AND l."factory_id" IS NOT NULL);

-- 3. The LC route for orders accepted on "letter of credit" with no route yet (where the company's plan has
--    payment routes).
UPDATE "orders" o
   SET "payment_route" = 'letter_of_credit', "lc_terms" = 'at_sight', "balance_when" = NULL
  FROM "companies" c
  LEFT JOIN "plans" p ON p."id" = c."plan_id"
 WHERE c."id" = o."company_id"
   AND o."balance_terms" = 'letter_of_credit' AND o."payment_route" IS NULL
   AND NOT ('bank_contracts' = ANY (c."features_off"))
   AND (p."id" IS NULL OR p."features" IS NULL OR 'bank_contracts' = ANY (p."features"));

-- 2. Due rules on the customer's plan.
ALTER TABLE "payment_plan_items" DROP CONSTRAINT IF EXISTS "payment_plan_items_due_rule_check";

DROP TABLE IF EXISTS "sot4_orders";
CREATE TEMP TABLE "sot4_orders" AS
SELECT o."id" AS order_id, o."payment_route", o."lc_terms", o."lc_days",
       -- The balance terms the route means (balanceTermsOf): "before shipment" or not.
       (CASE
          WHEN o."payment_route" = 'letter_of_credit' THEN 'letter_of_credit'
          WHEN o."payment_route" = 'informal' THEN coalesce(o."balance_when", CASE WHEN o."balance_terms" = 'letter_of_credit' THEN 'before_shipment' ELSE o."balance_terms"::text END)
          WHEN o."payment_route" = 'bank_contract' THEN CASE WHEN o."balance_terms" = 'letter_of_credit' THEN 'against_bl_copy' ELSE o."balance_terms"::text END
          ELSE o."balance_terms"::text
        END) = 'before_shipment' AS before,
       o."ready_on" AS ready,
       (SELECT min(s."departed_on") FROM "shipments" s WHERE s."order_id" = o."id") AS shipped,
       (SELECT b."done_on" FROM "order_bank_steps" b WHERE b."order_id" = o."id" AND b."step" = 'customer_bank_received' ORDER BY b."done_on" LIMIT 1) AS papers,
       coalesce((SELECT CASE WHEN (st."value" ->> 'balanceDays') ~ '^[0-9]+$' THEN (st."value" ->> 'balanceDays')::int END
                   FROM "settings" st WHERE st."company_id" = o."company_id" AND st."key" = 'reminders'), 14) AS balance_days
  FROM "orders" o;

-- An LC part: its rule stays while its date is the papers' date + its days; otherwise the date is kept, fixed.
UPDATE "payment_plan_items" i
   SET "due_rule" = CASE WHEN i."due_on" IS NULL OR i."due_on" = x."papers" + coalesce(i."due_days", 0) THEN 'after_papers' ELSE 'fixed' END,
       "due_on" = CASE WHEN i."due_on" IS NULL OR i."due_on" = x."papers" + coalesce(i."due_days", 0) THEN NULL ELSE i."due_on" END
  FROM "sot4_orders" x
 WHERE x."order_id" = i."order_id" AND i."due_rule" = 'after_papers';

-- A dated balance still on the date a stage move gave it: the rule it came from. Other dated rows: fixed.
UPDATE "payment_plan_items" i
   SET "due_rule" = CASE
                      WHEN i."part" = 'balance' AND x."before" AND i."due_on" = coalesce(x."ready", x."shipped") THEN 'on_ready'
                      WHEN i."part" = 'balance' AND NOT x."before" AND x."payment_route" IS DISTINCT FROM 'letter_of_credit'
                           AND x."shipped" IS NOT NULL AND i."due_on" = x."shipped" + x."balance_days" THEN 'on_ship_plus_days'
                      ELSE 'fixed' END,
       "due_days" = CASE
                      WHEN i."part" = 'balance' AND NOT x."before" AND x."payment_route" IS DISTINCT FROM 'letter_of_credit'
                           AND x."shipped" IS NOT NULL AND i."due_on" = x."shipped" + x."balance_days" THEN x."balance_days"
                      ELSE i."due_days" END
  FROM "sot4_orders" x
 WHERE x."order_id" = i."order_id" AND i."due_rule" IS NULL AND i."due_on" IS NOT NULL;

UPDATE "payment_plan_items" SET "due_on" = NULL WHERE "due_rule" IN ('on_ready', 'on_ship_plus_days');

-- Not dated yet: the rule the next stage move would have dated it by (a deposit without a date stays so).
UPDATE "payment_plan_items" i
   SET "due_rule" = CASE WHEN x."payment_route" = 'letter_of_credit' THEN 'after_papers'
                         WHEN x."before" THEN 'on_ready'
                         ELSE 'on_ship_plus_days' END,
       "due_days" = CASE WHEN x."payment_route" = 'letter_of_credit' THEN CASE WHEN x."lc_terms" = 'deferred' THEN greatest(coalesce(x."lc_days", 0), 0) ELSE 0 END
                         WHEN x."before" THEN NULL
                         ELSE x."balance_days" END
  FROM "sot4_orders" x
 WHERE x."order_id" = i."order_id" AND i."due_rule" IS NULL AND i."due_on" IS NULL
   AND i."part" IS DISTINCT FROM 'deposit';

ALTER TABLE "payment_plan_items" ADD CONSTRAINT "payment_plan_items_due_rule_check"
  CHECK ("due_rule" IS NULL OR "due_rule" IN ('fixed', 'on_ready', 'on_ship_plus_days', 'after_papers'));
ALTER TABLE "payment_plan_items" ADD CONSTRAINT "payment_plan_items_due_on_check"
  CHECK ("due_on" IS NULL OR "due_rule" IS NULL OR "due_rule" = 'fixed');

DROP TABLE "sot4_orders";

-- The order's own ready date goes (each factory's is in order_factories).
ALTER TABLE "orders" DROP COLUMN "ready_on";
