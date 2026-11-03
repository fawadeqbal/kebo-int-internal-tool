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
