BEGIN;

ALTER TABLE consent_audit_events ADD COLUMN IF NOT EXISTS capture_digest TEXT;
ALTER TABLE consent_audit_heads ADD COLUMN IF NOT EXISTS captured_count BIGINT;
ALTER TABLE consent_audit_heads ADD COLUMN IF NOT EXISTS last_captured_id BIGINT;
UPDATE consent_audit_heads h
SET captured_count=(SELECT COUNT(*) FROM consent_audit_events e WHERE e.mother_id=h.mother_id),
    last_captured_id=(SELECT MAX(id) FROM consent_audit_events e WHERE e.mother_id=h.mother_id)
WHERE captured_count IS NULL;
ALTER TABLE consent_audit_heads ALTER COLUMN captured_count SET DEFAULT 0;
ALTER TABLE consent_audit_heads ALTER COLUMN captured_count SET NOT NULL;

CREATE TABLE IF NOT EXISTS consent_receipt_signers (
  key_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL
);
DROP TRIGGER IF EXISTS immutable_receipt_signers ON consent_receipt_signers;
CREATE TRIGGER immutable_receipt_signers BEFORE UPDATE OR DELETE ON consent_receipt_signers
  FOR EACH ROW EXECUTE FUNCTION dai_immutable_audit();

CREATE OR REPLACE FUNCTION dai_consent_capture_digest(r consent_audit_events) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(
    ((to_jsonb(r) - 'capture_digest') || jsonb_build_object(
      'occurred_at',to_char(r.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'recorded_at',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ))::text, 'UTF8')), 'hex');
$$;

-- Independent of sealing. A pending event cannot quietly disappear or change
-- between capture and the first verification.
CREATE OR REPLACE FUNCTION dai_track_captured_consent() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM dai_audit_head_lock(NEW.mother_id);
  NEW.recorded_at := clock_timestamp();
  NEW.capture_digest := dai_consent_capture_digest(NEW);
  UPDATE consent_audit_heads SET captured_count=captured_count+1,last_captured_id=NEW.id
   WHERE mother_id=NEW.mother_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS track_captured_consent ON consent_audit_events;
CREATE TRIGGER track_captured_consent BEFORE INSERT ON consent_audit_events
  FOR EACH ROW EXECUTE FUNCTION dai_track_captured_consent();

DO $$
DECLARE item TEXT;
BEGIN
  FOREACH item IN ARRAY ARRAY['consent_audit_events','consent_audit_seals','consent_audit_heads','consent_receipts','consent_receipt_signers']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS prevent_audit_truncate ON %I', item);
    EXECUTE format('CREATE TRIGGER prevent_audit_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION dai_immutable_audit()', item);
  END LOOP;
END $$;

-- Store identifiers and access context rather than intake drafts or clinical text.
CREATE OR REPLACE FUNCTION dai_audit_document_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_id INTEGER; context JSONB; was_read BOOLEAN;
BEGIN
  SELECT mother_id INTO owner_id FROM patient_documents WHERE id=NEW.document_id;
  IF owner_id IS NULL THEN RETURN NEW; END IF;
  was_read := NEW.event_type IN ('download','preview','metadata_read','reveal');
  context := jsonb_strip_nulls(jsonb_build_object(
    'document_id', NEW.document_id,
    'operation', NEW.event_type,
    'actor_role', NEW.detail->'by_role',
    'doctor_id', NEW.detail->'doctor_id',
    'action', NEW.detail->'action',
    'list', NEW.detail->'list'
  ));
  INSERT INTO consent_audit_events(mother_id,source,event_type,actor_id,subject_type,subject_ref,resource,allowed,occurred_at,payload)
  VALUES(owner_id,'document_event','document_' || NEW.event_type,NEW.actor_id,
    'document',NEW.document_id::text,'document',CASE WHEN was_read THEN TRUE END,NEW.created_at,context);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION dai_audit_access_control() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    INSERT INTO consent_audit_events(mother_id,source,event_type,actor_id,subject_type,subject_ref,occurred_at,payload)
    VALUES(OLD.mother_id,'consent_control','access_override_removed',OLD.mother_id,OLD.grantee_type,
      OLD.grantee_ref,clock_timestamp(),jsonb_build_object('previous_state',OLD.state));
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.state=NEW.state AND OLD.reason IS NOT DISTINCT FROM NEW.reason THEN RETURN NEW; END IF;
  INSERT INTO consent_audit_events(mother_id,source,event_type,actor_id,subject_type,subject_ref,occurred_at,payload)
  VALUES(NEW.mother_id,'consent_control','consent_' || NEW.state,NEW.mother_id,NEW.grantee_type,NEW.grantee_ref,
    NEW.updated_at,jsonb_build_object('state',NEW.state,'previous_state',CASE WHEN TG_OP='UPDATE' THEN OLD.state END,
      'transaction_id',txid_current()::text));
  RETURN NEW;
END $$;

