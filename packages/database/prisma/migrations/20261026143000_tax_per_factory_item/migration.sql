-- Tax only on factory items: each factory price item has its own tax %,
-- added on top of its price. Nothing else about tax is kept: no export
-- rebate, no HS codes, no tax on sales, no rebate paperwork on orders.

-- 0. Sales tax is dropped: refuse if any quotation actually carried some
--    (its printed total would no longer add up). None do in Kebo's data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "quotation_revisions" WHERE "vat_amount" <> 0) THEN
    RAISE EXCEPTION 'Some quotations carry sales tax (vat_amount <> 0); remove it from them before this migration.';
  END IF;
END $$;

-- 1. The tax % moves from the factory quote onto each of its items.
ALTER TABLE "factory_quote_lines" ADD COLUMN "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 13;
UPDATE "factory_quote_lines" l SET "tax_rate" = q."vat_rate" FROM "factory_quotes" q WHERE q."id" = l."factory_quote_id";
ALTER TABLE "factory_quote_lines" ADD CONSTRAINT "factory_quote_lines_tax_rate_check" CHECK ("tax_rate" >= 0 AND "tax_rate" <= 100);
ALTER TABLE "factory_quotes" DROP COLUMN "vat_rate";

-- 2. No export rebate and no HS codes.
ALTER TABLE "factory_quote_lines" DROP COLUMN "rebate_rate", DROP COLUMN "hs_code";
DROP TABLE "hs_codes";
ALTER TABLE "quote_lines" DROP COLUMN "hs_code";
ALTER TABLE "order_lines" DROP COLUMN "hs_code";
ALTER TABLE "orders" DROP COLUMN "vat_invoice_received_on", DROP COLUMN "rebate_filed_on";

-- 3. No tax on sales: a quotation's total is its items less the discount.
ALTER TABLE "quotation_revisions" DROP COLUMN "vat_rate", DROP COLUMN "prices_include_vat", DROP COLUMN "vat_amount";
