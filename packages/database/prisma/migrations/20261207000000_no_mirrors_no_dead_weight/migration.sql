-- Single source of truth, PR 5: no mirrors, no dead weight (3 Nov 2026).
-- Every statement is set-based and safe on an empty database.

-- 1. A quotation revision keeps no figures of its own. Its total, discount and lead time are its options'
--    (the accepted one, else Option A); reports count the accepted option, or the lowest–highest of a sent
--    revision's options. quotation_revisions.subtotal / discount / total / lead_time go.
--
-- What happens to existing data:
-- a. A revision without options (none are expected: every revision became Option A on 29 Oct) gets Option A
--    from its own figures, so nothing is lost.
-- b. A lead time typed on the revision reaches the option that speaks for it (accepted, else Option A) when
--    that option has none.
-- c. Where the revision's own total differed from that option's (the copy had drifted), the option's is kept
--    (it is worked out from its lines) and the revision's old figure is written into the history.

INSERT INTO "quotation_options" ("id", "company_id", "revision_id", "letter", "sort_order", "status", "lead_time", "subtotal", "discount", "total")
SELECT gen_random_uuid(), r."company_id", r."id", 'A', 0,
       (CASE WHEN r."status" IN ('accepted', 'void') THEN 'accepted' ELSE 'open' END)::"OptionStatus",
       r."lead_time", r."subtotal", r."discount", r."total"
  FROM "quotation_revisions" r
 WHERE NOT EXISTS (SELECT 1 FROM "quotation_options" o WHERE o."revision_id" = r."id");

DROP TABLE IF EXISTS "sot5_speaks";
CREATE TEMP TABLE "sot5_speaks" AS
SELECT r."id" AS revision_id, r."company_id", r."number", q."ref_no", nullif(btrim(r."lead_time"), '') AS lead_time, r."total",
       (SELECT o."id" FROM "quotation_options" o WHERE o."revision_id" = r."id"
         ORDER BY (o."status" = 'accepted') DESC, o."sort_order", o."letter" LIMIT 1) AS option_id
  FROM "quotation_revisions" r
  JOIN "quotations" q ON q."id" = r."quotation_id";

UPDATE "quotation_options" o
   SET "lead_time" = x."lead_time"
  FROM "sot5_speaks" x
 WHERE o."id" = x."option_id" AND x."lead_time" IS NOT NULL AND nullif(btrim(o."lead_time"), '') IS NULL;

