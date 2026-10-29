-- Company connections now log in as kebo_app themselves (before, they logged in
-- as the owner and switched with "-c role=kebo_app"; the owner is a superuser,
-- so SQL on a company connection could switch back with SET ROLE and pass
-- row-level security). The API gives kebo_app its login and password when it
-- starts (see packages/database/src/company-role.ts); this migration does the
-- rest, and changes no data.

-- Never a superuser, never past row-level security, and a member of no other
-- role (so SET ROLE to the owner is refused). The owner keeps its membership of
-- kebo_app; that way round is harmless.
DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kebo_app' AND rolsuper) THEN
    ALTER ROLE kebo_app WITH NOSUPERUSER;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kebo_app' AND rolbypassrls) THEN
    ALTER ROLE kebo_app WITH NOBYPASSRLS;
  END IF;
  FOR r IN
    SELECT g.rolname FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
     WHERE u.rolname = 'kebo_app'
  LOOP
    EXECUTE format('REVOKE %I FROM kebo_app', r.rolname);
  END LOOP;
END $$;

-- The company of the connection as it was when it connected. app.company_id is
-- given as a start-up option; SQL on the connection could change it later
-- (SET, set_config), but "SET LOCAL … TO DEFAULT" reads the start-up value
-- again, and stays inside the function (its SET clause puts the session's own
-- value back when it returns). So the policies below follow the company the
-- connection was opened for, and nothing run on it can move it to another.
CREATE OR REPLACE FUNCTION app_company() RETURNS uuid
LANGUAGE plpgsql VOLATILE PARALLEL RESTRICTED
SET search_path = pg_catalog
SET app.company_id = ''
AS $$
BEGIN
  SET LOCAL app.company_id TO DEFAULT;
  RETURN nullif(current_setting('app.company_id', true), '')::uuid;
END $$;

-- Every company table's policy now compares with it (once per query: the
-- sub-select is worked out once, not per row).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_policies WHERE schemaname = current_schema() AND policyname = 'company_isolation' LOOP
    EXECUTE format('ALTER POLICY company_isolation ON %I USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()))', r.tablename);
  END LOOP;
END $$;

-- New rows are tagged with the same company (the column default read the
-- setting itself, so a changed setting would have tagged rows wrongly; they
-- were refused, but the connection was spoilt).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND column_name = 'company_id' AND column_default LIKE '%current_setting(''app.company_id''%'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET DEFAULT app_company()', r.table_name);
  END LOOP;
END $$;
