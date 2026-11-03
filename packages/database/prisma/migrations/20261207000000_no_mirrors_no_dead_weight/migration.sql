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
