-- The ledger (Finance › Ledger): every money record posted from its document, never typed. ledger_entries holds
-- the rows (append-only: a trigger refuses UPDATE and DELETE on the company connection unless the rebuild says so
-- with SET LOCAL kebo.ledger_rewrite = 'on'; the owner's connection, which clears a whole company, is not stopped);
-- ledger_state whether a company's ledger was posted from its records and its last check. Company tables like every
-- other: company_id filled from the connection, row-level security, every link kept inside the company. The rows
-- are posted by the API (on start, or on first use), not here. ledger.view goes to the Manager and Super Admin
-- roles and every role that records payments or manages expenses today.

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "entry_no" INTEGER NOT NULL,
    "group_id" UUID NOT NULL,
    "line" SMALLINT NOT NULL DEFAULT 0,
    "posted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATE NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "source_id" VARCHAR(120) NOT NULL,
    "part" VARCHAR(10) NOT NULL DEFAULT '',
    "ref" VARCHAR(60) NOT NULL,
    "order_id" UUID,
    "customer_id" UUID,
    "factory_id" UUID,
    "user_id" UUID,
    "money_account_id" UUID,
    "account" VARCHAR(80) NOT NULL,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(24,14),
    "debit_base" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit_base" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "memo" VARCHAR(300) NOT NULL DEFAULT '',
    "reverses_id" UUID,
    "reason" VARCHAR(500),
    "created_by" UUID,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_state" (
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "built_at" TIMESTAMPTZ,
    "checked_at" TIMESTAMPTZ,
    "differences" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,

    CONSTRAINT "ledger_state_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reverses_id_key" ON "ledger_entries"("reverses_id");

-- CreateIndex
CREATE INDEX "ledger_entries_company_id_date_entry_no_idx" ON "ledger_entries"("company_id", "date", "entry_no");

-- CreateIndex
CREATE INDEX "ledger_entries_company_id_account_date_idx" ON "ledger_entries"("company_id", "account", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_source_type_source_id_idx" ON "ledger_entries"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "ledger_entries_group_id_idx" ON "ledger_entries"("group_id");

-- CreateIndex
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "ledger_entries_customer_id_idx" ON "ledger_entries"("customer_id");

-- CreateIndex
CREATE INDEX "ledger_entries_factory_id_idx" ON "ledger_entries"("factory_id");

-- CreateIndex
CREATE INDEX "ledger_entries_user_id_idx" ON "ledger_entries"("user_id");

-- CreateIndex
CREATE INDEX "ledger_entries_money_account_id_idx" ON "ledger_entries"("money_account_id");

-- CreateIndex
CREATE INDEX "ledger_entries_created_by_idx" ON "ledger_entries"("created_by");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_money_account_id_fkey" FOREIGN KEY ("money_account_id") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "ledger_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_state" ADD CONSTRAINT "ledger_state_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sensible values only.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_type_check"
  CHECK ("type" IN ('order', 'purchase_order', 'money_in', 'money_out', 'transfer', 'expense', 'credit', 'correction', 'opening', 'fx'));
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_source_type_check"
  CHECK ("source_type" IN ('order', 'purchase_order', 'payment', 'receipt', 'credit', 'factory_payment', 'expense', 'transfer', 'account', 'fx_order', 'fx_factory'));
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amounts_check"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND "debit_base" >= 0 AND "credit_base" >= 0
         AND ("debit" = 0 OR "credit" = 0) AND ("debit_base" = 0 OR "credit_base" = 0)
         AND ("debit" + "credit" + "debit_base" + "credit_base") > 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_check" CHECK (length("account") > 0);

-- Kept apart per company like every company table (see the companies and company_role migrations).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_state'] LOOP
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

-- Append-only: a posted row is never changed or removed (a change is posted as a correction). Only the rebuild,
-- with SET LOCAL kebo.ledger_rewrite = 'on', or the owner's connection (clearing a whole company) may.
CREATE FUNCTION ledger_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'kebo_app' AND coalesce(current_setting('kebo.ledger_rewrite', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Ledger entries are never changed or deleted: post a correction instead'
      USING ERRCODE = 'P0001', HINT = 'ledger_append_only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_append_only();

-- The ledger: the Manager and Super Admin roles and every role that records payments or manages expenses today.
UPDATE "roles"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['ledger.view']::TEXT[]) AS p
)
WHERE "key" IN ('admin', 'manager') OR 'payments.record' = ANY("permissions") OR 'expenses.manage' = ANY("permissions");
