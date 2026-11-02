-- Monthly sales targets per person (the company's stay in sales_targets). A company table like every
-- other: row-level security, and both people columns may only point at people of the same company.

-- CreateTable
CREATE TABLE "person_targets" (
    "month" CHAR(7) NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "user_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "person_targets_pkey" PRIMARY KEY ("company_id","month","user_id")
);

-- CreateIndex
CREATE INDEX "person_targets_user_id_idx" ON "person_targets"("user_id");

-- AddForeignKey
ALTER TABLE "person_targets" ADD CONSTRAINT "person_targets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_targets" ADD CONSTRAINT "person_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_targets" ADD CONSTRAINT "person_targets_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "person_targets" ADD CONSTRAINT "person_targets_amount_check" CHECK ("amount" > 0);
ALTER TABLE "person_targets" ADD CONSTRAINT "person_targets_month_check" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE "person_targets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "person_targets"
  USING (company_id = (SELECT app_company()))
  WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "person_targets" TO kebo_app;
CREATE TRIGGER "same_company_person_targets_user_id_fkey" BEFORE INSERT OR UPDATE OF "user_id" ON "person_targets"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('users', 'user_id');
CREATE TRIGGER "same_company_person_targets_updated_by_fkey" BEFORE INSERT OR UPDATE OF "updated_by" ON "person_targets"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('users', 'updated_by');
