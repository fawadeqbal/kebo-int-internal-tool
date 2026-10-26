-- Step 2 (money): customer payment plans, factory payments and expenses.

-- CreateTable
CREATE TABLE "payment_plan_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "due_on" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "reminded_on" DATE,

    CONSTRAINT "payment_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "factory_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'deposit',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(14,6) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'bank_transfer',
    "paid_by" UUID,
    "reference" VARCHAR(120),
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "factory_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "order_id" UUID,
    "category" VARCHAR(30) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(14,6) NOT NULL,
    "spent_on" DATE NOT NULL,
    "paid_by" UUID,
    "reference" VARCHAR(120),
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_plan_items_order_id_idx" ON "payment_plan_items"("order_id");

-- CreateIndex
CREATE INDEX "payment_plan_items_due_on_idx" ON "payment_plan_items"("due_on");

-- CreateIndex
CREATE INDEX "factory_payments_order_id_idx" ON "factory_payments"("order_id");

-- CreateIndex
CREATE INDEX "factory_payments_factory_id_idx" ON "factory_payments"("factory_id");

-- CreateIndex
CREATE INDEX "factory_payments_paid_on_idx" ON "factory_payments"("paid_on");

-- CreateIndex
CREATE INDEX "expenses_order_id_idx" ON "expenses"("order_id");

-- CreateIndex
CREATE INDEX "expenses_spent_on_idx" ON "expenses"("spent_on");

-- AddForeignKey
ALTER TABLE "payment_plan_items" ADD CONSTRAINT "payment_plan_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_payments" ADD CONSTRAINT "factory_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_payments" ADD CONSTRAINT "factory_payments_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_payments" ADD CONSTRAINT "factory_payments_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Amounts are positive; rates too; a category is one of EXPENSE_CATEGORIES in @kebo/shared.
ALTER TABLE "payment_plan_items" ADD CONSTRAINT "payment_plan_items_amount_check" CHECK ("amount" > 0);
ALTER TABLE "factory_payments" ADD CONSTRAINT "factory_payments_amount_check" CHECK ("amount" > 0 AND "rate" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_check" CHECK ("amount" > 0 AND "rate" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_check" CHECK ("category" IN ('freight', 'inland_transport', 'inspection', 'customs', 'bank_charges', 'commission', 'samples', 'travel', 'office', 'salaries', 'rent', 'other'));

-- Orders made before this get the plan their terms imply: the deposit due a week
-- after the order (the default reminder), the balance undated.
INSERT INTO "payment_plan_items" ("id", "order_id", "label", "amount", "due_on", "sort_order")
SELECT gen_random_uuid(), o."id", 'Deposit ' || trim(trailing '.' from trim(trailing '0' from o."deposit_percent"::text)) || '%',
       round(o."total" * o."deposit_percent" / 100, 2), o."ordered_on" + 7, 0
  FROM "orders" o
 WHERE o."deposit_percent" > 0 AND round(o."total" * o."deposit_percent" / 100, 2) > 0;

INSERT INTO "payment_plan_items" ("id", "order_id", "label", "amount", "due_on", "sort_order")
SELECT gen_random_uuid(), o."id",
       CASE WHEN o."deposit_percent" > 0 THEN 'Balance' ELSE 'Payment' END,
       o."total" - round(o."total" * o."deposit_percent" / 100, 2), NULL, 1
  FROM "orders" o
 WHERE o."total" - round(o."total" * o."deposit_percent" / 100, 2) > 0;
