-- The month close (Settings › Closed months). Money dated on or before a company's closed_through is
-- kept as it was reported: a database rule on the money records refuses a payment, cost, transfer or allocation
-- dated then, a change to one (amount, currency, rate, account, date, voiding…), and removing one. What may still
-- change on such a record: its note and reference, its description, and repaying a cost paid from someone's own
-- money. The owner's connection (removing a company, migrations) is not stopped. Reopening a month is moving
-- closed_through back, with a reason (audited).

-- CreateTable
CREATE TABLE "books_close" (
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "closed_through" DATE NOT NULL,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "books_close_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "books_close_closed_by_idx" ON "books_close"("closed_by");

-- AddForeignKey
ALTER TABLE "books_close" ADD CONSTRAINT "books_close_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books_close" ADD CONSTRAINT "books_close_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kept apart per company like every company table.
ALTER TABLE "books_close" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "books_close" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "books_close" TO kebo_app;
CREATE TRIGGER same_company_books_close_closed_by_fkey BEFORE INSERT OR UPDATE OF "closed_by" ON "books_close"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('users', 'closed_by');

-- TG_ARGV[0]: the record's date column; the rest: columns that may still change on a record of a closed month.
CREATE FUNCTION books_closed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  closed date;
  i int;
BEGIN
  IF current_user <> 'kebo_app' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT b.closed_through INTO closed FROM books_close b WHERE b.company_id = (coalesce(n, o) ->> 'company_id')::uuid;
  IF closed IS NOT NULL AND (
       (n IS NOT NULL AND (n ->> TG_ARGV[0])::date <= closed)
    OR (o IS NOT NULL AND (o ->> TG_ARGV[0])::date <= closed)
  ) THEN
    IF TG_OP = 'UPDATE' THEN
      FOR i IN 1 .. TG_NARGS - 1 LOOP
        o := o - TG_ARGV[i];
        n := n - TG_ARGV[i];
      END LOOP;
      IF o = n THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'The books are closed through %: money dated then stays as it was reported. Date it later, or reopen the month in Settings › Closed months', to_char(closed, 'DD Mon YYYY')
      USING ERRCODE = 'P0001', HINT = 'books_closed';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER money_movements_books_closed BEFORE INSERT OR UPDATE OR DELETE ON "money_movements"
  FOR EACH ROW EXECUTE FUNCTION books_closed_guard('value_date', 'note', 'reference', 'paid_by_name', 'updated_at');
CREATE TRIGGER expenses_books_closed BEFORE INSERT OR UPDATE OR DELETE ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION books_closed_guard('spent_on', 'note', 'reference', 'description', 'repaid_on', 'repaid_account_id', 'updated_at');
CREATE TRIGGER allocations_books_closed BEFORE INSERT OR UPDATE OR DELETE ON "allocations"
  FOR EACH ROW EXECUTE FUNCTION books_closed_guard('on', 'note');
