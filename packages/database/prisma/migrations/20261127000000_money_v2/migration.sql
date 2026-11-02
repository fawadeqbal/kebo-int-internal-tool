-- Money v2 (order flow v3, phase 5):
-- - a customer payment keeps what really arrived (amount, currency, rate, who paid) next to what it counts as
--   on the order; existing payments are filled in (received = amount, rate 1);
-- - one transfer can pay several orders (customer_receipts) and leave credit (customer_credits ledger);
-- - the route builds the plan (balance_when, lc_terms, lc_days on the order; part and due rule on plan items);
-- - "Money reached us" is a payment (order_bank_steps.payment_id); "Papers reached their bank" is a bank step;
-- - the factory payment plan (factory_payment_plans: advance on order, balance on the ready date);
-- - a cancelled order says what happened to the money (cancel_customer_money, cancel_factory_money).
-- New tables are company tables: company_id from the connection, row-level security, links kept inside the company.


-- AlterEnum
ALTER TYPE "BankStepKind" ADD VALUE IF NOT EXISTS 'customer_bank_received' AFTER 'couriered_to_customer_bank';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'credit' AFTER 'online';

-- AlterTable
ALTER TABLE "order_bank_steps" ADD COLUMN     "payment_id" UUID;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "balance_when" VARCHAR(20),
ADD COLUMN     "cancel_customer_money" VARCHAR(10),
ADD COLUMN     "cancel_factory_money" VARCHAR(12),
ADD COLUMN     "lc_days" INTEGER,
ADD COLUMN     "lc_terms" VARCHAR(10);

-- AlterTable
ALTER TABLE "payment_plan_items" ADD COLUMN     "due_days" INTEGER,
ADD COLUMN     "due_rule" VARCHAR(20),
ADD COLUMN     "part" VARCHAR(10);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "paid_by_name" VARCHAR(120),
ADD COLUMN     "rate" DECIMAL(24,14) NOT NULL DEFAULT 1,
ADD COLUMN     "receipt_id" UUID,
ADD COLUMN     "received_amount" DECIMAL(14,2),
ADD COLUMN     "received_currency" CHAR(3);

-- Every payment so far arrived in the order's currency: what arrived is what it counts as, at 1.
UPDATE "payments" SET "received_amount" = "amount", "received_currency" = "currency", "rate" = 1 WHERE "received_amount" IS NULL;
ALTER TABLE "payments" ALTER COLUMN "received_amount" SET NOT NULL, ALTER COLUMN "received_currency" SET NOT NULL;

