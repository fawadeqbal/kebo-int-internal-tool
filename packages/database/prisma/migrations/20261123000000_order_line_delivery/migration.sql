-- Order flow v3, phase 2: the order's lines are kept once and each step opens them in the line table with
-- its own columns. Delivery & SAT records what reached the customer, line by line: how many, in what
-- condition and a short note. order_lines is already a company table (row-level security, company_id from
-- the connection); new columns need nothing more.

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "delivered_condition" TEXT,
ADD COLUMN     "delivered_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "delivery_note" VARCHAR(200);

ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_delivered_condition_check"
  CHECK ("delivered_condition" IS NULL OR "delivered_condition" IN ('good', 'minor_damage', 'damaged', 'missing'));
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_delivered_qty_check" CHECK ("delivered_qty" >= 0);
