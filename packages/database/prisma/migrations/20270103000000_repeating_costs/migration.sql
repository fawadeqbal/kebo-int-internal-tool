-- Money, step 4: a cost of the company that comes every month (rent, salaries). Each month's cost is an expense
-- of its own; the months of one cost share `repeat_key`. Next month's is proposed from the latest of the chain
-- while that one still says `repeats`; `repeat_skip` keeps the month that was skipped.
ALTER TABLE "expenses" ADD COLUMN "repeats" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "repeat_key" UUID,
ADD COLUMN "repeat_skip" CHAR(7);

CREATE INDEX "expenses_repeat_key_idx" ON "expenses"("repeat_key");

-- Only the company's own costs repeat, and a repeating cost belongs to a chain.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_repeats_check" CHECK (NOT "repeats" OR ("repeat_key" IS NOT NULL AND "order_id" IS NULL));
