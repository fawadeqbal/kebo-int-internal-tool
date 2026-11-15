-- One-time keys for money saves (the Idempotency-Key header). A save sent twice (a double tap, a retry after the
-- answer was lost, the phone's waiting saves sent again) is done once: the repeat carries the same key and gets the
-- first answer. Per person, per company; kept 7 days (the API's daily clean-up removes older ones).

-- CreateTable
CREATE TABLE "request_keys" (
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "user_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "action" VARCHAR(200) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "answer" JSONB,
    "answered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_keys_pkey" PRIMARY KEY ("company_id","user_id","key")
);

-- CreateIndex
CREATE INDEX "request_keys_created_at_idx" ON "request_keys"("created_at");

-- AddForeignKey
ALTER TABLE "request_keys" ADD CONSTRAINT "request_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_keys" ADD CONSTRAINT "request_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Kept apart per company like every company table.
ALTER TABLE "request_keys" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "request_keys" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "request_keys" TO kebo_app;
-- The person is one of the company's.
CREATE TRIGGER same_company_request_keys_user_id_fkey BEFORE INSERT OR UPDATE OF "user_id" ON "request_keys"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('users', 'user_id');
