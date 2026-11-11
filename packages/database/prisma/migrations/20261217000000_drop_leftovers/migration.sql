-- Clean-up (work order step 7): the copies kept until the live checks passed after #118 (parties), #119 (notes)
-- and #122 (customer money). All three passed on live; nothing reads them.
DROP TABLE IF EXISTS "factories_before_parties";
DROP TABLE IF EXISTS "inquiry_notes_before_notes";
DROP TABLE IF EXISTS "credits_before_movements";

-- Prisma sets updated_at itself (as on every other table).
ALTER TABLE "money_movements" ALTER COLUMN "updated_at" DROP DEFAULT;
