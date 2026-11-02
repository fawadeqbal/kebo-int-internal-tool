-- Order flow v3, Costs: an order's expense belongs to one of its steps, is borne by us, the customer
-- (added to what they owe on the order) or the factory (taken off what we owe it), and may be paid by
-- someone from their own money, to be repaid from one of our accounts. New kinds: insurance, courier.

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "borne_by" VARCHAR(10) NOT NULL DEFAULT 'us',
ADD COLUMN     "own_money" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "repaid_account_id" UUID,
ADD COLUMN     "repaid_on" DATE,
ADD COLUMN     "step" VARCHAR(20);

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_repaid_account_id_fkey" FOREIGN KEY ("repaid_account_id") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sensible values only.
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_category_check";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_check" CHECK ("category" IN ('travel', 'hotel', 'meals', 'gifts', 'samples', 'freight', 'inland_transport', 'inspection', 'customs', 'insurance', 'courier', 'bank_charges', 'commission', 'rent', 'salaries', 'utilities', 'office', 'other'));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_step_check" CHECK ("step" IS NULL OR "step" IN ('payment', 'factory', 'production', 'shipping', 'documents', 'delivery'));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_borne_by_check" CHECK ("borne_by" IN ('us', 'customer', 'factory'));
-- Taken off what we owe a factory: which factory must be said.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_borne_by_factory_check" CHECK ("borne_by" <> 'factory' OR "factory_id" IS NOT NULL);
-- Repaid only what someone paid from their own money.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_repaid_check" CHECK ("own_money" OR ("repaid_on" IS NULL AND "repaid_account_id" IS NULL));

-- CreateIndex
CREATE INDEX "expenses_repaid_account_id_idx" ON "expenses"("repaid_account_id");

-- The new link may only point inside the company (see the same_company_links migration).
CREATE TRIGGER "same_company_expenses_repaid_account_id_fkey" BEFORE INSERT OR UPDATE OF "repaid_account_id" ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('money_accounts', 'repaid_account_id');