-- Capture sharing state at the write transaction, including account closure.
-- Copy only entitlement metadata; never copy document contents, notes or tokens.
CREATE OR REPLACE FUNCTION dai_audit_scoped_sharing() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r JSONB; old_r JSONB; owner_id INTEGER; ref TEXT; kind TEXT;
        subject TEXT; actor INTEGER; details JSONB; revoked BOOL; at TIMESTAMPTZ;
BEGIN
  r := to_jsonb(NEW); old_r := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END;
  at := clock_timestamp();
  owner_id := (r->>'mother_id')::int;
  IF TG_TABLE_NAME='patient_document_shares' THEN
    SELECT mother_id INTO owner_id FROM patient_documents WHERE id=(r->>'document_id')::int;
    ref := r->>'doctor_id'; subject := 'doctor'; kind := 'report_sharing';
    IF TG_OP='UPDATE' AND ROW(OLD.revoked_at,OLD.expires_at,OLD.shared_at) IS NOT DISTINCT FROM ROW(NEW.revoked_at,NEW.expires_at,NEW.shared_at) THEN RETURN NEW; END IF;
    details := jsonb_build_object('document_id',r->'document_id','expires_at',r->'expires_at');
  ELSIF TG_TABLE_NAME='clinical_dashboard_consent' OR TG_TABLE_NAME='timeline_summary_shares' THEN
    ref := r->>'doctor_id'; subject := 'doctor';
    kind := CASE WHEN TG_TABLE_NAME='clinical_dashboard_consent' THEN 'clinical_summary' ELSE 'timeline_summary' END;
    IF TG_OP='UPDATE' AND ROW(OLD.revoked_at,OLD.expires_at) IS NOT DISTINCT FROM ROW(NEW.revoked_at,NEW.expires_at) THEN RETURN NEW; END IF;
    details := jsonb_build_object('share_id',r->'id','expires_at',r->'expires_at');
  ELSIF TG_TABLE_NAME='family_access_grants' THEN
    ref := r->>'id'; subject := 'family_grant'; kind := 'family_sharing';
    IF TG_OP='UPDATE' AND ROW(OLD.revoked_at,OLD.expires_at,OLD.grantee_id,OLD.scopes,OLD.child_ids) IS NOT DISTINCT FROM ROW(NEW.revoked_at,NEW.expires_at,NEW.grantee_id,NEW.scopes,NEW.child_ids) THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND OLD.grantee_id IS DISTINCT FROM NEW.grantee_id AND NEW.revoked_at IS NULL THEN RETURN NEW; END IF;
    details := jsonb_build_object('grantee_id',r->'grantee_id','scopes',r->'scopes','child_ids',r->'child_ids','expires_at',r->'expires_at');
  ELSIF TG_TABLE_NAME='remote_visits' THEN
    SELECT mother_id INTO owner_id FROM appointments WHERE id=(r->>'appointment_id')::int;
    ref := r->>'appointment_id'; subject := 'appointment'; kind := 'remote_visit';
    IF TG_OP='UPDATE' AND ROW(OLD.revoked_at,OLD.consent_at) IS NOT DISTINCT FROM ROW(NEW.revoked_at,NEW.consent_at) THEN RETURN NEW; END IF;
    IF NEW.consent_at IS NULL AND NEW.revoked_at IS NULL THEN RETURN NEW; END IF;
    details := jsonb_build_object('mode',r->'mode');
  ELSIF TG_TABLE_NAME='patient_preferences' THEN
    owner_id := NEW.user_id; kind := 'document_sharing';
    IF NOT (NEW.preferences ? 'privacy_share_doctors') OR
       (TG_OP='UPDATE' AND OLD.preferences->'privacy_share_doctors' IS NOT DISTINCT FROM NEW.preferences->'privacy_share_doctors') OR
       NOT EXISTS(SELECT 1 FROM users WHERE id=owner_id AND role='mother') THEN RETURN NEW; END IF;
    r := r || jsonb_build_object('revoked_at',CASE WHEN NEW.preferences->>'privacy_share_doctors'='false' THEN to_jsonb(at) ELSE NULL END);
    details := '{}'::jsonb;
  END IF;
  IF owner_id IS NULL THEN RETURN NEW; END IF;
  actor := owner_id;
  revoked := r->>'revoked_at' IS NOT NULL;
  IF revoked THEN at := (r->>'revoked_at')::timestamptz; END IF;
  INSERT INTO consent_audit_events(mother_id,source,event_type,actor_id,subject_type,subject_ref,resource,payload,occurred_at)
  VALUES(owner_id,'sharing_state',kind || CASE WHEN revoked THEN '_revoked' ELSE '_granted' END,
    actor,subject,ref,kind,details || jsonb_build_object('transaction_id',txid_current()::text),at);
  RETURN NEW;
END $$;

DO $$
DECLARE item TEXT;
BEGIN
  FOREACH item IN ARRAY ARRAY['patient_document_shares','clinical_dashboard_consent','timeline_summary_shares','family_access_grants','remote_visits','patient_preferences']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_scoped_sharing ON %I', item);
    EXECUTE format('CREATE TRIGGER audit_scoped_sharing AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION dai_audit_scoped_sharing()', item);
  END LOOP;
END $$;

COMMIT;
