-- Money, step 2: a cost counts when it is known and is marked paid when it is paid.
-- An expense may be a bill to pay later (owed to `payee` until `repaid_on`), and may be made by the system
-- from a shipment's freight or insurance (`source`). A shipment says what its insurance costs.
ALTER TABLE "expenses" ADD COLUMN "pay_later" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "payee" VARCHAR(120),
ADD COLUMN "source" VARCHAR(80);

CREATE INDEX "expenses_source_idx" ON "expenses"("source");

ALTER TABLE "shipments" ADD COLUMN "insurance_premium" DECIMAL(14,2),
ADD COLUMN "insurance_currency" CHAR(3);

-- What is owed is paid later: by paying a person back (own money) or by paying the bill (pay later), never both.
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_repaid_check";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_repaid_check" CHECK ("own_money" OR "pay_later" OR ("repaid_on" IS NULL AND "repaid_account_id" IS NULL));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_pay_later_check" CHECK (NOT "pay_later" OR (NOT "own_money" AND "account_id" IS NULL));
