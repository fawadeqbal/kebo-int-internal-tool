-- Each company's website form key: the form sends it, and it decides which
-- company the inquiry is for (before, the company came from ?company= or the
-- X-Company header, which anyone can send). Existing companies get one now.
-- gen_random_uuid() uses the server's strong random source: two of them are
-- about 244 random bits.
ALTER TABLE "companies" ADD COLUMN "form_key" VARCHAR(64) NOT NULL DEFAULT replace((gen_random_uuid())::text || (gen_random_uuid())::text, '-'::text, ''::text);

CREATE UNIQUE INDEX "companies_form_key_key" ON "companies"("form_key");