INSERT INTO "audit_logs" ("id", "company_id", "user_id", "action", "entity_type", "entity_id", "summary", "old_values", "new_values")
SELECT gen_random_uuid(), x."company_id", NULL, 'update', 'quotation', x."revision_id",
       x."ref_no" || ' R' || x."number" || ': the revision''s own total ' || x."total"::text || ' differed from Option ' || o."letter" ||
         '''s ' || o."total"::text || ': the option''s is kept (a revision keeps no figures of its own)',
       jsonb_build_object('total', x."total"::text),
       jsonb_build_object('option', o."letter", 'total', o."total"::text)
  FROM "sot5_speaks" x
  JOIN "quotation_options" o ON o."id" = x."option_id"
 WHERE o."total" <> x."total";

DROP TABLE "sot5_speaks";

ALTER TABLE "quotation_revisions" DROP CONSTRAINT IF EXISTS "quotation_revisions_amounts";
ALTER TABLE "quotation_revisions" DROP COLUMN "lead_time",
                                  DROP COLUMN "subtotal",
                                  DROP COLUMN "discount",
                                  DROP COLUMN "total";

-- 2. The condition the goods arrived in is the goods lines' (the worst of them: damaged, then partly delivered
--    (a line missing or short), then minor damage, then good; worked out, never stored on the order).
--    orders.delivery_condition and its type go; orders.delivery_note stays.
--
-- What happens to existing data:
-- a. Goods lines with no condition, on an order that said good / minor damage / damaged, take the order's.
--    Those with nothing recorded as delivered take the ordered quantity (what the delivery note printed for them).
-- b. "Partly delivered" cannot be put on a line (which one was short is not known): the lines are left as they
--    are, and the order's word goes into the history (below).
-- c. Where the order's condition differs from what its lines now give, the order's is written into the history.

UPDATE "order_lines" l
   SET "delivered_condition" = o."delivery_condition"::text,
       "delivered_qty" = CASE WHEN l."delivered_qty" = 0 THEN l."quantity" ELSE l."delivered_qty" END
  FROM "orders" o
 WHERE l."order_id" = o."id" AND l."type" = 'goods' AND l."delivered_condition" IS NULL
   AND o."delivery_condition" IN ('good', 'minor_damage', 'damaged');

WITH worked AS (
  SELECT o."id", o."company_id", o."ref_no", o."delivery_condition"::text AS was,
         CASE WHEN NOT EXISTS (SELECT 1 FROM "order_lines" l WHERE l."order_id" = o."id" AND l."type" = 'goods' AND l."delivered_condition" IS NOT NULL) THEN NULL
              WHEN EXISTS (SELECT 1 FROM "order_lines" l WHERE l."order_id" = o."id" AND l."type" = 'goods' AND l."delivered_condition" = 'damaged') THEN 'damaged'
              WHEN EXISTS (SELECT 1 FROM "order_lines" l WHERE l."order_id" = o."id" AND l."type" = 'goods' AND l."delivered_condition" IS NOT NULL
                             AND (l."delivered_condition" = 'missing' OR l."delivered_qty" < l."quantity")) THEN 'partial'
              WHEN EXISTS (SELECT 1 FROM "order_lines" l WHERE l."order_id" = o."id" AND l."type" = 'goods' AND l."delivered_condition" = 'minor_damage') THEN 'minor_damage'
              ELSE 'good' END AS now
    FROM "orders" o
   WHERE o."delivery_condition" IS NOT NULL
)
INSERT INTO "audit_logs" ("id", "company_id", "user_id", "action", "entity_type", "entity_id", "summary", "old_values", "new_values")
SELECT gen_random_uuid(), w."company_id", NULL, 'flow.delivery', 'order', w."id",
       w."ref_no" || ': the order said ' || (CASE w."was" WHEN 'partial' THEN 'partly delivered' ELSE replace(w."was", '_', ' ') END) ||
         ', its lines say ' || coalesce(CASE w."now" WHEN 'partial' THEN 'partly delivered' ELSE replace(w."now", '_', ' ') END, 'nothing yet') ||
         ': the condition is the lines'' from now on (one place for it)',
       jsonb_build_object('deliveryCondition', w."was"),
       jsonb_build_object('step', 'delivery', 'condition', w."now")
  FROM worked w
 WHERE w."now" IS DISTINCT FROM w."was";

ALTER TABLE "orders" DROP COLUMN "delivery_condition";
DROP TYPE "DeliveryCondition";

-- 3. The old production timeline table: unused since the timeline became the checklist's Production items
--    (20261122000000_order_checklist copied every row into order_checklist_items, with the same id).
--    It goes. Refused if it holds a row that is not in the checklist (nothing that is anywhere else is lost).
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "production_steps" p
   WHERE NOT EXISTS (SELECT 1 FROM "order_checklist_items" c WHERE c."id" = p."id");
  IF n > 0 THEN
    RAISE EXCEPTION 'production_steps has % row(s) that are not in the order checklist: move them into order_checklist_items (step production) before this migration', n;
  END IF;
END $$;

DROP TABLE "production_steps";

-- 4. A payment is in its order's currency (its amount is "what it counts as on the order"; what really arrived
--    is received_amount / received_currency). The database now holds it to that, so readers no longer filter
--    payments on their currency. A live payment in another currency could not be counted (its rate is not
--    known): the migration refuses while there is one (void it and record it again in the order's currency).
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "payments" p JOIN "orders" o ON o."id" = p."order_id"
   WHERE p."voided_at" IS NULL AND p."currency" <> o."currency";
  IF n > 0 THEN
    RAISE EXCEPTION '% live payment(s) are not in their order''s currency: void them and record them again in the order''s currency before this migration', n;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION payment_in_order_currency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  SELECT o."currency" INTO c FROM "orders" o WHERE o."id" = NEW."order_id";
  IF c IS NOT NULL AND NEW."currency" <> c THEN
    RAISE EXCEPTION 'a payment is in its order''s currency (%), not %', c, NEW."currency" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "payments_in_order_currency" BEFORE INSERT OR UPDATE OF "currency", "order_id" ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payment_in_order_currency();

-- An order's currency does not change under its payments either.
CREATE OR REPLACE FUNCTION order_currency_keeps_payments() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "payments" p WHERE p."order_id" = NEW."id" AND p."voided_at" IS NULL AND p."currency" <> NEW."currency") THEN
    RAISE EXCEPTION 'order % has payments in %: its currency stays', NEW."ref_no", OLD."currency" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "orders_currency_keeps_payments" BEFORE UPDATE OF "currency" ON "orders"
  FOR EACH ROW WHEN (NEW."currency" IS DISTINCT FROM OLD."currency") EXECUTE FUNCTION order_currency_keeps_payments();

-- 5. The FAT and inspection reports read the checklist item bound to them by its `paper` key, no longer
--    one found by its title. Bound here: the Production items (not Make / Send) the title rule found,
--    on orders and in the company's list. Renaming an item no longer loses its report.
UPDATE "order_checklist_items" SET "paper" = 'fat-report'
 WHERE "step" = 'production' AND "paper" IS NULL AND "tool" NOT IN ('make', 'send')
   AND "title" ~* '\yFAT\y|factory (acceptance |test)';
UPDATE "order_checklist_items" SET "paper" = 'inspection-report'
 WHERE "step" = 'production' AND "paper" IS NULL AND "tool" NOT IN ('make', 'send')
   AND "title" ~* 'inspection';
UPDATE "checklist_templates" SET "paper" = 'fat-report'
 WHERE "step" = 'production' AND "paper" IS NULL AND "tool" NOT IN ('make', 'send')
   AND "title" ~* '\yFAT\y|factory (acceptance |test)';
UPDATE "checklist_templates" SET "paper" = 'inspection-report'
 WHERE "step" = 'production' AND "paper" IS NULL AND "tool" NOT IN ('make', 'send')
   AND "title" ~* 'inspection';
