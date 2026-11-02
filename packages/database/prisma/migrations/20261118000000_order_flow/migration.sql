-- The order flow after the quotation: asking factories for prices, how the customer pays
-- (informal, bank contract, LC), the factory's production timeline, shipments, the document set
-- and its trip through the banks, delivery, the site acceptance test (SAT) and claims.
-- Every new table is a company table: company_id filled from the connection, row-level security,
-- and every link to another company table checked to stay inside the company.
-- Only adds tables and empty columns; nothing existing changes.

-- CreateEnum
CREATE TYPE "PaymentRoute" AS ENUM ('informal', 'bank_contract', 'letter_of_credit');

-- CreateEnum
CREATE TYPE "BankContractStatus" AS ENUM ('draft', 'opened', 'amended', 'documents_presented', 'paid', 'closed');

-- CreateEnum
CREATE TYPE "FactoryRequestStatus" AS ENUM ('sent', 'quoted', 'declined', 'no_reply');

-- CreateEnum
CREATE TYPE "ShipMode" AS ENUM ('sea', 'air', 'road', 'rail');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('planned', 'booked', 'loaded', 'departed', 'arrived', 'cleared');

-- CreateEnum
CREATE TYPE "OrderDocumentKind" AS ENUM ('bill_of_lading', 'airway_bill', 'packing_list', 'commercial_invoice', 'proforma_invoice', 'sales_contract', 'certificate_of_origin', 'insurance', 'inspection', 'other');

-- CreateEnum
CREATE TYPE "OrderDocumentStatus" AS ENUM ('missing', 'draft', 'ready');

-- CreateEnum
CREATE TYPE "BankStepKind" AS ENUM ('sent_to_our_bank', 'couriered_to_customer_bank', 'copies_to_customer', 'customer_paid_bank', 'bank_paid_us');

-- CreateEnum
CREATE TYPE "DeliveryCondition" AS ENUM ('good', 'minor_damage', 'damaged', 'partial');

-- CreateEnum
CREATE TYPE "SatResult" AS ENUM ('pending', 'pass', 'fail', 'not_applicable');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('open', 'with_factory', 'resolved', 'rejected');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivered_on" DATE,
ADD COLUMN     "delivery_condition" "DeliveryCondition",
ADD COLUMN     "delivery_note" TEXT,
ADD COLUMN     "factory_ordered_on" DATE,
ADD COLUMN     "payment_route" "PaymentRoute",
ADD COLUMN     "sat_done_on" DATE,
ADD COLUMN     "sat_engineer" UUID,
ADD COLUMN     "sat_planned_on" DATE,
ADD COLUMN     "sat_signed_by" VARCHAR(120);

-- CreateTable
CREATE TABLE "factory_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "inquiry_id" UUID NOT NULL,
    "factory_id" UUID NOT NULL,
    "status" "FactoryRequestStatus" NOT NULL DEFAULT 'sent',
    "sent_on" DATE NOT NULL,
    "reply_by" DATE,
    "factory_quote_id" UUID,
    "note" VARCHAR(500),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "factory_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_bank_contracts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "number" VARCHAR(60),
    "status" "BankContractStatus" NOT NULL DEFAULT 'draft',
    "customer_bank" VARCHAR(160),
    "our_bank" VARCHAR(160),
    "amount" DECIMAL(14,2),
    "currency" CHAR(3),
    "opened_on" DATE,
    "latest_ship_on" DATE,
    "expires_on" DATE,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_bank_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_steps" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "factory_id" UUID,
    "title" VARCHAR(120) NOT NULL,
    "planned_on" DATE,
    "done_on" DATE,
    "note" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "production_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "mode" "ShipMode" NOT NULL DEFAULT 'sea',
    "status" "ShipmentStatus" NOT NULL DEFAULT 'planned',
    "forwarder" VARCHAR(120),
    "booking_no" VARCHAR(60),
    "bl_no" VARCHAR(60),
    "vessel" VARCHAR(120),
    "port_of_loading" VARCHAR(120),
    "port_of_discharge" VARCHAR(120),
    "container_no" VARCHAR(120),
    "container_type" VARCHAR(20),
    "etd" DATE,
    "eta" DATE,
    "departed_on" DATE,
    "arrived_on" DATE,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_documents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "shipment_id" UUID,
    "kind" "OrderDocumentKind" NOT NULL,
    "title" VARCHAR(120),
    "number" VARCHAR(60),
    "issued_on" DATE,
    "status" "OrderDocumentStatus" NOT NULL DEFAULT 'missing',
    "attachment_id" UUID,
    "note" VARCHAR(500),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_bank_steps" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "step" "BankStepKind" NOT NULL,
    "done_on" DATE NOT NULL,
    "courier" VARCHAR(60),
    "reference" VARCHAR(120),
    "note" VARCHAR(500),

    CONSTRAINT "order_bank_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sat_checks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "item" VARCHAR(200) NOT NULL,
    "result" "SatResult" NOT NULL DEFAULT 'pending',
    "note" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sat_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_claims" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "detail" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'open',
    "opened_on" DATE NOT NULL,
    "resolved_on" DATE,
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "factory_requests_factory_id_idx" ON "factory_requests"("factory_id");

