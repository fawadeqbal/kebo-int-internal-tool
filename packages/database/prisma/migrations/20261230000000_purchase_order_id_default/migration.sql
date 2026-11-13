-- A purchase order's id is filled by the database: the trigger that opens one when an order is made
-- inserts it in SQL, without an id. The schema file did not say so, so `prisma migrate dev` on a
-- developer's machine wrote a migration that dropped this default, and accepting a quotation then
-- failed there. The schema now says it; this puts the default back wherever it was dropped
-- (it changes nothing where it is still there).
ALTER TABLE "purchase_orders" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
