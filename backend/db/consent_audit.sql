-- ============================================================================
-- Tamper-evident consent & access audit log.
--
-- Every patient consent change, revocation and medical-record access already
-- flows through a small set of tables (patient_access_controls,
-- patient_access_events, patient_record_access_log, patient_document_events,
-- family_access_events). Triggers below copy each write into
-- consent_audit_events, an append-only table. Node code (consentAudit.js)
-- seals events into a per-mother HMAC-SHA256 hash chain and issues Ed25519
-- signed receipts. UPDATE/DELETE on the audit tables is rejected, and any
-- edit that gets past that is detected when the chain is re-verified.
--
-- Apply AFTER patient_access_controls.sql, patient_experience.sql,
-- patient_documents.sql and connected_care.sql. Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS consent_audit_events (
  id           BIGSERIAL PRIMARY KEY,
  mother_id    INTEGER NOT NULL,
  source       VARCHAR(30) NOT NULL,          -- record_access_log | access_event | consent_control | document_event | family_event
  event_type   VARCHAR(60) NOT NULL,          -- record_access | access_denied | access_revoked | consent_revoked | document_share | ...
  actor_id     INTEGER,                       -- who did it (clinician / family member / the mother)
  subject_type VARCHAR(30),                   -- doctor | facility | document | family_grant | ...
  subject_ref  VARCHAR(120),
  resource     VARCHAR(60),
  allowed      BOOLEAN,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  TIMESTAMPTZ NOT NULL,          -- source row timestamp (database clock)
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS consent_audit_events_owner ON consent_audit_events(mother_id, id);

CREATE TABLE IF NOT EXISTS consent_audit_heads (
  mother_id  INTEGER PRIMARY KEY,
  sequence   BIGINT NOT NULL DEFAULT 0,
  head_hash  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS consent_audit_seals (
  event_id      BIGINT PRIMARY KEY REFERENCES consent_audit_events(id),
  mother_id     INTEGER NOT NULL,
  sequence      BIGINT NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash    TEXT NOT NULL,
  sealed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mother_id, sequence)
);

-- Digitally signed, downloadable receipts. One receipt per audit event.
CREATE TABLE IF NOT EXISTS consent_receipts (
  id             BIGSERIAL PRIMARY KEY,
  mother_id      INTEGER NOT NULL,
  audit_event_id BIGINT NOT NULL UNIQUE REFERENCES consent_audit_events(id),
  receipt_type   VARCHAR(40) NOT NULL,
  payload        JSONB NOT NULL,              -- exact bytes covered by the signature (canonical JSON)
  signature      TEXT NOT NULL,               -- Ed25519, base64
  key_id         VARCHAR(80) NOT NULL,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS consent_receipts_owner ON consent_receipts(mother_id, id);

CREATE OR REPLACE FUNCTION dai_immutable_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Consent audit history is append-only'; END $$;

DROP TRIGGER IF EXISTS immutable_audit_events ON consent_audit_events;
CREATE TRIGGER immutable_audit_events BEFORE UPDATE OR DELETE ON consent_audit_events
  FOR EACH ROW EXECUTE FUNCTION dai_immutable_audit();
DROP TRIGGER IF EXISTS immutable_audit_seals ON consent_audit_seals;
CREATE TRIGGER immutable_audit_seals BEFORE UPDATE OR DELETE ON consent_audit_seals
  FOR EACH ROW EXECUTE FUNCTION dai_immutable_audit();
DROP TRIGGER IF EXISTS immutable_audit_receipts ON consent_receipts;
CREATE TRIGGER immutable_audit_receipts BEFORE UPDATE OR DELETE ON consent_receipts
  FOR EACH ROW EXECUTE FUNCTION dai_immutable_audit();
DROP TRIGGER IF EXISTS immutable_audit_heads ON consent_audit_heads;
CREATE TRIGGER immutable_audit_heads BEFORE DELETE ON consent_audit_heads
  FOR EACH ROW EXECUTE FUNCTION dai_immutable_audit();

-- Serialise audit inserts per mother on the chain-head row. The lock is held
-- until the writer's transaction ends, so event id order matches commit order
-- and a verifier that takes the same lock never sees a sealed chain that a
-- still-uncommitted lower-id event could later contradict.
CREATE OR REPLACE FUNCTION dai_audit_head_lock(p_mother INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO consent_audit_heads(mother_id) VALUES(p_mother) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM consent_audit_heads WHERE mother_id = p_mother FOR UPDATE;
END $$;

-- Record views and blocked attempts through DAI clinician screens.
CREATE OR REPLACE FUNCTION dai_audit_access_log() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM dai_audit_head_lock(NEW.mother_id);
  INSERT INTO consent_audit_events(mother_id,source,event_type,actor_id,resource,allowed,occurred_at,payload)
  VALUES(NEW.mother_id,'record_access_log',
         CASE WHEN NEW.allowed THEN 'record_access' ELSE 'access_denied' END,
         NEW.doctor_id,NEW.resource,NEW.allowed,NEW.created_at,
         jsonb_build_object('resource',NEW.resource,'allowed',NEW.allowed));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_access_log ON patient_record_access_log;
CREATE TRIGGER audit_access_log AFTER INSERT ON patient_record_access_log
  FOR EACH ROW EXECUTE FUNCTION dai_audit_access_log();

-- Consent choices and other patient_access_events writes (dashboard consent,
-- remote-visit consent, sharing history, self views, exports, ...).
CREATE OR REPLACE FUNCTION dai_audit_access_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_actor INTEGER;
BEGIN
  PERFORM dai_audit_head_lock(NEW.mother_id);
  v_actor := CASE WHEN NEW.details->>'doctor_id' ~ '^-?[0-9]+$' THEN (NEW.details->>'doctor_id')::int
                  WHEN NEW.details->>'actor_id' ~ '^-?[0-9]+$' THEN (NEW.details->>'actor_id')::int END;
  INSERT INTO consent_audit_events(mother_id,source,event_type,actor_id,subject_type,subject_ref,payload,occurred_at)
  VALUES(NEW.mother_id,'access_event',NEW.event_type,v_actor,
         CASE WHEN v_actor IS NOT NULL THEN 'user' END, NULLIF(COALESCE(NEW.details->>'doctor_id',NEW.details->>'actor_id'),''),
         NEW.details,NEW.created_at);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_access_event ON patient_access_events;
CREATE TRIGGER audit_access_event AFTER INSERT ON patient_access_events
  FOR EACH ROW EXECUTE FUNCTION dai_audit_access_event();

-- The consent state itself: every grant/revoke of a doctor or facility,
-- including mass revocations from account closure.
CREATE OR REPLACE FUNCTION dai_audit_access_control() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_state VARCHAR(10); v_reason VARCHAR(300); v_prev VARCHAR(10); v_ref VARCHAR(80); v_type VARCHAR(10); v_at TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_state := 'revoked'; v_reason := 'control row deleted'; v_prev := OLD.state;
    v_ref := OLD.grantee_ref; v_type := OLD.grantee_type; v_at := NOW();
    PERFORM dai_audit_head_lock(OLD.mother_id);
    INSERT INTO consent_audit_events(mother_id,source,event_type,subject_type,subject_ref,occurred_at,payload)
    VALUES(OLD.mother_id,'consent_control','consent_revoked',v_type,v_ref,v_at,
           jsonb_build_object('state','revoked','reason',v_reason,'previous_state',v_prev,'grantee_type',v_type,'grantee_ref',v_ref));
    RETURN OLD;
  END IF;
  v_state := NEW.state; v_reason := NEW.reason; v_prev := CASE WHEN TG_OP = 'UPDATE' THEN OLD.state END;
  v_ref := NEW.grantee_ref; v_type := NEW.grantee_type; v_at := NEW.updated_at;
  PERFORM dai_audit_head_lock(NEW.mother_id);
  INSERT INTO consent_audit_events(mother_id,source,event_type,subject_type,subject_ref,occurred_at,payload)
  VALUES(NEW.mother_id,'consent_control','consent_' || v_state,v_type,v_ref,v_at,
         jsonb_build_object('state',v_state,'reason',v_reason,'previous_state',v_prev,
                            'grantee_type',v_type,'grantee_ref',v_ref,'updated_at',v_at));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_access_control ON patient_access_controls;
CREATE TRIGGER audit_access_control AFTER INSERT OR UPDATE OR DELETE ON patient_access_controls
  FOR EACH ROW EXECUTE FUNCTION dai_audit_access_control();

-- Document lifecycle: uploads, downloads, shares and share revocations are
-- record accesses / consent changes. patient_document_events has no mother_id;
-- resolve it through the document row.
CREATE OR REPLACE FUNCTION dai_audit_document_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_mother INTEGER;
BEGIN
  SELECT mother_id INTO v_mother FROM patient_documents WHERE id = NEW.document_id;
  IF v_mother IS NULL THEN RETURN NEW; END IF;
  PERFORM dai_audit_head_lock(v_mother);
  INSERT INTO consent_audit_events(mother_id,source,event_type,actor_id,subject_type,subject_ref,resource,occurred_at,payload)
  VALUES(v_mother,'document_event','document_' || NEW.event_type,NEW.actor_id,'document',NEW.document_id::text,'document',NEW.created_at,
         jsonb_build_object('document_id',NEW.document_id,'document_event',NEW.event_type,'detail',NEW.detail));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_document_event ON patient_document_events;
CREATE TRIGGER audit_document_event AFTER INSERT ON patient_document_events
  FOR EACH ROW EXECUTE FUNCTION dai_audit_document_event();

-- Family/caregiver sharing grants: invite, accept, read and revoke.
CREATE OR REPLACE FUNCTION dai_audit_family_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM dai_audit_head_lock(NEW.mother_id);
  INSERT INTO consent_audit_events(mother_id,source,event_type,actor_id,subject_type,subject_ref,occurred_at,payload)
  VALUES(NEW.mother_id,'family_event','family_' || NEW.action,NEW.actor_id,'family_grant',NEW.grant_id::text,NEW.created_at,
         jsonb_build_object('grant_id',NEW.grant_id,'action',NEW.action));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_family_event ON family_access_events;
CREATE TRIGGER audit_family_event AFTER INSERT ON family_access_events
  FOR EACH ROW EXECUTE FUNCTION dai_audit_family_event();

-- Scoped record access granted to another user (view/edit rights on
-- pregnancy, postpartum or child records). INSERT grants, DELETE revokes.
CREATE OR REPLACE FUNCTION dai_audit_continuity_access() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_mother INTEGER; v_type TEXT; v_ref TEXT; v_actor INTEGER; v_at TIMESTAMPTZ; v_payload JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_mother := OLD.mother_id; v_type := 'continuity_access_revoked';
    v_ref := OLD.granted_to_user_id::text; v_actor := OLD.granted_by; v_at := NOW();
    v_payload := jsonb_build_object('granted_to_user_id',OLD.granted_to_user_id,'access_type',OLD.access_type,'child_id',OLD.child_id,'purpose',OLD.purpose);
  ELSE
    v_mother := NEW.mother_id; v_type := 'continuity_access_granted';
    v_ref := NEW.granted_to_user_id::text; v_actor := NEW.granted_by; v_at := NEW.granted_at;
    v_payload := jsonb_build_object('granted_to_user_id',NEW.granted_to_user_id,'access_type',NEW.access_type,'child_id',NEW.child_id,'granted_by',NEW.granted_by,'expires_at',NEW.expires_at,'purpose',NEW.purpose);
  END IF;
  PERFORM dai_audit_head_lock(v_mother);
  INSERT INTO consent_audit_events(mother_id,source,event_type,actor_id,subject_type,subject_ref,occurred_at,payload)
  VALUES(v_mother,'consent_control',v_type,v_actor,'continuity_grantee',v_ref,v_at,v_payload);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_continuity_access ON continuity_access;
CREATE TRIGGER audit_continuity_access AFTER INSERT OR DELETE ON continuity_access
  FOR EACH ROW EXECUTE FUNCTION dai_audit_continuity_access();

-- Hospital-stay record views by the mother or a permitted caregiver.
CREATE OR REPLACE FUNCTION dai_audit_stay_access() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM dai_audit_head_lock(NEW.mother_id);
  INSERT INTO consent_audit_events(mother_id,source,event_type,subject_type,resource,occurred_at,payload)
  VALUES(NEW.mother_id,'access_event','stay_record_access','stay',NEW.action,NEW.created_at,
         jsonb_build_object('action',NEW.action));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_stay_access ON patient_stay_access_log;
CREATE TRIGGER audit_stay_access AFTER INSERT ON patient_stay_access_log
  FOR EACH ROW EXECUTE FUNCTION dai_audit_stay_access();

COMMIT;
