-- Notes and call logs on orders, customers and factories, typed notes on inquiries, and follow-ups (planned
-- calls and visits, with reminders). Inquiry notes get the same fields as the new notes (kind, the contact
-- it was with, when it happened, edited); old notes become plain notes that happened when they were written.
-- record_notes holds the notes of an order, a customer or a factory (exactly one); follow_ups the planned
-- calls, visits and meetings, each on at most one record. Company tables like every other: company_id filled
-- from the connection, row-level security, and every link to another company table kept inside the company.
-- followups.viewAll (see everyone's follow-ups) goes to the Manager and Super Admin roles and every role that
-- sees every inquiry today.

-- AlterTable
ALTER TABLE "inquiry_notes" ADD COLUMN     "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "contact_id" UUID,
ADD COLUMN     "edited_at" TIMESTAMPTZ,
ADD COLUMN     "kind" VARCHAR(10) NOT NULL DEFAULT 'note';

-- CreateTable
CREATE TABLE "record_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID,
    "customer_id" UUID,
    "factory_id" UUID,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'note',
    "body" TEXT NOT NULL,
    "contact_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ,

    CONSTRAINT "record_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "title" VARCHAR(200) NOT NULL,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'other',
    "due_on" DATE NOT NULL,
    "due_at" VARCHAR(5),
    "place" VARCHAR(160),
    "note" VARCHAR(2000),
    "inquiry_id" UUID,
    "order_id" UUID,
    "customer_id" UUID,
    "factory_id" UUID,
    "assignee_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "done_at" TIMESTAMPTZ,
    "done_by" UUID,
    "done_note" VARCHAR(2000),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "record_notes_order_id_at_idx" ON "record_notes"("order_id", "at");

-- CreateIndex
CREATE INDEX "record_notes_customer_id_at_idx" ON "record_notes"("customer_id", "at");

-- CreateIndex
CREATE INDEX "record_notes_factory_id_at_idx" ON "record_notes"("factory_id", "at");

-- CreateIndex
CREATE INDEX "record_notes_company_id_idx" ON "record_notes"("company_id");

-- CreateIndex
CREATE INDEX "follow_ups_company_id_assignee_id_done_at_due_on_idx" ON "follow_ups"("company_id", "assignee_id", "done_at", "due_on");

-- CreateIndex
CREATE INDEX "follow_ups_due_on_idx" ON "follow_ups"("due_on");

-- CreateIndex
CREATE INDEX "follow_ups_inquiry_id_idx" ON "follow_ups"("inquiry_id");

-- CreateIndex
CREATE INDEX "follow_ups_order_id_idx" ON "follow_ups"("order_id");

-- CreateIndex
CREATE INDEX "follow_ups_customer_id_idx" ON "follow_ups"("customer_id");

-- CreateIndex
CREATE INDEX "follow_ups_factory_id_idx" ON "follow_ups"("factory_id");

-- CreateIndex
CREATE INDEX "follow_ups_created_by_idx" ON "follow_ups"("created_by");

-- AddForeignKey
ALTER TABLE "inquiry_notes" ADD CONSTRAINT "inquiry_notes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_done_by_fkey" FOREIGN KEY ("done_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Old notes happened when they were written.
UPDATE "inquiry_notes" SET "at" = "created_at";

-- Sensible values only.
ALTER TABLE "inquiry_notes" ADD CONSTRAINT "inquiry_notes_kind_check" CHECK ("kind" IN ('note', 'call', 'visit', 'whatsapp', 'email'));
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_kind_check" CHECK ("kind" IN ('note', 'call', 'visit', 'whatsapp', 'email'));
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_one_record_check" CHECK (num_nonnulls("order_id", "customer_id", "factory_id") = 1);
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_body_check" CHECK (length(btrim("body")) BETWEEN 1 AND 4000);
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_kind_check" CHECK ("kind" IN ('call', 'visit', 'meeting', 'other'));
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_title_check" CHECK (length(btrim("title")) > 0);
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_due_at_check" CHECK ("due_at" IS NULL OR "due_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_one_record_check" CHECK (num_nonnulls("inquiry_id", "order_id", "customer_id", "factory_id") <= 1);
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_done_check" CHECK ("done_at" IS NOT NULL OR ("done_by" IS NULL AND "done_note" IS NULL));

-- Kept apart per company like every company table (see the companies and company_role migrations).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['record_notes', 'follow_ups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kebo_app', t);
  END LOOP;
END $$;

-- Every new link between company tables may only point inside the company (inquiry_notes.contact_id too).
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

-- See everyone's follow-ups: the Manager and Super Admin roles and every role that sees every inquiry today.
UPDATE "roles"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['followups.viewAll']::TEXT[]) AS p
)
WHERE "key" IN ('admin', 'manager') OR 'inquiries.viewAll' = ANY("permissions");
