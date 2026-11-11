-- Contacts for every party (step 6, architecture review §6.1): contacts.customer_id becomes party_id, and a
-- supplier's main contact, typed on the supplier until now, becomes its primary contact. The four columns go.

ALTER TABLE "contacts" RENAME COLUMN "customer_id" TO "party_id";
ALTER INDEX "contacts_customer_id_idx" RENAME TO "contacts_party_id_idx";
ALTER TABLE "contacts" RENAME CONSTRAINT "contacts_customer_id_fkey" TO "contacts_party_id_fkey";
DROP TRIGGER IF EXISTS "same_company_contacts_customer_id_fkey" ON "contacts";
CREATE TRIGGER "same_company_contacts_party_id_fkey" BEFORE INSERT OR UPDATE OF "party_id" ON "contacts"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('parties', 'party_id');

-- A supplier's main contact: its person (or the supplier's name when only a number was typed), primary.
INSERT INTO "contacts" ("id", "company_id", "party_id", "name", "phone", "wechat", "email", "is_primary", "created_at", "updated_at")
SELECT gen_random_uuid(), p.company_id, p.id, coalesce(nullif(trim(p.contact_person), ''), p.name), p.phone, p.wechat, p.email,
       NOT EXISTS (SELECT 1 FROM "contacts" c WHERE c.party_id = p.id AND c.is_primary AND c.deleted_at IS NULL),
       p.created_at, p.updated_at
  FROM "parties" p
 WHERE coalesce(nullif(trim(p.contact_person), ''), p.phone, p.wechat, p.email) IS NOT NULL;

ALTER TABLE "parties" DROP COLUMN "contact_person", DROP COLUMN "phone", DROP COLUMN "wechat", DROP COLUMN "email";
