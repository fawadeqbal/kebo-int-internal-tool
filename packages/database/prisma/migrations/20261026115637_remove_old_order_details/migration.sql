/*
  Warnings:

  - You are about to drop the column `factory_quote_id` on the `attachments` table. All the data in the column will be lost.
  - You are about to drop the column `milestone_id` on the `attachments` table. All the data in the column will be lost.
  - You are about to drop the column `payment_id` on the `attachments` table. All the data in the column will be lost.
  - You are about to drop the column `direction` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `factory_id` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `factory_order_id` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the `factory_order_lines` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `factory_orders` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `invoice_lines` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `invoices` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `milestone_events` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `milestones` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `shipment_lines` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `shipments` table. If the table is not empty, all the data it contains will be lost.

*/
-- The first version's detailed records leave the database. What is still useful is kept first:
-- the packing details of its shipments move onto the order lines (the new packing list).
UPDATE "order_lines" l SET
  "packages" = COALESCE(l."packages", x."packages"),
  "package_type" = COALESCE(l."package_type", x."package_type"),
  "net_weight_kg" = COALESCE(l."net_weight_kg", x."net"),
  "gross_weight_kg" = COALESCE(l."gross_weight_kg", x."gross"),
  "cbm" = COALESCE(l."cbm", x."cbm")
FROM (
  SELECT sl."order_line_id", sum(sl."packages")::int AS "packages", min(sl."package_type") AS "package_type",
         sum(sl."net_weight_kg") AS "net", sum(sl."gross_weight_kg") AS "gross", sum(sl."cbm") AS "cbm"
  FROM "shipment_lines" sl GROUP BY sl."order_line_id"
) x
WHERE x."order_line_id" = l."id";

UPDATE "orders" o SET
  "container_no" = COALESCE(o."container_no", (SELECT left(s."container_nos", 120) FROM "shipments" s WHERE s."order_id" = o."id" AND s."container_nos" IS NOT NULL ORDER BY s."created_at" DESC LIMIT 1)),
  "shipping_marks" = COALESCE(o."shipping_marks", (SELECT s."marks" FROM "shipments" s WHERE s."order_id" = o."id" AND s."marks" IS NOT NULL ORDER BY s."created_at" DESC LIMIT 1)),
  "packed_at" = COALESCE(o."packed_at", (SELECT min(s."created_at") FROM "shipments" s WHERE s."order_id" = o."id"))
WHERE EXISTS (SELECT 1 FROM "shipments" s WHERE s."order_id" = o."id");

-- Payments to factories are no longer recorded; the settings group of the old checklist goes too.
DELETE FROM "payments" WHERE "direction" = 'out';
DELETE FROM "settings" WHERE "key" = 'plan';

-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_factory_quote_id_fkey";

-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_milestone_id_fkey";

-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_payment_id_fkey";

-- DropForeignKey
ALTER TABLE "factory_order_lines" DROP CONSTRAINT "factory_order_lines_factory_order_id_fkey";

-- DropForeignKey
ALTER TABLE "factory_order_lines" DROP CONSTRAINT "factory_order_lines_factory_quote_line_id_fkey";

-- DropForeignKey
ALTER TABLE "factory_order_lines" DROP CONSTRAINT "factory_order_lines_order_line_id_fkey";

-- DropForeignKey
ALTER TABLE "factory_orders" DROP CONSTRAINT "factory_orders_factory_id_fkey";

-- DropForeignKey
ALTER TABLE "factory_orders" DROP CONSTRAINT "factory_orders_order_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_order_line_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_order_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_shipment_id_fkey";

-- DropForeignKey
ALTER TABLE "milestone_events" DROP CONSTRAINT "milestone_events_milestone_id_fkey";

-- DropForeignKey
ALTER TABLE "milestones" DROP CONSTRAINT "milestones_order_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_factory_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_factory_order_id_fkey";

-- DropForeignKey
ALTER TABLE "shipment_lines" DROP CONSTRAINT "shipment_lines_order_line_id_fkey";

-- DropForeignKey
ALTER TABLE "shipment_lines" DROP CONSTRAINT "shipment_lines_shipment_id_fkey";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_order_id_fkey";

-- DropIndex
DROP INDEX "attachments_milestone_id_idx";

-- DropIndex
DROP INDEX "payments_direction_paid_on_idx";

-- AlterTable
ALTER TABLE "attachments" DROP COLUMN "factory_quote_id",
DROP COLUMN "milestone_id",
DROP COLUMN "payment_id";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "direction",
DROP COLUMN "factory_id",
DROP COLUMN "factory_order_id";

-- DropTable
DROP TABLE "factory_order_lines";

-- DropTable
DROP TABLE "factory_orders";

-- DropTable
DROP TABLE "invoice_lines";

-- DropTable
DROP TABLE "invoices";

-- DropTable
DROP TABLE "milestone_events";

-- DropTable
DROP TABLE "milestones";

-- DropTable
DROP TABLE "shipment_lines";

-- DropTable
DROP TABLE "shipments";

-- DropEnum
DROP TYPE "FactoryOrderStatus";

-- DropEnum
DROP TYPE "InvoiceStatus";

-- DropEnum
DROP TYPE "InvoiceType";

-- DropEnum
DROP TYPE "MilestoneKey";

-- DropEnum
DROP TYPE "MilestoneStatus";

-- DropEnum
DROP TYPE "PaymentDirection";

-- DropEnum
DROP TYPE "ShipmentStatus";

-- CreateIndex
CREATE INDEX "payments_paid_on_idx" ON "payments"("paid_on");
