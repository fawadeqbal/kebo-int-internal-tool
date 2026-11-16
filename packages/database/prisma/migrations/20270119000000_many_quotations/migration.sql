-- Many quotations per inquiry (design "one way, any number", approved 17 Nov 2026): A, B, C… each from one
-- factory offer (or own prices), each with its own revisions. The inquiry keeps one QUO number; a quotation
-- prints it with its letter (QUO-2026-0531-B). Every quotation already made is its inquiry's first: letter A,
-- its number unchanged (QUO-2026-0007), so nothing printed or sent changes. The (inquiry, letter) index also
-- serves every lookup by inquiry.
-- "not_chosen": a sent quotation whose customer accepted another of the inquiry's quotations.

-- AlterEnum
ALTER TYPE "RevisionStatus" ADD VALUE 'not_chosen';

-- DropIndex
DROP INDEX "quotations_inquiry_id_key";

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "letter" VARCHAR(3) NOT NULL DEFAULT 'A';

-- CreateIndex
CREATE UNIQUE INDEX "quotations_inquiry_id_letter_key" ON "quotations"("inquiry_id", "letter");
