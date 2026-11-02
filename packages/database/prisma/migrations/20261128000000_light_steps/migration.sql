-- Order v4 (light checklist, view below): a few plain fields the light rows and the view cards ask for.
-- - orders.factory_order_no: the factory's own order number ("their order no."), asked when we order;
-- - orders.delivery_received_by: who received the goods at the customer's;
-- - shipments.seal_no, shipments.loaded_on: the container's seal and the day it was loaded;
-- - shipments.vgm_kg: the verified gross mass of the container (optional, "+ Gross weight (VGM)").
-- Both tables are company tables already (row-level security, company_isolation): no new policy is needed.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "factory_order_no" VARCHAR(60),
ADD COLUMN "delivery_received_by" VARCHAR(120);

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN "seal_no" VARCHAR(40),
ADD COLUMN "loaded_on" DATE,
ADD COLUMN "vgm_kg" DECIMAL(10,2);
