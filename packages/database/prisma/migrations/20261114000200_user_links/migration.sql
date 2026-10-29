-- 1. A phone's push token is unique per company, not across all of them: the
--    same phone signed in to two companies has a row in each. (The old index
--    is dropped only after the new one exists; existing rows already satisfy
--    the new, looser rule.)
CREATE UNIQUE INDEX "device_tokens_company_id_token_key" ON "device_tokens"("company_id", "token");
DROP INDEX "device_tokens_token_key";

-- 2. Every column that names a person (who made, recorded, wrote, assigned…)
--    now points at a real person of the same company: a foreign key, and the
--    same-company trigger every other link has. People are switched off, not
--    deleted; only deleting a whole company removes them (after these rows).
--    audit_logs.entity_id is left alone: it names records of many kinds.
--
--    Existing rows are checked first and nothing is lost:
--    - a column that may be empty: a person who is not there (or is in another
--      company) is emptied;
--    - a column that must name someone: such a row is given its company's
--      built-in "Website form" account (if the company has none, the key is
--      added without checking old rows, and checks every new one).
DO $$
DECLARE
  c record;
  fixed bigint;
  sys uuid;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('audit_logs', 'user_id', true),
      ('customers', 'created_by', true),
      ('factories', 'created_by', true),
      ('inquiry_stage_changes', 'changed_by', true),
      ('inquiry_assignments', 'assignee_id', true),
      ('sales_targets', 'updated_by', true),
      ('inquiry_assignments', 'assigned_by', false),
      ('inquiry_notes', 'author_id', false),
      ('attachments', 'uploaded_by', false),
      ('factory_quotes', 'created_by', false),
      ('quotation_revisions', 'created_by', false),
      ('orders', 'created_by', false),
      ('factory_payments', 'recorded_by', false),
      ('expenses', 'recorded_by', false),
      ('payments', 'recorded_by', false),
      ('money_transfers', 'recorded_by', false)
    ) AS t(tbl, col, nullable)
  LOOP
    IF c.nullable THEN
      EXECUTE format(
        'UPDATE %1$I x SET %2$I = NULL WHERE %2$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.%2$I AND u.company_id = x.company_id)',
        c.tbl, c.col);
      GET DIAGNOSTICS fixed = ROW_COUNT;
    ELSE
      EXECUTE format(
        'UPDATE %1$I x SET %2$I = u.id FROM users u WHERE u.company_id = x.company_id AND u.is_system AND u.email = ''website-form@system.local''
            AND NOT EXISTS (SELECT 1 FROM users v WHERE v.id = x.%2$I AND v.company_id = x.company_id)',
        c.tbl, c.col);
      GET DIAGNOSTICS fixed = ROW_COUNT;
    END IF;
    IF fixed > 0 THEN
      RAISE NOTICE '%.%: % row(s) pointed at no person of their company and were %', c.tbl, c.col, fixed,
        CASE WHEN c.nullable THEN 'emptied' ELSE 'given the company''s Website form account' END;
    END IF;

    EXECUTE format('ALTER TABLE %1$I ADD CONSTRAINT %2$I FOREIGN KEY (%3$I) REFERENCES "users"("id") ON DELETE %4$s ON UPDATE CASCADE NOT VALID',
                   c.tbl, c.tbl || '_' || c.col || '_fkey', c.col, CASE WHEN c.nullable THEN 'SET NULL' ELSE 'RESTRICT' END);
    -- Checked for the rows already here, unless some could not be put right (then only new rows are).
    EXECUTE format('SELECT count(*) FROM %1$I x WHERE x.%2$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.%2$I)', c.tbl, c.col) INTO fixed;
    IF fixed = 0 THEN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', c.tbl, c.tbl || '_' || c.col || '_fkey');
    ELSE
      RAISE WARNING '%.%: % row(s) point at no person and could not be put right; the key checks new rows only', c.tbl, c.col, fixed;
    END IF;

    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_company(%L, %L)',
                   left('same_company_' || c.tbl || '_' || c.col || '_fkey', 63), c.col, c.tbl, 'users', c.col);
  END LOOP;
END $$;
