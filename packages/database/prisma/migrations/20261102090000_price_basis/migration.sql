-- Step 3: a factory's price basis (EXW, FOB…) and the costs between it and the basis we sell on.
CREATE TYPE "BasisStep" AS ENUM ('to_port', 'freight', 'insurance', 'delivery', 'duties');

-- The free-text price basis becomes an Incoterm and a place where it can be read ("EXW factory" → EXW, "factory").
ALTER TABLE "factory_quotes" ADD COLUMN "basis" "Incoterm";
UPDATE "factory_quotes"
   SET "basis" = upper(substring("price_basis" from '(?i)^\s*(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)(\s|$)'))::"Incoterm"
 WHERE "price_basis" ~* '^\s*(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)(\s|$)';
UPDATE "factory_quotes"
   SET "price_basis" = NULLIF(btrim(regexp_replace("price_basis", '^\s*(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)(\s+|$)', '', 'i')), '')
 WHERE "basis" IS NOT NULL;
ALTER TABLE "factory_quotes" RENAME COLUMN "price_basis" TO "basis_place";

-- An option remembers the factory's basis it was priced on.
ALTER TABLE "quotation_options" ADD COLUMN "factory_basis" "Incoterm";
ALTER TABLE "quotation_options" ADD COLUMN "factory_basis_place" VARCHAR(60);

CREATE TABLE "option_costs" (
    "id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "step" "BasisStep" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "fx_rate" DECIMAL(18,8),
    "note" VARCHAR(200),
    CONSTRAINT "option_costs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "option_costs_amount_check" CHECK ("amount" >= 0)
);
CREATE UNIQUE INDEX "option_costs_option_id_step_key" ON "option_costs"("option_id", "step");
ALTER TABLE "option_costs" ADD CONSTRAINT "option_costs_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "quotation_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;