-- CreateIndex
CREATE INDEX "factory_requests_company_id_idx" ON "factory_requests"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "factory_requests_inquiry_id_factory_id_key" ON "factory_requests"("inquiry_id", "factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_bank_contracts_order_id_key" ON "order_bank_contracts"("order_id");

-- CreateIndex
CREATE INDEX "order_bank_contracts_company_id_idx" ON "order_bank_contracts"("company_id");

-- CreateIndex
CREATE INDEX "production_steps_order_id_idx" ON "production_steps"("order_id");

-- CreateIndex
CREATE INDEX "production_steps_company_id_idx" ON "production_steps"("company_id");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipments_company_id_idx" ON "shipments"("company_id");

-- CreateIndex
CREATE INDEX "order_documents_order_id_idx" ON "order_documents"("order_id");

-- CreateIndex
CREATE INDEX "order_documents_company_id_idx" ON "order_documents"("company_id");

-- CreateIndex
CREATE INDEX "order_bank_steps_company_id_idx" ON "order_bank_steps"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_bank_steps_order_id_step_key" ON "order_bank_steps"("order_id", "step");

-- CreateIndex
CREATE INDEX "sat_checks_order_id_idx" ON "sat_checks"("order_id");

-- CreateIndex
CREATE INDEX "sat_checks_company_id_idx" ON "sat_checks"("company_id");

-- CreateIndex
CREATE INDEX "order_claims_order_id_idx" ON "order_claims"("order_id");

-- CreateIndex
CREATE INDEX "order_claims_company_id_idx" ON "order_claims"("company_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sat_engineer_fkey" FOREIGN KEY ("sat_engineer") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_requests" ADD CONSTRAINT "factory_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_requests" ADD CONSTRAINT "factory_requests_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_requests" ADD CONSTRAINT "factory_requests_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_requests" ADD CONSTRAINT "factory_requests_factory_quote_id_fkey" FOREIGN KEY ("factory_quote_id") REFERENCES "factory_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_requests" ADD CONSTRAINT "factory_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_bank_contracts" ADD CONSTRAINT "order_bank_contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_bank_contracts" ADD CONSTRAINT "order_bank_contracts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_steps" ADD CONSTRAINT "production_steps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_steps" ADD CONSTRAINT "production_steps_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_steps" ADD CONSTRAINT "production_steps_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_bank_steps" ADD CONSTRAINT "order_bank_steps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_bank_steps" ADD CONSTRAINT "order_bank_steps_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sat_checks" ADD CONSTRAINT "sat_checks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sat_checks" ADD CONSTRAINT "sat_checks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claims" ADD CONSTRAINT "order_claims_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claims" ADD CONSTRAINT "order_claims_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sensible values only.
ALTER TABLE "order_bank_contracts" ADD CONSTRAINT "order_bank_contracts_amount_check" CHECK ("amount" IS NULL OR "amount" >= 0);
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_dates_check" CHECK ("eta" IS NULL OR "etd" IS NULL OR "eta" >= "etd");
ALTER TABLE "order_claims" ADD CONSTRAINT "order_claims_dates_check" CHECK ("resolved_on" IS NULL OR "resolved_on" >= "opened_on");

-- Kept apart per company like every company table (see the companies and company_role migrations).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['factory_requests', 'order_bank_contracts', 'production_steps', 'shipments',
                           'order_documents', 'order_bank_steps', 'sat_checks', 'order_claims'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kebo_app', t);
  END LOOP;
END $$;

-- Every new link between company tables (including orders.sat_engineer → users) may only point inside the company.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT cl.relname AS child, pa.relname AS parent, a.attname AS col, k.conname
      FROM pg_constraint k
      JOIN pg_class cl ON cl.oid = k.conrelid
      JOIN pg_class pa ON pa.oid = k.confrelid
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      JOIN pg_attribute pk ON pk.attrelid = k.confrelid AND pk.attnum = k.confkey[1]
     WHERE k.contype = 'f' AND cl.relrowsecurity AND pa.relrowsecurity
       AND array_length(k.conkey, 1) = 1 AND pk.attname = 'id' AND a.attname <> 'company_id'
       AND cl.relnamespace = current_schema()::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = k.conrelid AND tg.tgname = left('same_company_' || k.conname, 63))
     ORDER BY 1, 3
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_company(%L, %L)',
                   left('same_company_' || r.conname, 63), r.col, r.child, r.parent, r.col);
  END LOOP;
END $$;
