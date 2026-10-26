-- Tax, one simple rule everywhere: prices are WITHOUT tax, and the tax % is
-- added on top when the price is entered (e.g. 100 + 13% = 113).
--   factory prices: tax % chosen with each price (13% unless changed),
--   the export rebate per product, remembered by HS code,
--   the customer's country gives the tax on the sale (China only),
--   the order tracks the factory's VAT invoice and the rebate filing.

-- 1. Factories carry no tax setting.
ALTER TABLE "factories" DROP COLUMN "default_vat_rate";
ALTER TABLE "factories" DROP COLUMN "prices_include_vat";

-- 2. Factory prices: old prices entered WITH tax are turned into prices without it (same cost).
UPDATE "factory_quote_lines" l SET "unit_price" = round(l."unit_price" / (1 + l."vat_rate" / 100), 2)
FROM "factory_quotes" q
WHERE q."id" = l."factory_quote_id" AND q."prices_include_vat" AND l."vat_rate" > 0;
--    One tax % per price quote (the highest of its lines), added on top.
ALTER TABLE "factory_quotes" ADD COLUMN "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 13;
UPDATE "factory_quotes" q SET "vat_rate" = x."vat"
FROM (SELECT "factory_quote_id", max("vat_rate") AS "vat" FROM "factory_quote_lines" GROUP BY "factory_quote_id") x
WHERE x."factory_quote_id" = q."id";
ALTER TABLE "factory_quotes" ADD CONSTRAINT "factory_quotes_vat_rate_check" CHECK ("vat_rate" >= 0 AND "vat_rate" <= 100);
ALTER TABLE "factory_quotes" DROP COLUMN "prices_include_vat";
ALTER TABLE "factory_quote_lines" DROP COLUMN "vat_rate";
ALTER TABLE "factory_quote_lines" ADD COLUMN "hs_code" VARCHAR(20);

-- 3. Rebate rates remembered by HS code.
CREATE TABLE "hs_codes" (
    "code" VARCHAR(20) NOT NULL,
    "rebate_rate" DECIMAL(5,2) NOT NULL,
    "description" VARCHAR(200),
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "hs_codes_pkey" PRIMARY KEY ("code")
);
ALTER TABLE "hs_codes" ADD CONSTRAINT "hs_codes_rebate_rate_check" CHECK ("rebate_rate" >= 0 AND "rebate_rate" <= 100);

-- 4. Orders: the export rebate paperwork.
ALTER TABLE "orders" ADD COLUMN "vat_invoice_received_on" DATE,
ADD COLUMN "rebate_filed_on" DATE;

-- 5. Customers no longer carry a tax setting: their country decides (China = tax on the sale).
ALTER TABLE "customers" DROP COLUMN "tax_treatment";
DROP TYPE "TaxTreatment";

-- 6. Settings no longer hold a selling tax rate or an "includes tax" switch.
UPDATE "settings" SET "value" = "value" - 'vatRate' - 'pricesIncludeVat' WHERE "key" = 'sales';
