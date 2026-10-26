-- AlterEnum
ALTER TYPE "RevisionStatus" ADD VALUE 'void';

-- DropIndex
DROP INDEX "orders_inquiry_id_key";

-- CreateIndex
CREATE INDEX "orders_inquiry_id_idx" ON "orders"("inquiry_id");

-- A deal has at most one order that is not cancelled (a cancelled order's deal can be reopened and won again).
CREATE UNIQUE INDEX "orders_one_active_per_inquiry" ON "orders" ("inquiry_id") WHERE "status" <> 'cancelled';
