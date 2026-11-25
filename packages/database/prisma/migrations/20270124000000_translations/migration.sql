-- The translator's memory (25 Nov 2026): each English text the papers print once, with its Chinese and who wrote
-- it (machine: the translator, to be checked; staff: typed or checked). Waiting texts are translated by the worker.

CREATE TABLE "translations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "hash" VARCHAR(64) NOT NULL,
    "source" TEXT NOT NULL,
    "zh" TEXT,
    "by" VARCHAR(10),
    "status" VARCHAR(10) NOT NULL DEFAULT 'waiting',
    "tries" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(300),
    "next_try_at" TIMESTAMPTZ,
    "checked_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "translations_by_check" CHECK ("by" IS NULL OR "by" IN ('machine', 'staff')),
    CONSTRAINT "translations_status_check" CHECK ("status" IN ('waiting', 'done', 'failed'))
);

CREATE UNIQUE INDEX "translations_company_id_hash_key" ON "translations"("company_id", "hash");
CREATE INDEX "translations_status_next_try_at_idx" ON "translations"("status", "next_try_at");

ALTER TABLE "translations" ADD CONSTRAINT "translations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Kept apart per company like every company table.
ALTER TABLE "translations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "translations"
  USING (company_id = (SELECT app_company()))
  WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "translations" TO kebo_app;

