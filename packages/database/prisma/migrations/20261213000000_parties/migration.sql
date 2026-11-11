-- Parties: customers and factories become one table, "parties", with the role(s) each party holds in
-- "party_roles" (architecture review §6.1). The two tables held the same thing (a company we deal with:
-- name, address, notes, who added it) twice.
--
-- Nothing is retyped and no id changes:
--   * "customers" is renamed to "parties", so every customer row, and every link to it, stays as it is;
--   * every factory row is copied into "parties" under its own id, and each link to a factory
--     (the factory_id columns) is pointed at "parties";
--   * the old "factories" table is kept, unused, as "factories_before_parties" for one release.
-- The columns other tables use keep their names (customer_id, factory_id): they say which role the
-- party plays in that row. The main contact typed on a factory (contact_person, phone, wechat, email)
-- stays on the party for now; it joins "contacts" in the next step.

-- A factory and a customer with the same id cannot both be kept (ids are random, so this never happens).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "factories" f JOIN "customers" c ON c."id" = f."id") THEN
    RAISE EXCEPTION 'a factory and a customer share an id: the two tables cannot be joined into one';
  END IF;
END $$;

-- 1. customers -> parties (same rows, same ids; its links, policy and grants come with it).
ALTER TYPE "CustomerType" RENAME TO "PartyType";
ALTER TABLE "customers" RENAME TO "parties";
ALTER TABLE "parties" RENAME CONSTRAINT "customers_pkey" TO "parties_pkey";
ALTER TABLE "parties" RENAME CONSTRAINT "customers_company_id_fkey" TO "parties_company_id_fkey";
ALTER TABLE "parties" RENAME CONSTRAINT "customers_created_by_fkey" TO "parties_created_by_fkey";
ALTER INDEX "customers_name_idx" RENAME TO "parties_name_idx";
ALTER INDEX "customers_country_idx" RENAME TO "parties_country_idx";
ALTER INDEX "customers_company_id_idx" RENAME TO "parties_company_id_idx";
ALTER TRIGGER "same_company_customers_created_by_fkey" ON "parties" RENAME TO "same_company_parties_created_by_fkey";

-- 2. What a supplier has and a customer did not. Country and currency are unknown for the suppliers
--    we have (they were never asked), so both may be empty; a customer is still required to have them.
ALTER TABLE "parties"
  ALTER COLUMN "country" DROP NOT NULL,
  ALTER COLUMN "default_currency" DROP NOT NULL,
  ALTER COLUMN "default_currency" DROP DEFAULT,
  ADD COLUMN "contact_person" VARCHAR(120),
  ADD COLUMN "phone" VARCHAR(40),
  ADD COLUMN "wechat" VARCHAR(80),
  ADD COLUMN "email" VARCHAR(254),
  ADD COLUMN "bank_details" TEXT,
  ADD COLUMN "owner_id" UUID;
CREATE INDEX "parties_owner_id_idx" ON "parties"("owner_id");
ALTER TABLE "parties" ADD CONSTRAINT "parties_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Roles: a row puts a party on the Customers or the Suppliers list.
CREATE TYPE "PartyRoleKind" AS ENUM ('customer', 'supplier');
CREATE TABLE "party_roles" (
    "party_id" UUID NOT NULL,
    "role" "PartyRoleKind" NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_roles_pkey" PRIMARY KEY ("party_id","role")
);
CREATE INDEX "party_roles_role_idx" ON "party_roles"("role");
CREATE INDEX "party_roles_company_id_idx" ON "party_roles"("company_id");
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "party_roles" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "party_roles" TO kebo_app;

-- Every party there is now is a customer.
INSERT INTO "party_roles" ("party_id", "role", "company_id", "created_at")
SELECT "id", 'customer', "company_id", "created_at" FROM "parties";

-- 4. Every factory becomes a party with the supplier role, under its own id.
INSERT INTO "parties" ("id", "company_id", "type", "name", "address", "contact_person", "phone", "wechat", "email", "bank_details", "notes",
                       "owner_id", "created_by", "deleted_at", "created_at", "updated_at")
SELECT "id", "company_id", 'company', "name", "address", "contact_person", "phone", "wechat", "email", "bank_details", "notes",
       "owner_id", "created_by", "deleted_at", "created_at", "updated_at"
  FROM "factories";
