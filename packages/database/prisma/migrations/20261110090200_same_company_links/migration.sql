-- A row may only point at rows of its own company. Foreign keys alone do not
-- check that (they look past row-level security), so every link between company
-- tables gets a trigger that does: a link to another company's row is refused
-- as if that row did not exist. Links to the platform tables are not checked.

CREATE OR REPLACE FUNCTION enforce_same_company() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  found boolean;
BEGIN
  IF target IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND company_id = $2)', TG_ARGV[0]) INTO found USING target, NEW.company_id;
  IF NOT found THEN
    RAISE EXCEPTION 'row-level security: %.% points at a row of another company', TG_TABLE_NAME, TG_ARGV[1] USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT cl.relname AS child, pa.relname AS parent, a.attname AS col, k.conname
      FROM pg_constraint k
      JOIN pg_class cl ON cl.oid = k.conrelid
      JOIN pg_class pa ON pa.oid = k.confrelid
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      JOIN pg_attribute pk ON pk.attrelid = k.confrelid AND pk.attnum = k.confkey[1]
     WHERE k.contype = 'f' AND cl.relrowsecurity AND pa.relrowsecurity
       AND array_length(k.conkey, 1) = 1 AND pk.attname = 'id'
     ORDER BY 1, 3
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_company(%L, %L)',
                   left('same_company_' || r.conname, 63), r.col, r.child, r.parent, r.col);
  END LOOP;
END $$;
