-- Expenses spent on a deal (won or lost) and on visiting a factory.
ALTER TABLE "expenses" ADD COLUMN "inquiry_id" UUID;
ALTER TABLE "expenses" ADD COLUMN "factory_id" UUID;

-- An order's expenses belong to its deal.
UPDATE "expenses" e SET "inquiry_id" = o."inquiry_id" FROM "orders" o WHERE e."order_id" = o."id";

CREATE INDEX "expenses_inquiry_id_idx" ON "expenses"("inquiry_id");
CREATE INDEX "expenses_factory_id_idx" ON "expenses"("factory_id");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
