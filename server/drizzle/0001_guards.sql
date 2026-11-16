-- One ever increasing number for every accepted change (projects and settings): devices ask what changed since n.
CREATE SEQUENCE IF NOT EXISTS change_seq AS bigint START 1;
--> statement-breakpoint
-- The single settings document always exists.
INSERT INTO settings (id, rev, seq, prices, fab) VALUES (1, 0, 0, '{}'::jsonb, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Quotes are frozen once issued. The only change allowed is attaching the PDF once, to a quote that has none yet
-- (the number is reserved first, so it can be printed on the PDF). Deleting a quote is refused.
CREATE OR REPLACE FUNCTION quotes_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quotes are immutable: % cannot be deleted', OLD.number USING ERRCODE = 'P0001';
  END IF;
  IF OLD.pdf IS NULL AND NEW.pdf IS NOT NULL AND NEW.pdf_sha256 IS NOT NULL
     AND NEW.number = OLD.number AND NEW.year = OLD.year AND NEW.seq_no = OLD.seq_no
     AND NEW.project_id = OLD.project_id AND NEW.project_rev = OLD.project_rev
     AND NEW.client_name = OLD.client_name AND NEW.client_phone = OLD.client_phone
     AND NEW.currency = OLD.currency AND NEW.total = OLD.total AND NEW.snapshot = OLD.snapshot
     AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'quotes are immutable: % cannot be changed', OLD.number USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS quotes_frozen_trg ON quotes;
--> statement-breakpoint
CREATE TRIGGER quotes_frozen_trg BEFORE UPDATE OR DELETE ON quotes FOR EACH ROW EXECUTE FUNCTION quotes_frozen();
--> statement-breakpoint
-- Quote events and the audit log are append only.
CREATE OR REPLACE FUNCTION append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS quote_events_append_trg ON quote_events;
--> statement-breakpoint
CREATE TRIGGER quote_events_append_trg BEFORE UPDATE OR DELETE ON quote_events FOR EACH ROW EXECUTE FUNCTION append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_append_trg ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_append_trg BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION append_only();