-- CreateTable
CREATE TABLE "customer_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "customer_id" UUID NOT NULL,
    "received_amount" DECIMAL(14,2) NOT NULL,
    "received_currency" CHAR(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(24,14) NOT NULL DEFAULT 1,
    "account_id" UUID,
    "paid_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'bank_transfer',
    "reference" VARCHAR(120),
    "paid_by_name" VARCHAR(120),
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credits" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "customer_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "receipt_id" UUID,
    "payment_id" UUID,
    "order_id" UUID,
    "account_id" UUID,
    "on" DATE NOT NULL,
    "note" VARCHAR(500),
    "recorded_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_payment_plans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "factory_id" UUID NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "percent" DECIMAL(5,2),
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "due_rule" VARCHAR(10) NOT NULL,
    "due_on" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "factory_payment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_receipts_customer_id_idx" ON "customer_receipts"("customer_id");

-- CreateIndex
CREATE INDEX "customer_receipts_account_id_idx" ON "customer_receipts"("account_id");

-- CreateIndex
CREATE INDEX "customer_receipts_paid_on_idx" ON "customer_receipts"("paid_on");

-- CreateIndex
CREATE INDEX "customer_receipts_company_id_idx" ON "customer_receipts"("company_id");

-- CreateIndex
CREATE INDEX "customer_credits_customer_id_idx" ON "customer_credits"("customer_id");

-- CreateIndex
CREATE INDEX "customer_credits_order_id_idx" ON "customer_credits"("order_id");

-- CreateIndex
CREATE INDEX "customer_credits_payment_id_idx" ON "customer_credits"("payment_id");

-- CreateIndex
CREATE INDEX "customer_credits_receipt_id_idx" ON "customer_credits"("receipt_id");

-- CreateIndex
CREATE INDEX "customer_credits_account_id_idx" ON "customer_credits"("account_id");

-- CreateIndex
CREATE INDEX "customer_credits_company_id_idx" ON "customer_credits"("company_id");

-- CreateIndex
CREATE INDEX "factory_payment_plans_order_id_factory_id_idx" ON "factory_payment_plans"("order_id", "factory_id");

-- CreateIndex
CREATE INDEX "factory_payment_plans_factory_id_idx" ON "factory_payment_plans"("factory_id");

-- CreateIndex
CREATE INDEX "factory_payment_plans_company_id_idx" ON "factory_payment_plans"("company_id");

-- CreateIndex
CREATE INDEX "payments_receipt_id_idx" ON "payments"("receipt_id");

-- AddForeignKey
ALTER TABLE "order_bank_steps" ADD CONSTRAINT "order_bank_steps_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "customer_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "customer_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_payment_plans" ADD CONSTRAINT "factory_payment_plans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_payment_plans" ADD CONSTRAINT "factory_payment_plans_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_payment_plans" ADD CONSTRAINT "factory_payment_plans_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sensible values only.
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_kind_check" CHECK ("kind" IN ('in', 'used', 'refund', 'fee'));
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_amount_check" CHECK ("amount" > 0);
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_amount_check" CHECK ("received_amount" > 0 AND "rate" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_rate_check" CHECK ("rate" > 0);
ALTER TABLE "factory_payment_plans" ADD CONSTRAINT "factory_payment_plans_due_rule_check" CHECK ("due_rule" IN ('on_order', 'on_ready', 'fixed'));
ALTER TABLE "factory_payment_plans" ADD CONSTRAINT "factory_payment_plans_amount_check" CHECK ("amount" >= 0 AND ("percent" IS NULL OR "percent" BETWEEN 0 AND 100));
ALTER TABLE "orders" ADD CONSTRAINT "orders_balance_when_check" CHECK ("balance_when" IS NULL OR "balance_when" IN ('before_shipment', 'against_bl_copy'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_lc_terms_check" CHECK ("lc_terms" IS NULL OR "lc_terms" IN ('at_sight', 'deferred'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_lc_days_check" CHECK ("lc_days" IS NULL OR "lc_days" BETWEEN 0 AND 720);
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancel_customer_money_check" CHECK ("cancel_customer_money" IS NULL OR "cancel_customer_money" IN ('credit', 'refund', 'fee'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancel_factory_money_check" CHECK ("cancel_factory_money" IS NULL OR "cancel_factory_money" IN ('refund_due', 'loss'));
ALTER TABLE "payment_plan_items" ADD CONSTRAINT "payment_plan_items_part_check" CHECK ("part" IS NULL OR "part" IN ('deposit', 'balance'));
ALTER TABLE "payment_plan_items" ADD CONSTRAINT "payment_plan_items_due_rule_check" CHECK ("due_rule" IS NULL OR "due_rule" = 'after_papers');

-- Informal orders keep their balance terms as the route's choice.
UPDATE "orders" SET "balance_when" = "balance_terms"::text
 WHERE "payment_route" = 'informal' AND "balance_terms" IN ('before_shipment', 'against_bl_copy') AND "balance_when" IS NULL;

-- Kept apart per company like every company table (see the companies and company_role migrations).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_receipts', 'customer_credits', 'factory_payment_plans'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kebo_app', t);
  END LOOP;
END $$;

-- Every new link between company tables may only point inside the company.
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
