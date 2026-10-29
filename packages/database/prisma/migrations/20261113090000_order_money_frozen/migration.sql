-- Money fixes. An order keeps everything its profit and debts are worked out from,
-- frozen when it is made, so later changes elsewhere never move it:
--   1. the costs to reach the basis we sold on (EXW → CFR: to the port, freight…), copied from the accepted option;
--   2. each line's factory price, tax and currency (what we owe the factory);
--   3. the main currency and the rate of the order's currency against it (revenue in the main currency).
-- Rates get more decimals (a PKR company's USD rate is 0.00357142857143, not 0.003571).
-- Every step only adds columns or rows, or widens a column; no existing value is changed or removed.

-- 1. The order's costs to reach the basis it was sold on.
CREATE TABLE "order_costs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "order_id" UUID NOT NULL,
    "step" "BasisStep" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "fx_rate" DECIMAL(18,8),
    "note" VARCHAR(200),
    CONSTRAINT "order_costs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_costs_amount_check" CHECK ("amount" >= 0 AND "cost" >= 0)
);
CREATE UNIQUE INDEX "order_costs_order_id_step_key" ON "order_costs"("order_id", "step");
CREATE INDEX "order_costs_company_id_idx" ON "order_costs"("company_id");
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Kept apart per company like every company table (see the companies migration).
ALTER TABLE "order_costs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "order_costs"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_costs" TO kebo_app;
CREATE TRIGGER "same_company_order_costs_order_id_fkey" BEFORE INSERT OR UPDATE OF "order_id" ON "order_costs"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('orders', 'order_id');

-- Existing orders: the costs of the option they were made from (the option their lines came from,
-- else the accepted option of their revision). Orders without such costs get none.
WITH chosen AS (
  SELECT o.id AS order_id, o.company_id,
         coalesce(
           (SELECT min(ql.option_id::text)::uuid FROM order_lines ol JOIN quote_lines ql ON ql.id = ol.quote_line_id
             WHERE ol.order_id = o.id
            HAVING count(DISTINCT ql.option_id) = 1),
           (SELECT min(qo.id::text)::uuid FROM quotation_options qo
             WHERE qo.revision_id = o.revision_id AND qo.status = 'accepted'
            HAVING count(*) = 1)
         ) AS option_id
  FROM orders o
)
INSERT INTO "order_costs" ("id", "company_id", "order_id", "step", "amount", "currency", "cost", "fx_rate", "note")
SELECT gen_random_uuid(), c.company_id, c.order_id, oc.step, oc.amount, oc.currency, oc.cost, oc.fx_rate, oc.note
FROM chosen c
JOIN option_costs oc ON oc.option_id = c.option_id
WHERE oc.cost > 0
ON CONFLICT ("order_id", "step") DO NOTHING;

-- 2. Each order line's factory price, frozen.
ALTER TABLE "order_lines"
  ADD COLUMN "factory_id" UUID,
  ADD COLUMN "factory_unit_price" DECIMAL(14,2),
  ADD COLUMN "factory_tax_rate" DECIMAL(5,2),
  ADD COLUMN "factory_currency" CHAR(3);
CREATE INDEX "order_lines_factory_id_idx" ON "order_lines"("factory_id");
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "same_company_order_lines_factory_id_fkey" BEFORE INSERT OR UPDATE OF "factory_id" ON "order_lines"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('factories', 'factory_id');

-- Existing orders: the factory's price as it is now (what was owed until today). Lines whose factory
-- price was already removed keep nothing, as before (nothing was owed for them).
UPDATE "order_lines" ol
   SET "factory_id" = fq.factory_id,
       "factory_unit_price" = fql.unit_price,
       "factory_tax_rate" = fql.tax_rate,
       "factory_currency" = fq.currency
  FROM quote_lines ql
  JOIN factory_quote_lines fql ON fql.id = ql.factory_quote_line_id
  JOIN factory_quotes fq ON fq.id = fql.factory_quote_id
 WHERE ql.id = ol.quote_line_id
   AND ol.factory_unit_price IS NULL;

-- 3. The order's main currency and its rate, frozen.
ALTER TABLE "orders"
  ADD COLUMN "main_currency" CHAR(3),
  ADD COLUMN "main_rate" DECIMAL(24,14);
ALTER TABLE "orders" ADD CONSTRAINT "orders_main_rate_check" CHECK ("main_rate" IS NULL OR "main_rate" > 0);

-- Existing orders: the company's main currency and rate in Settings now, so they stop moving when the
-- rates change. Defaults as in @kebo/shared (USD; CNY 7.1) when the company never saved its rates.
-- An order whose currency has no rate keeps none (Settings is used, and the missing rate is shown).
UPDATE "orders" o
   SET "main_currency" = s.main,
       "main_rate" = CASE
         WHEN o.currency = s.main THEN 1
         WHEN jsonb_typeof(s.rates -> o.currency) = 'number' AND (s.rates ->> o.currency)::numeric > 0
           THEN round((s.rates ->> o.currency)::numeric, 14)
         ELSE NULL
       END
  FROM (
    SELECT c.id AS company_id,
           upper(coalesce(st.value ->> 'currency', 'USD')) AS main,
           CASE WHEN jsonb_typeof(st.value -> 'exchangeRates') = 'object' THEN st.value -> 'exchangeRates' ELSE '{"CNY": 7.1}'::jsonb END AS rates
      FROM companies c
      LEFT JOIN settings st ON st.company_id = c.id AND st.key = 'sales'
  ) s
 WHERE s.company_id = o.company_id
   AND o.main_currency IS NULL;

-- 4. More decimals for rates (widening only: every stored rate keeps its value).
ALTER TABLE "expenses" ALTER COLUMN "rate" SET DATA TYPE DECIMAL(24,14);
ALTER TABLE "factory_payments" ALTER COLUMN "rate" SET DATA TYPE DECIMAL(24,14);
ALTER TABLE "quote_lines" ALTER COLUMN "fx_rate" SET DATA TYPE DECIMAL(24,14);
