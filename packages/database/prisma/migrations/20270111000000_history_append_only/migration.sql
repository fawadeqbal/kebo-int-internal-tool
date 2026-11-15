-- History is written once, like the ledger. The app's company connection (kebo_app) may add rows to these tables
-- but never change or remove them:
--   audit_logs             who changed what, with the old and new values
--   inquiry_stage_changes  each move of an inquiry (New → Sourcing → Quoted → Won/Lost)
--   order_stage_changes    each move of an order (Confirmed → In production → Shipped → Done)
--   order_papers           every FINAL version of a made document (a draft can still change or be deleted)
-- The owner's connection is not stopped: migrations, removing a whole company's data, and what Postgres does
-- itself when a record is removed (ON DELETE CASCADE / SET NULL run as the table's owner). A one-off repair on the
-- company connection says so inside its transaction: SET LOCAL kebo.history_rewrite = 'on'.

CREATE FUNCTION history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'kebo_app' AND coalesce(current_setting('kebo.history_rewrite', true), '') <> 'on' THEN
    RAISE EXCEPTION 'History is never changed or deleted: it stays as it was written'
      USING ERRCODE = 'P0001', HINT = 'history_append_only';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- A made document: only its final versions are history.
CREATE FUNCTION papers_final_kept() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'final' AND current_user = 'kebo_app' AND coalesce(current_setting('kebo.history_rewrite', true), '') <> 'on' THEN
    RAISE EXCEPTION 'A final version stays as it was printed: make it again for a new version'
      USING ERRCODE = 'P0001', HINT = 'paper_final_kept';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs" FOR EACH STATEMENT EXECUTE FUNCTION history_append_only();

CREATE TRIGGER inquiry_stage_changes_append_only BEFORE UPDATE OR DELETE ON "inquiry_stage_changes" FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER inquiry_stage_changes_no_truncate BEFORE TRUNCATE ON "inquiry_stage_changes" FOR EACH STATEMENT EXECUTE FUNCTION history_append_only();

CREATE TRIGGER order_stage_changes_append_only BEFORE UPDATE OR DELETE ON "order_stage_changes" FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER order_stage_changes_no_truncate BEFORE TRUNCATE ON "order_stage_changes" FOR EACH STATEMENT EXECUTE FUNCTION history_append_only();

CREATE TRIGGER order_papers_final_kept BEFORE UPDATE OR DELETE ON "order_papers" FOR EACH ROW EXECUTE FUNCTION papers_final_kept();
CREATE TRIGGER order_papers_no_truncate BEFORE TRUNCATE ON "order_papers" FOR EACH STATEMENT EXECUTE FUNCTION history_append_only();
