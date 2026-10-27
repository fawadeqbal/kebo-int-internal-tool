-- Expenses spent on a customer (dinners, tickets to visit them…), and a receipt per expense.
ALTER TABLE "expenses" ADD COLUMN "customer_id" UUID;
ALTER TABLE "expenses" ADD COLUMN "receipt_key" TEXT;
ALTER TABLE "expenses" ADD COLUMN "receipt_name" VARCHAR(255);
ALTER TABLE "expenses" ADD COLUMN "receipt_type" VARCHAR(150);
ALTER TABLE "expenses" ADD COLUMN "receipt_size" INTEGER;

-- An order's expenses are spent on its customer.
UPDATE "expenses" e SET "customer_id" = o."customer_id" FROM "orders" o WHERE e."order_id" = o."id";

CREATE INDEX "expenses_customer_id_idx" ON "expenses"("customer_id");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New kinds: hotels, meals & entertainment, gifts, electricity/internet/phone.
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_category_check";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_check" CHECK ("category" IN ('travel', 'hotel', 'meals', 'gifts', 'samples', 'freight', 'inland_transport', 'inspection', 'customs', 'bank_charges', 'commission', 'rent', 'salaries', 'utilities', 'office', 'other'));
