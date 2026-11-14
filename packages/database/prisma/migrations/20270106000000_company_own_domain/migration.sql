-- A company's own domain (Settings › Company address): the domain, where it stands (waiting, connected,
-- lost), what the last check found, and when. The company's address under ours keeps working.
ALTER TABLE "companies"
  ADD COLUMN "own_domain" VARCHAR(253),
  ADD COLUMN "own_domain_status" VARCHAR(10),
  ADD COLUMN "own_domain_problem" VARCHAR(20),
  ADD COLUMN "own_domain_checked_at" TIMESTAMPTZ,
  ADD COLUMN "own_domain_since" TIMESTAMPTZ,
  ADD COLUMN "own_domain_lost_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX "companies_own_domain_key" ON "companies"("own_domain");
