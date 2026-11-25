-- Packing for machines (25 Nov 2026): each package says what is in it and which shipment takes it, so an order sent
-- in more than one lot (the machines by sea, the spare parts by air) packs each lot apart.

ALTER TABLE "order_line_cases" ADD COLUMN "contents" VARCHAR(120),
  ADD COLUMN "shipment_id" UUID;

-- CreateIndex
CREATE INDEX "order_line_cases_shipment_id_idx" ON "order_line_cases"("shipment_id");

-- AddForeignKey
ALTER TABLE "order_line_cases" ADD CONSTRAINT "order_line_cases_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A package and its shipment belong to the same company, like every link between company tables.
CREATE TRIGGER "same_company_order_line_cases_shipment_id_fkey" BEFORE INSERT OR UPDATE OF "shipment_id" ON "order_line_cases"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('shipments', 'shipment_id');
