-- Cash book: our money accounts (cash, banks, wallets), money moved between them, and the account each payment and expense went through.
-- CreateEnum
CREATE TYPE "MoneyAccountKind" AS ENUM ('cash', 'bank', 'wallet');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "account_id" UUID;

-- AlterTable
ALTER TABLE "factory_payments" ADD COLUMN     "account_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "account_id" UUID;

-- CreateTable
CREATE TABLE "money_accounts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" "MoneyAccountKind" NOT NULL DEFAULT 'bank',
    "currency" CHAR(3) NOT NULL,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "opening_on" DATE NOT NULL,
    "note" TEXT,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "money_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_transfers" (
    "id" UUID NOT NULL,
    "from_account_id" UUID NOT NULL,
    "to_account_id" UUID NOT NULL,
    "amount_out" DECIMAL(14,2) NOT NULL,
    "amount_in" DECIMAL(14,2) NOT NULL,
    "transferred_on" DATE NOT NULL,
    "reference" VARCHAR(120),
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "money_accounts_name_key" ON "money_accounts"("name");

-- CreateIndex
CREATE INDEX "money_transfers_from_account_id_idx" ON "money_transfers"("from_account_id");

-- CreateIndex
CREATE INDEX "money_transfers_to_account_id_idx" ON "money_transfers"("to_account_id");

-- CreateIndex
CREATE INDEX "money_transfers_transferred_on_idx" ON "money_transfers"("transferred_on");

-- CreateIndex
CREATE INDEX "expenses_account_id_idx" ON "expenses"("account_id");

-- CreateIndex
CREATE INDEX "factory_payments_account_id_idx" ON "factory_payments"("account_id");

-- CreateIndex
CREATE INDEX "payments_account_id_idx" ON "payments"("account_id");

-- AddForeignKey
ALTER TABLE "factory_payments" ADD CONSTRAINT "factory_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A transfer moves something, between two different accounts.
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_amounts_check" CHECK ("amount_out" > 0 AND "amount_in" > 0);
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_accounts_check" CHECK ("from_account_id" <> "to_account_id");
ALTER TABLE "money_accounts" ADD CONSTRAINT "money_accounts_currency_check" CHECK ("currency" IN ('USD', 'CNY', 'PKR'));
