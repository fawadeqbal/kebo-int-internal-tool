-- CreateEnum
CREATE TYPE "order_stage" AS ENUM ('confirmed', 'in_production', 'shipped', 'done');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "bl_no" VARCHAR(60),
ADD COLUMN     "shipped_on" DATE,
ADD COLUMN     "stage" "order_stage" NOT NULL DEFAULT 'confirmed',
ADD COLUMN     "stage_since" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "order_stage_changes" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_stage" "order_stage",
    "to_stage" "order_stage" NOT NULL,
    "note" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "by" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_stage_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_stage_changes_order_id_at_idx" ON "order_stage_changes"("order_id", "at");

-- AddForeignKey
ALTER TABLE "order_stage_changes" ADD CONSTRAINT "order_stage_changes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stage_changes" ADD CONSTRAINT "order_stage_changes_by_fkey" FOREIGN KEY ("by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing orders: the stage their checklist and records point to.
--   done           the order was closed
--   shipped        the shipping step is settled, or a shipment has left
--   in_production  the deposit or anything on the factory side is done
--   confirmed      otherwise
UPDATE "orders" o SET
  "stage" = CASE
    WHEN o."status" = 'closed' THEN 'done'::"order_stage"
    WHEN EXISTS (SELECT 1 FROM "milestones" m WHERE m."order_id" = o."id" AND m."key" = 'shipped' AND m."status" <> 'todo')
      OR EXISTS (SELECT 1 FROM "shipments" s WHERE s."order_id" = o."id" AND s."status" IN ('departed', 'arrived')) THEN 'shipped'::"order_stage"
    WHEN EXISTS (SELECT 1 FROM "milestones" m WHERE m."order_id" = o."id" AND m."status" = 'done'
      AND m."key" IN ('customer_deposit', 'factory_order', 'factory_deposit', 'factory_confirmed', 'samples_approved', 'inspection_passed')) THEN 'in_production'::"order_stage"
    ELSE 'confirmed'::"order_stage"
  END,
  "shipped_on" = COALESCE(
    (SELECT m."done_on" FROM "milestones" m WHERE m."order_id" = o."id" AND m."key" = 'shipped' AND m."status" = 'done'),
    (SELECT max(s."departed_on") FROM "shipments" s WHERE s."order_id" = o."id")),
  "bl_no" = (SELECT s."bl_no" FROM "shipments" s WHERE s."order_id" = o."id" AND s."bl_no" IS NOT NULL ORDER BY s."departed_on" DESC NULLS LAST, s."created_at" DESC LIMIT 1);

-- Start each order's history with where it stands now, and when the stage began as best known.
UPDATE "orders" o SET "stage_since" = COALESCE(
  CASE o."stage"
    WHEN 'done' THEN o."closed_at"
    WHEN 'shipped' THEN o."shipped_on"::timestamptz
    WHEN 'in_production' THEN (SELECT min(m."done_on")::timestamptz FROM "milestones" m WHERE m."order_id" = o."id" AND m."status" = 'done'
      AND m."key" IN ('customer_deposit', 'factory_order', 'factory_deposit', 'factory_confirmed', 'samples_approved', 'inspection_passed'))
    ELSE o."ordered_on"::timestamptz
  END, o."created_at");

INSERT INTO "order_stage_changes" ("id", "order_id", "from_stage", "to_stage", "note", "by", "at")
SELECT gen_random_uuid(), o."id", NULL, o."stage", 'Stage set from the order''s earlier checklist', NULL, o."stage_since" FROM "orders" o;

CREATE INDEX "orders_stage_idx" ON "orders" ("stage");