INSERT INTO "party_roles" ("party_id", "role", "company_id", "created_at")
SELECT "id", 'supplier', "company_id", "created_at" FROM "factories";

-- 5. Every link to a factory points at parties (adding the link checks every row has its party).
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_factory_id_fkey", ADD CONSTRAINT "expenses_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "factory_order_facts" DROP CONSTRAINT "factory_order_facts_factory_id_fkey", ADD CONSTRAINT "factory_order_facts_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "factory_payment_plans" DROP CONSTRAINT "factory_payment_plans_factory_id_fkey", ADD CONSTRAINT "factory_payment_plans_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "factory_payments" DROP CONSTRAINT "factory_payments_factory_id_fkey", ADD CONSTRAINT "factory_payments_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "factory_quotes" DROP CONSTRAINT "factory_quotes_factory_id_fkey", ADD CONSTRAINT "factory_quotes_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "factory_requests" DROP CONSTRAINT "factory_requests_factory_id_fkey", ADD CONSTRAINT "factory_requests_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "follow_ups" DROP CONSTRAINT "follow_ups_factory_id_fkey", ADD CONSTRAINT "follow_ups_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_factory_id_fkey", ADD CONSTRAINT "ledger_entries_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "order_checklist_items" DROP CONSTRAINT "order_checklist_items_factory_id_fkey", ADD CONSTRAINT "order_checklist_items_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "order_factories" DROP CONSTRAINT "order_factories_factory_id_fkey", ADD CONSTRAINT "order_factories_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_factory_id_fkey", ADD CONSTRAINT "order_lines_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "record_notes" DROP CONSTRAINT "record_notes_factory_id_fkey", ADD CONSTRAINT "record_notes_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "parties"("id") ON UPDATE CASCADE ON DELETE CASCADE;

-- 6. Links between company tables may only point inside the company. Each of those triggers names the
--    table it looks in, so the ones that named customers or factories are made again for parties
--    (and the new links get theirs: parties.owner_id, party_roles.party_id).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, t.tgname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND t.tgname LIKE 'same\_company\_%'
       AND c.relnamespace = current_schema()::regnamespace AND c.relname <> 'factories'
       AND split_part(encode(t.tgargs, 'escape'), '\000', 1) IN ('customers', 'factories')
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %I', r.tgname, r.tbl);
  END LOOP;

  FOR r IN
    SELECT cl.relname AS child, pa.relname AS parent, a.attname AS col, k.conname
      FROM pg_constraint k
      JOIN pg_class cl ON cl.oid = k.conrelid
      JOIN pg_class pa ON pa.oid = k.confrelid
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      JOIN pg_attribute pk ON pk.attrelid = k.confrelid AND pk.attnum = k.confkey[1]
     WHERE k.contype = 'f' AND cl.relrowsecurity AND pa.relrowsecurity
       AND array_length(k.conkey, 1) = 1 AND pk.attname = 'id' AND a.attname <> 'company_id'
       AND cl.relnamespace = current_schema()::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = k.conrelid AND tg.tgname = left('same_company_' || k.conname, 63))
     ORDER BY 1, 3
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_company(%L, %L)',
                   left('same_company_' || r.conname, 63), r.col, r.child, r.parent, r.col);
  END LOOP;
END $$;

-- 7. The old factories table: nothing points at it and nothing writes to it. Kept for one release.
ALTER TABLE "factories" RENAME TO "factories_before_parties";

-- The move lost nothing: every factory is a party with the supplier role, every other party a customer.
DO $$
DECLARE
  factories bigint := (SELECT count(*) FROM "factories_before_parties");
  suppliers bigint := (SELECT count(*) FROM "party_roles" WHERE "role" = 'supplier');
  customers bigint := (SELECT count(*) FROM "party_roles" WHERE "role" = 'customer');
  parties bigint := (SELECT count(*) FROM "parties");
BEGIN
  IF suppliers <> factories OR customers + suppliers <> parties THEN
    RAISE EXCEPTION 'parties: % factories became % suppliers; % customers + % suppliers <> % parties', factories, suppliers, customers, suppliers, parties;
  END IF;
END $$;
