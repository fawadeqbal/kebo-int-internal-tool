-- The order without checklists, step 0: the places the order's sections keep what the checklist lines kept.
-- Nothing is removed here; the checklist tables go in a later migration, after every screen reads these.

-- A file belongs to one section of the order's page (booking, vessel, fat…), not only to a stage.
ALTER TABLE "attachments"
  ADD COLUMN "section" VARCHAR(30);
CREATE INDEX "attachments_order_id_section_idx" ON "attachments" ("order_id", "section");

-- Production, per factory of the order: when and how the ready date was told, the factory test (FAT),
-- and where the goods were received.
ALTER TABLE "order_factories"
  ADD COLUMN "ready_told_on" DATE,
  ADD COLUMN "ready_told_via" VARCHAR(20),
  ADD COLUMN "ready_note" VARCHAR(500),
  ADD COLUMN "fat_planned_on" DATE,
  ADD COLUMN "fat_attended_by" UUID,
  ADD COLUMN "fat_done_on" DATE,
  ADD COLUMN "fat_result" VARCHAR(20),
  ADD COLUMN "fat_remarks" VARCHAR(1000),
  ADD COLUMN "goods_received_at" VARCHAR(160);
ALTER TABLE "order_factories"
  ADD CONSTRAINT "order_factories_fat_attended_by_fkey" FOREIGN KEY ("fat_attended_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Shipping: how the freight is paid and what the goods are insured for.
ALTER TABLE "shipments"
  ADD COLUMN "freight_terms" VARCHAR(10),
  ADD COLUMN "insured_value" DECIMAL(14, 2);

-- A claim: what it is worth and who bears it.
ALTER TABLE "order_claims"
  ADD COLUMN "amount" DECIMAL(14, 2),
  ADD COLUMN "currency" CHAR(3),
  ADD COLUMN "bearer" VARCHAR(10);

-- The sales contract: the day each side signed.
ALTER TABLE "order_documents"
  ADD COLUMN "signed_by_us_on" DATE,
  ADD COLUMN "signed_by_them_on" DATE;

-- The original papers couriered to the customer.
ALTER TABLE "orders"
  ADD COLUMN "originals_courier" VARCHAR(60),
  ADD COLUMN "originals_tracking_no" VARCHAR(80),
  ADD COLUMN "originals_sent_on" DATE,
  ADD COLUMN "originals_note" VARCHAR(500);

-- What the factory test's checklist line collected (date, result, video) moves to the factory's row, so
-- nothing typed is lost when the checklist goes. The old "result" was free text: it becomes the remarks.
UPDATE "order_factories" f
SET "fat_done_on" = CASE WHEN c."data"->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (c."data"->>'date')::date ELSE NULL END,
    "fat_remarks" = NULLIF(LEFT(c."data"->>'result', 1000), '')
FROM "order_checklist_items" c
WHERE c."order_id" = f."order_id"
  AND c."paper" = 'fat-report'
  AND (c."factory_id" IS NULL OR c."factory_id" IS NOT DISTINCT FROM f."factory_id")
  AND f."fat_done_on" IS NULL
  AND (c."data"->>'date' IS NOT NULL OR c."data"->>'result' IS NOT NULL);

-- Its video becomes a file of the Factory test section; a file attached to the line too.
UPDATE "attachments" a
SET "section" = 'fat', "step" = COALESCE(a."step", 'production'), "order_id" = COALESCE(a."order_id", c."order_id")
FROM "order_checklist_items" c
WHERE c."paper" = 'fat-report'
  AND (a."id"::text = c."data"->>'video' OR a."id" = c."attachment_id");
