-- Step 2c: lines are made at factory prices; each offer keeps its own evidence files.

-- The same product across factories' offers (a line copied from another offer keeps its key).
ALTER TABLE "factory_quote_lines" ADD COLUMN "product_key" UUID;
CREATE INDEX "factory_quote_lines_product_key_idx" ON "factory_quote_lines"("product_key");

-- Files that belong to a factory offer (its quotation, catalogue, screenshots).
ALTER TABLE "attachments" ADD COLUMN "factory_quote_id" UUID;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_factory_quote_id_fkey" FOREIGN KEY ("factory_quote_id") REFERENCES "factory_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "attachments_factory_quote_id_idx" ON "attachments"("factory_quote_id");

ALTER TABLE "attachments" DROP CONSTRAINT "attachments_kind_check";
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_kind_check" CHECK ("kind" IN ('urs', 'drawing', 'photo', 'specification', 'factory_quote', 'other'));
