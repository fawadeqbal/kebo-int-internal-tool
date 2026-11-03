-- Factory prices: tax included or not, 0% by default (3 Nov 2026).
-- Each factory offer now says whether its prices are without tax (the tax % is added on top, as until now)
-- or have the tax included (the price is our cost; the tax inside is only shown), and has a tax % that its
-- lines take (a line can still have its own). New offers start at the company's default, Without tax · 0%.
-- Plain columns on company tables: the tables' row-level security and grants already cover them.
-- Nothing already entered changes: every existing offer is "without tax" at the rate its lines have, so
-- every cost, margin, factory debt and profit stays exactly as it was.

-- 1. The offer's choice and its tax %.
ALTER TABLE "factory_quotes"
  ADD COLUMN "tax_included" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "factory_quotes" ADD CONSTRAINT "factory_quotes_tax_rate_check" CHECK ("tax_rate" >= 0 AND "tax_rate" <= 100);

-- Existing offers: the rate most of their lines have (an offer without lines: 13, the old default),
-- prices without tax as before.
UPDATE "factory_quotes" q
   SET "tax_rate" = coalesce(
         (SELECT mode() WITHIN GROUP (ORDER BY l."tax_rate") FROM "factory_quote_lines" l WHERE l."factory_quote_id" = q."id"),
         13),
       "tax_included" = false;

-- 2. A new line's tax % comes from its offer; without one, 0 (was 13). Lines keep their own rate.
ALTER TABLE "factory_quote_lines" ALTER COLUMN "tax_rate" SET DEFAULT 0;

-- 3. Order lines freeze, beside the factory's price and tax %, whether that price had the tax in it.
--    Existing order lines: no (the tax was added on top, as it still is for them).
ALTER TABLE "order_lines" ADD COLUMN "factory_tax_included" BOOLEAN NOT NULL DEFAULT false;
