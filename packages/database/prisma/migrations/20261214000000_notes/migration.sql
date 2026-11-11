-- Notes: inquiry_notes and record_notes become one table, "notes" (architecture review §6.7). Both held
-- the same thing (a note or call log: kind, body, the contact it was with, when it happened, who wrote
-- it) and differed only in the record the note is on. A note is now on exactly one of: an inquiry, an
-- order, a customer, a supplier.
--
-- Nothing is retyped and no id changes:
--   * "record_notes" is renamed to "notes", so its rows stay as they are;
--   * every inquiry note is copied into "notes" under its own id, with its inquiry;
--   * the old "inquiry_notes" table is kept, unused, as "inquiry_notes_before_notes" for one release.

-- A note of each table with the same id cannot both be kept (ids are random, so this never happens).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "inquiry_notes" i JOIN "record_notes" r ON r."id" = i."id") THEN
    RAISE EXCEPTION 'an inquiry note and a record note share an id: the two tables cannot be joined into one';
  END IF;
END $$;

-- 1. record_notes -> notes (same rows, same ids; its policy and grants come with it).
ALTER TABLE "record_notes" RENAME TO "notes";
ALTER TABLE "notes" RENAME CONSTRAINT "record_notes_pkey" TO "notes_pkey";
ALTER TABLE "notes" RENAME CONSTRAINT "record_notes_company_id_fkey" TO "notes_company_id_fkey";
ALTER TABLE "notes" RENAME CONSTRAINT "record_notes_order_id_fkey" TO "notes_order_id_fkey";
ALTER TABLE "notes" RENAME CONSTRAINT "record_notes_customer_id_fkey" TO "notes_customer_id_fkey";
ALTER TABLE "notes" RENAME CONSTRAINT "record_notes_factory_id_fkey" TO "notes_factory_id_fkey";
ALTER TABLE "notes" RENAME CONSTRAINT "record_notes_contact_id_fkey" TO "notes_contact_id_fkey";
ALTER TABLE "notes" RENAME CONSTRAINT "record_notes_author_id_fkey" TO "notes_author_id_fkey";
ALTER TABLE "notes" RENAME CONSTRAINT "record_notes_kind_check" TO "notes_kind_check";
ALTER INDEX "record_notes_company_id_idx" RENAME TO "notes_company_id_idx";
ALTER INDEX "record_notes_order_id_at_idx" RENAME TO "notes_order_id_at_idx";
ALTER INDEX "record_notes_customer_id_at_idx" RENAME TO "notes_customer_id_at_idx";
ALTER INDEX "record_notes_factory_id_at_idx" RENAME TO "notes_factory_id_at_idx";
ALTER TRIGGER "same_company_record_notes_order_id_fkey" ON "notes" RENAME TO "same_company_notes_order_id_fkey";
ALTER TRIGGER "same_company_record_notes_customer_id_fkey" ON "notes" RENAME TO "same_company_notes_customer_id_fkey";
ALTER TRIGGER "same_company_record_notes_factory_id_fkey" ON "notes" RENAME TO "same_company_notes_factory_id_fkey";
ALTER TRIGGER "same_company_record_notes_contact_id_fkey" ON "notes" RENAME TO "same_company_notes_contact_id_fkey";
ALTER TRIGGER "same_company_record_notes_author_id_fkey" ON "notes" RENAME TO "same_company_notes_author_id_fkey";

-- 2. A note may be on an inquiry: exactly one of the four records.
ALTER TABLE "notes" ADD COLUMN "inquiry_id" UUID;
CREATE INDEX "notes_inquiry_id_at_idx" ON "notes"("inquiry_id", "at");
ALTER TABLE "notes" ADD CONSTRAINT "notes_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" DROP CONSTRAINT "record_notes_one_record_check";
ALTER TABLE "notes" ADD CONSTRAINT "notes_one_record_check" CHECK (num_nonnulls("inquiry_id", "order_id", "customer_id", "factory_id") = 1);
CREATE TRIGGER "same_company_notes_inquiry_id_fkey" BEFORE INSERT OR UPDATE OF "inquiry_id" ON "notes"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('inquiries', 'inquiry_id');

-- An inquiry note may be up to 5000 characters (the others 4000, checked by the API as before). The
-- rule is for notes written from now on: the inquiry notes already there are kept exactly as they are.
ALTER TABLE "notes" DROP CONSTRAINT "record_notes_body_check";
ALTER TABLE "notes" ADD CONSTRAINT "notes_body_check" CHECK (length(btrim("body")) BETWEEN 1 AND 5000) NOT VALID;

-- 3. Every inquiry note becomes a note on its inquiry, under its own id.
INSERT INTO "notes" ("id", "company_id", "inquiry_id", "kind", "body", "contact_id", "at", "author_id", "created_at", "edited_at")
SELECT "id", "company_id", "inquiry_id", "kind", "body", "contact_id", "at", "author_id", "created_at", "edited_at"
  FROM "inquiry_notes";

-- 4. The old inquiry notes table: nothing points at it and nothing writes to it. Kept for one release.
ALTER TABLE "inquiry_notes" RENAME TO "inquiry_notes_before_notes";

-- The move lost nothing.
DO $$
DECLARE
  old_notes bigint := (SELECT count(*) FROM "inquiry_notes_before_notes");
  moved bigint := (SELECT count(*) FROM "notes" WHERE "inquiry_id" IS NOT NULL);
BEGIN
  IF moved <> old_notes THEN
    RAISE EXCEPTION 'notes: % inquiry notes became % notes on inquiries', old_notes, moved;
  END IF;
END $$;
