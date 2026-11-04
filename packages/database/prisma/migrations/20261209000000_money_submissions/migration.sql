-- Money received and expenses a person adds for a manager to approve (the phone's "Send for approval").
-- money_submissions holds what they sent (the usual endpoint's body, the bank slip or receipt photo) until a
-- manager approves it, which records it through the usual code as the manager; nothing here counts before
-- that. A company table like every other: company_id filled from the connection, row-level security, and
-- every link to another company table checked to stay inside the company.
-- money.submit (send them for approval) goes to the Staff role and every role that records payments or
-- expenses today, so nobody loses anything.

-- CreateTable
CREATE TABLE "money_submissions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "kind" VARCHAR(10) NOT NULL,
    "order_id" UUID,
    "body" JSONB NOT NULL,
    "file_key" TEXT,
    "file_name" VARCHAR(255),
    "file_type" VARCHAR(150),
    "file_size" INTEGER,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "reason" VARCHAR(500),
    "created_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "money_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "money_submissions_company_id_status_idx" ON "money_submissions"("company_id", "status");

-- CreateIndex
CREATE INDEX "money_submissions_order_id_idx" ON "money_submissions"("order_id");

-- CreateIndex
CREATE INDEX "money_submissions_submitted_by_idx" ON "money_submissions"("submitted_by");

-- AddForeignKey
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sensible values only.
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_kind_check" CHECK ("kind" IN ('payment', 'expense'));
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_status_check" CHECK ("status" IN ('pending', 'approved', 'sent_back', 'withdrawn'));
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_payment_order_check" CHECK ("kind" <> 'payment' OR "order_id" IS NOT NULL);
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_body_check" CHECK (jsonb_typeof("body") = 'object');
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_decided_check" CHECK ("status" = 'pending' OR "decided_at" IS NOT NULL);
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_reason_check" CHECK ("status" <> 'sent_back' OR length(btrim("reason")) > 0);
ALTER TABLE "money_submissions" ADD CONSTRAINT "money_submissions_file_size_check" CHECK ("file_size" IS NULL OR "file_size" >= 0);

-- Kept apart per company like every company table (see the companies and company_role migrations).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['money_submissions'] LOOP
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

-- The new permission goes to the Staff role and every role that records payments or expenses today.
UPDATE "roles"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['money.submit']::TEXT[]) AS p
)
WHERE "key" = 'staff' OR 'payments.record' = ANY("permissions") OR 'expenses.manage' = ANY("permissions");
