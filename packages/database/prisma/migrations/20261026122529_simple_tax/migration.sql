-- Tax, kept simple: Kebo exports, so customers carry no VAT setting; a factory's VAT and the
-- export rebate are chosen once per factory price quote (not per line, not per factory).

-- 1. The VAT and rebate move from each line to its quote (the highest found on its lines).
ALTER TABLE "factory_quotes" ADD COLUMN "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 13,
ADD COLUMN "rebate_rate" DECIMAL(5,2) NOT NULL DEFAULT 0;

UPDATE "factory_quotes" q SET "vat_rate" = x."vat", "rebate_rate" = x."rebate"
FROM (SELECT "factory_quote_id", max("vat_rate") AS "vat", max("rebate_rate") AS "rebate" FROM "factory_quote_lines" GROUP BY "factory_quote_id") x
WHERE x."factory_quote_id" = q."id";

ALTER TABLE "factory_quote_lines" DROP COLUMN "rebate_rate",
DROP COLUMN "vat_rate";

-- 2. Defaults on the factory and the customer's tax treatment are no longer used.
ALTER TABLE "factories" DROP COLUMN "default_vat_rate",
DROP COLUMN "prices_include_vat";

ALTER TABLE "customers" DROP COLUMN "tax_treatment";

DROP TYPE "TaxTreatment";

-- 3. Selling VAT and its default are gone from Settings (old values are simply ignored).
UPDATE "settings" SET "value" = "value" - 'vatRate' - 'pricesIncludeVat' WHERE "key" = 'sales';
