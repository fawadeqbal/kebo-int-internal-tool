-- Customer and supplier codes (CUS-0012, SUP-0007): one number per company and role, from the company's counters.
-- A party that is both has both. Existing parties get theirs in the order they were added; new ones when they
-- take the role (a trigger, so every way a party is made numbers it the same).
ALTER TABLE "parties" ADD COLUMN "customer_code" VARCHAR(20), ADD COLUMN "supplier_code" VARCHAR(20);

WITH numbered AS (
  SELECT r.party_id, r.company_id, row_number() OVER (PARTITION BY r.company_id ORDER BY p.created_at, p.id) AS n
  FROM party_roles r JOIN parties p ON p.id = r.party_id WHERE r.role = 'customer'
)
UPDATE parties p SET customer_code = 'CUS-' || lpad(numbered.n::text, 4, '0') FROM numbered WHERE numbered.party_id = p.id;

WITH numbered AS (
  SELECT r.party_id, r.company_id, row_number() OVER (PARTITION BY r.company_id ORDER BY p.created_at, p.id) AS n
  FROM party_roles r JOIN parties p ON p.id = r.party_id WHERE r.role = 'supplier'
)
UPDATE parties p SET supplier_code = 'SUP-' || lpad(numbered.n::text, 4, '0') FROM numbered WHERE numbered.party_id = p.id;

INSERT INTO counters (company_id, key, value)
SELECT company_id, 'party-' || role::text, count(*) FROM party_roles GROUP BY company_id, role
ON CONFLICT (company_id, key) DO UPDATE SET value = GREATEST(counters.value, EXCLUDED.value);

CREATE UNIQUE INDEX "parties_company_id_customer_code_key" ON "parties"("company_id", "customer_code");
CREATE UNIQUE INDEX "parties_company_id_supplier_code_key" ON "parties"("company_id", "supplier_code");

CREATE OR REPLACE FUNCTION party_role_code() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO counters (company_id, key, value) VALUES (NEW.company_id, 'party-' || NEW.role::text, 1)
    ON CONFLICT (company_id, key) DO UPDATE SET value = counters.value + 1
    RETURNING value INTO n;
  IF NEW.role = 'customer' THEN
    UPDATE parties SET customer_code = 'CUS-' || lpad(n::text, 4, '0') WHERE id = NEW.party_id AND customer_code IS NULL;
  ELSE
    UPDATE parties SET supplier_code = 'SUP-' || lpad(n::text, 4, '0') WHERE id = NEW.party_id AND supplier_code IS NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER party_role_code AFTER INSERT ON party_roles FOR EACH ROW EXECUTE FUNCTION party_role_code();
