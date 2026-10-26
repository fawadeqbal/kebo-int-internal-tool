-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "cbm" DECIMAL(10,3),
ADD COLUMN     "gross_weight_kg" DECIMAL(12,2),
ADD COLUMN     "net_weight_kg" DECIMAL(12,2),
ADD COLUMN     "package_type" VARCHAR(40),
ADD COLUMN     "packages" INTEGER,
ADD COLUMN     "received_on" DATE,
ADD COLUMN     "received_qty" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "container_no" VARCHAR(120),
ADD COLUMN     "packed_at" TIMESTAMPTZ,
ADD COLUMN     "shipping_marks" TEXT;

-- Sensible values only.
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_received_qty_check" CHECK ("received_qty" >= 0 AND "received_qty" <= "quantity");
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_packing_check" CHECK (
  ("packages" IS NULL OR "packages" >= 0) AND ("net_weight_kg" IS NULL OR "net_weight_kg" >= 0)
  AND ("gross_weight_kg" IS NULL OR "gross_weight_kg" >= 0) AND ("cbm" IS NULL OR "cbm" >= 0));

-- Orders whose goods already left: everything came in from the factory.
UPDATE "order_lines" l SET "received_qty" = l."quantity", "received_on" = o."shipped_on"
FROM "orders" o
WHERE l."order_id" = o."id" AND l."type" = 'goods' AND o."stage" IN ('shipped', 'done');
