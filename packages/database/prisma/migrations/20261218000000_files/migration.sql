-- Documents 3a: one table for every stored file (ERPNext's File, attached to a record). A proof of payment, an
-- expense's receipt and the photo sent for approval become rows of attachments, linked to their record, instead
-- of file columns on each table. One live file per record (a new one replaces it; the old row is deleted).

ALTER TABLE "attachments" ALTER COLUMN "inquiry_id" DROP NOT NULL;
ALTER TABLE "attachments" ADD COLUMN "movement_id" UUID;
ALTER TABLE "attachments" ADD COLUMN "expense_id" UUID;
ALTER TABLE "attachments" ADD COLUMN "submission_id" UUID;
CREATE INDEX "attachments_movement_id_idx" ON "attachments"("movement_id");
CREATE INDEX "attachments_expense_id_idx" ON "attachments"("expense_id");
CREATE INDEX "attachments_submission_id_idx" ON "attachments"("submission_id");
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "money_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "money_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TRIGGER "same_company_attachments_movement_id_fkey" BEFORE INSERT OR UPDATE OF "movement_id" ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('money_movements', 'movement_id');
CREATE TRIGGER "same_company_attachments_expense_id_fkey" BEFORE INSERT OR UPDATE OF "expense_id" ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('expenses', 'expense_id');
CREATE TRIGGER "same_company_attachments_submission_id_fkey" BEFORE INSERT OR UPDATE OF "submission_id" ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('money_submissions', 'submission_id');

-- A file is on a deal, or it is the proof of exactly one record.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_check" CHECK (
  (inquiry_id IS NOT NULL AND num_nonnulls(movement_id, expense_id, submission_id) = 0)
  OR (inquiry_id IS NULL AND order_id IS NULL AND num_nonnulls(movement_id, expense_id, submission_id) = 1));
CREATE UNIQUE INDEX "attachments_one_proof_movement" ON "attachments"("movement_id") WHERE movement_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX "attachments_one_proof_expense" ON "attachments"("expense_id") WHERE expense_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX "attachments_one_proof_submission" ON "attachments"("submission_id") WHERE submission_id IS NOT NULL AND deleted_at IS NULL;

-- The proofs as rows (who added them: whoever recorded the record).
INSERT INTO "attachments" (id, company_id, movement_id, file_name, mime_type, size, storage_key, uploaded_by, created_at)
SELECT gen_random_uuid(), company_id, id, coalesce(file_name, 'proof'), coalesce(file_type, 'application/octet-stream'), coalesce(file_size, 0),
       file_key, recorded_by, updated_at
  FROM money_movements WHERE file_key IS NOT NULL;
INSERT INTO "attachments" (id, company_id, expense_id, file_name, mime_type, size, storage_key, uploaded_by, created_at)
SELECT gen_random_uuid(), company_id, id, coalesce(receipt_name, 'receipt'), coalesce(receipt_type, 'application/octet-stream'), coalesce(receipt_size, 0),
       receipt_key, recorded_by, updated_at
  FROM expenses WHERE receipt_key IS NOT NULL;
INSERT INTO "attachments" (id, company_id, submission_id, file_name, mime_type, size, storage_key, uploaded_by, created_at)
SELECT gen_random_uuid(), company_id, id, coalesce(file_name, 'file'), coalesce(file_type, 'application/octet-stream'), coalesce(file_size, 0),
       file_key, submitted_by, updated_at
  FROM money_submissions WHERE file_key IS NOT NULL;

ALTER TABLE "money_movements" DROP COLUMN "file_key", DROP COLUMN "file_name", DROP COLUMN "file_type", DROP COLUMN "file_size";
ALTER TABLE "expenses" DROP COLUMN "receipt_key", DROP COLUMN "receipt_name", DROP COLUMN "receipt_type", DROP COLUMN "receipt_size";
ALTER TABLE "money_submissions" DROP CONSTRAINT IF EXISTS "money_submissions_file_size_check";
ALTER TABLE "money_submissions" DROP COLUMN "file_key", DROP COLUMN "file_name", DROP COLUMN "file_type", DROP COLUMN "file_size";
