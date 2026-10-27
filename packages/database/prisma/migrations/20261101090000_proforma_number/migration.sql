-- Proforma invoice numbers in Kebo's own format (KEB260916TN07), fixed when the proforma is issued.
ALTER TABLE "customers" ADD COLUMN "initials" VARCHAR(6);
ALTER TABLE "orders" ADD COLUMN "proforma_no" VARCHAR(40);
ALTER TABLE "orders" ADD COLUMN "proforma_issued_on" DATE;
CREATE UNIQUE INDEX "orders_proforma_no_key" ON "orders"("proforma_no");

-- Orders made before keep the number their proforma already had (SO-2026-0005 → PI-2026-0005), dated the order day.
UPDATE "orders"
   SET "proforma_no" = regexp_replace("ref_no", '^[A-Z]+-', 'PI-'),
       "proforma_issued_on" = "ordered_on";
