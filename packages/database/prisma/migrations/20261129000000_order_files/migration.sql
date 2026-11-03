-- Documents v3: every file of an order in one list, with the same tools everywhere.
-- - attachments.order_id, attachments.step: a file added on an order (uploaded on Documents, or dropped on a
--   step page) and the step it belongs to; files of the deal itself keep both empty.
-- - attachments.replaced_by, attachments.version: "Replace with a newer one" keeps the old file as an earlier
--   version (out of the lists, still downloadable) and points it to the newer one.
-- attachments is a company table already (row-level security, company_isolation): no new policy is needed;
-- the two new links get the same-company check like every link between company tables.

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN "order_id" UUID,
ADD COLUMN "step" VARCHAR(20),
ADD COLUMN "replaced_by" UUID,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "attachments_order_id_idx" ON "attachments"("order_id");

-- CreateIndex
CREATE INDEX "attachments_replaced_by_idx" ON "attachments"("replaced_by");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sensible values only.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_step_check" CHECK ("step" IS NULL OR "step" IN ('payment', 'factory', 'production', 'shipping', 'documents', 'delivery'));
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_version_check" CHECK ("version" >= 1);
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_not_own_version_check" CHECK ("replaced_by" IS NULL OR "replaced_by" <> "id");

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
