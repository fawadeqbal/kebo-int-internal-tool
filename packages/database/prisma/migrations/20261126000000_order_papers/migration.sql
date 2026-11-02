-- Order flow v3, papers: the papers the app makes from the order (sales contract, commercial invoice, purchase
-- order, shipping advice, reports, certificates, bank papers), each a draft until made final; final keeps the
-- snapshot of what was printed and locks the number; "Make again" adds the next version and keeps the earlier.
-- Papers others issue can be "kept elsewhere" (where, number, date; no file) and count as done.
-- order_papers is a company table: company_id filled from the connection, row-level security, and every link
-- to another company table checked to stay inside the company.

-- AlterEnum
ALTER TYPE "OrderDocumentStatus" ADD VALUE 'elsewhere';

-- AlterTable
ALTER TABLE "checklist_templates" ADD COLUMN     "paper" VARCHAR(40);

-- AlterTable
ALTER TABLE "order_checklist_items" ADD COLUMN     "paper" VARCHAR(40);

-- AlterTable
ALTER TABLE "order_documents" ADD COLUMN     "kept_where" VARCHAR(200),
ADD COLUMN     "paper_id" UUID;

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "hs_code" VARCHAR(20);

-- CreateTable
CREATE TABLE "order_papers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "ref" VARCHAR(60) NOT NULL DEFAULT '',
    "number" VARCHAR(40) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(10) NOT NULL DEFAULT 'draft',
    "options" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB,
    "made_by" UUID NOT NULL,
    "made_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "final_at" TIMESTAMPTZ,

    CONSTRAINT "order_papers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_papers_company_id_idx" ON "order_papers"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_papers_order_id_kind_ref_version_key" ON "order_papers"("order_id", "kind", "ref", "version");

-- AddForeignKey
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "order_papers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_papers" ADD CONSTRAINT "order_papers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_papers" ADD CONSTRAINT "order_papers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_papers" ADD CONSTRAINT "order_papers_made_by_fkey" FOREIGN KEY ("made_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Sensible values only.
ALTER TABLE "order_papers" ADD CONSTRAINT "order_papers_status_check" CHECK ("status" IN ('draft', 'final'));
ALTER TABLE "order_papers" ADD CONSTRAINT "order_papers_version_check" CHECK ("version" >= 1);
ALTER TABLE "order_papers" ADD CONSTRAINT "order_papers_final_check" CHECK ("status" = 'draft' OR ("snapshot" IS NOT NULL AND "final_at" IS NOT NULL));

-- Kept apart per company like every company table (see the companies and company_role migrations).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_papers'] LOOP
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

-- The shipping advice of the default list makes its paper.
UPDATE "order_checklist_items" SET "paper" = 'shipping-advice'
 WHERE "key" IS NULL AND "tool" = 'send' AND "paper" IS NULL AND "title" = 'Shipping advice to the customer';
UPDATE "checklist_templates" SET "paper" = 'shipping-advice'
 WHERE "tool" = 'send' AND "paper" IS NULL AND "title" = 'Shipping advice to the customer';
