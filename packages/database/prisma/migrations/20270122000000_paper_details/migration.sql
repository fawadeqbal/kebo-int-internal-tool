-- Papers in the customer's format (25 Nov 2026): the LC's bank reference and the customer's bank's address for
-- the papers' "Notify bank", and the packing list case by case (each case's number, package, size and weights).

ALTER TABLE "order_bank_contracts" ADD COLUMN "customer_bank_address" VARCHAR(300),
  ADD COLUMN "reference" VARCHAR(60);

-- "Fumigated solid wooden case (IPPC)" and the like fit.
ALTER TABLE "order_lines" ALTER COLUMN "package_type" TYPE VARCHAR(80);

-- CreateTable
CREATE TABLE "order_line_cases" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "line_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "case_no" VARCHAR(20),
    "count" INTEGER NOT NULL DEFAULT 1,
    "package_type" VARCHAR(80) NOT NULL DEFAULT 'Carton',
    "length_mm" INTEGER,
    "width_mm" INTEGER,
    "height_mm" INTEGER,
    "net_weight_kg" DECIMAL(12,2),
    "gross_weight_kg" DECIMAL(12,2),
    "cbm" DECIMAL(10,3),

    CONSTRAINT "order_line_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_line_cases_line_id_idx" ON "order_line_cases"("line_id");

-- CreateIndex
CREATE INDEX "order_line_cases_company_id_idx" ON "order_line_cases"("company_id");

-- AddForeignKey
ALTER TABLE "order_line_cases" ADD CONSTRAINT "order_line_cases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_cases" ADD CONSTRAINT "order_line_cases_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Kept apart per company like every company table.
ALTER TABLE "order_line_cases" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "order_line_cases"
  USING (company_id = (SELECT app_company()))
  WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_line_cases" TO kebo_app;
CREATE TRIGGER "same_company_order_line_cases_line_id_fkey" BEFORE INSERT OR UPDATE OF "line_id" ON "order_line_cases"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('order_lines', 'line_id');

-- Today's packing becomes each item's first row: its packages, how they are packed, its weights and volume (no
-- sizes yet). The items keep their totals as they are.
INSERT INTO "order_line_cases" ("id", "company_id", "line_id", "sort_order", "count", "package_type", "net_weight_kg", "gross_weight_kg", "cbm")
SELECT gen_random_uuid(), l.company_id, l.id, 0, COALESCE(l.packages, 0), COALESCE(NULLIF(l.package_type, ''), 'Carton'),
       l.net_weight_kg, l.gross_weight_kg, l.cbm
FROM "order_lines" l
WHERE l.type = 'goods' AND (l.packages IS NOT NULL OR l.net_weight_kg IS NOT NULL OR l.gross_weight_kg IS NOT NULL OR l.cbm IS NOT NULL);
