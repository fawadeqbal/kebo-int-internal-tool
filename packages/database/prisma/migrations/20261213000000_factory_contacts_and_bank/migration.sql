-- Factories get several contacts (like customers) and their bank details as separate fields. The old free-text
-- bank_details stays ("Other bank details"); the old contact columns stay and keep the primary contact.

-- AlterTable
ALTER TABLE "factories" ADD COLUMN     "bank_account" VARCHAR(60),
ADD COLUMN     "bank_beneficiary" VARCHAR(200),
ADD COLUMN     "bank_name" VARCHAR(200),
ADD COLUMN     "bank_swift" VARCHAR(20);

-- CreateTable
CREATE TABLE "factory_contacts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "factory_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "position" VARCHAR(80),
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "wechat" VARCHAR(80),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "factory_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "factory_contacts_factory_id_idx" ON "factory_contacts"("factory_id");

-- CreateIndex
CREATE INDEX "factory_contacts_company_id_idx" ON "factory_contacts"("company_id");

-- AddForeignKey
ALTER TABLE "factory_contacts" ADD CONSTRAINT "factory_contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_contacts" ADD CONSTRAINT "factory_contacts_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One primary contact per factory at most.
CREATE UNIQUE INDEX "factory_contacts_one_primary" ON "factory_contacts" ("factory_id") WHERE "is_primary" AND "deleted_at" IS NULL;

-- Kept apart per company like every company table (see the companies and company_role migrations).
ALTER TABLE "factory_contacts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "factory_contacts" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "factory_contacts" TO kebo_app;

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

-- Today's one contact of each factory becomes its primary contact (named after the factory when no person was given).
INSERT INTO "factory_contacts" ("id", "company_id", "factory_id", "name", "email", "phone", "wechat", "is_primary", "created_at", "updated_at")
SELECT gen_random_uuid(), f."company_id", f."id",
       left(coalesce(nullif(btrim(f."contact_person"), ''), f."name"), 120),
       nullif(btrim(f."email"), ''), nullif(btrim(f."phone"), ''), nullif(btrim(f."wechat"), ''),
       true, now(), now()
  FROM "factories" f
 WHERE (coalesce(btrim(f."contact_person"), '') <> '' OR coalesce(btrim(f."phone"), '') <> ''
        OR coalesce(btrim(f."wechat"), '') <> '' OR coalesce(btrim(f."email"), '') <> '');
