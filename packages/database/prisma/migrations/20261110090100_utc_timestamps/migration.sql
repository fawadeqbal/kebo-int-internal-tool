-- Time zone fix. Until now the app's connections used the database's own time zone
-- (Asia/Shanghai on the live server), and the Prisma driver wrote every time as UTC
-- wall-clock text that Postgres then read as Shanghai time: each stored moment was
-- 8 hours early (round trips looked right; anything comparing with the database's
-- own clock, or reading the data another way, was off).
--
-- From now on every connection runs in UTC (set here for the database, and by the
-- app on each connection). This moves the times already stored back to the moment
-- they meant: the wall-clock time in the old zone, read as UTC. On a database that
-- already ran in UTC (CI, a fresh install) the old zone is UTC and nothing changes.
-- Only company tables: the platform tables are new.
DO $$
DECLARE
  old_zone text := current_setting('TimeZone');
  r record;
BEGIN
  IF old_zone NOT IN ('UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Z') THEN
    FOR r IN
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.columns k ON k.table_schema = c.table_schema AND k.table_name = c.table_name AND k.column_name = 'company_id'
      WHERE c.table_schema = current_schema() AND c.data_type = 'timestamp with time zone'
        AND c.table_name NOT IN ('subscription_payments', 'leads', 'platform_log')
      ORDER BY 1, 2
    LOOP
      EXECUTE format('UPDATE %I SET %I = (%I AT TIME ZONE %L) AT TIME ZONE ''UTC'' WHERE %I IS NOT NULL',
                     r.table_name, r.column_name, r.column_name, old_zone, r.column_name);
    END LOOP;
    RAISE NOTICE 'Stored times moved from % to UTC', old_zone;
  END IF;
  EXECUTE format('ALTER DATABASE %I SET TimeZone TO ''UTC''', current_database());
END $$;
