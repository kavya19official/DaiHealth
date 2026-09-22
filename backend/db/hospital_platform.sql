-- DAI hospital platform persistence schema
-- Apply after auth_and_wellness.sql.
BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('mother','doctor','care_team','front_desk','admin','caregiver'));

CREATE TABLE IF NOT EXISTS hospital_patients (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  date_of_birth DATE,
  primary_provider_id INTEGER REFERENCES users(id),
  consent_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS care_pathways (
  id BIGSERIAL PRIMARY KEY,
  program TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pathway_events (
  id BIGSERIAL PRIMARY KEY,
  pathway_id BIGINT NOT NULL REFERENCES care_pathways(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  event_type TEXT NOT NULL,
  expected_offset_days INTEGER NOT NULL,
  required_documents JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS hospital_care_events (
  id BIGSERIAL PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES hospital_patients(id) ON DELETE CASCADE,
  pathway_event_id BIGINT REFERENCES pathway_events(id),
  event_type TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  document_ref TEXT
);
CREATE TABLE IF NOT EXISTS care_gaps (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES hospital_patients(id) ON DELETE CASCADE,
  pathway_event_id BIGINT REFERENCES pathway_events(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','resolved')),
  due_date DATE NOT NULL,
  operational_priority INTEGER NOT NULL DEFAULT 0,
  assigned_to INTEGER REFERENCES users(id),
  resolution_notes TEXT,
  evidence_ref TEXT,
  resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS gap_contacts (
  id BIGSERIAL PRIMARY KEY,
  gap_id TEXT NOT NULL REFERENCES care_gaps(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  outcome TEXT NOT NULL,
  notes TEXT,
  contacted_by INTEGER REFERENCES users(id),
  contacted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hospital_documents (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES hospital_patients(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_ref TEXT,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  extraction_metadata JSONB NOT NULL DEFAULT '{"reviewRequired":true,"clinicalInterpretation":false}'::jsonb,
  extraction_status TEXT NOT NULL DEFAULT 'pending_review',
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE hospital_documents ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE hospital_documents ADD COLUMN IF NOT EXISTS size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hospital_documents ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE hospital_documents ADD COLUMN IF NOT EXISTS extraction_metadata JSONB NOT NULL DEFAULT '{"reviewRequired":true,"clinicalInterpretation":false}'::jsonb;
CREATE TABLE IF NOT EXISTS consultation_briefs (
  id BIGSERIAL PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES hospital_patients(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (appointment_id)
);
CREATE TABLE IF NOT EXISTS brief_facts (
  id BIGSERIAL PRIMARY KEY,
  brief_id BIGINT NOT NULL REFERENCES consultation_briefs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  confidence TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  review_notes TEXT
);
CREATE TABLE IF NOT EXISTS hospital_appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES hospital_patients(id),
  provider_id INTEGER REFERENCES users(id),
  slot TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  checkin_time TIMESTAMPTZ,
  wait_minutes INTEGER NOT NULL DEFAULT 0,
  manual_urgency TEXT,
  urgency_set_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS content_drafts (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES hospital_patients(id),
  content_type TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'English',
  body TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS hospital_knowledge_base (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'English',
  source_ref TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','retired')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS education_campaigns (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES content_drafts(id),
  title TEXT NOT NULL,
  audience TEXT NOT NULL,
  channel TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','cancelled')),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hospital_notifications (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES hospital_patients(id),
  channel TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','read')),
  entity_id TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS facility_cases (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES hospital_patients(id),
  priority_source TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id),
  readiness JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sos_requests (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES hospital_patients(id),
  location JSONB,
  consent_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'awaiting_verification',
  verified_by INTEGER REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  responded_by INTEGER REFERENCES users(id),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hospital_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  actor_label TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hospital_audit_entity ON hospital_audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_care_gaps_registry ON care_gaps(status, due_date, assigned_to);
CREATE INDEX IF NOT EXISTS idx_hospital_appointments_slot ON hospital_appointments(slot, status);
CREATE INDEX IF NOT EXISTS idx_hospital_notifications_patient ON hospital_notifications(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_education_campaigns_schedule ON education_campaigns(scheduled_for, status);

-- The audit trail is append-only. Corrections are represented by a new audit row.
CREATE OR REPLACE FUNCTION prevent_hospital_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'hospital_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hospital_audit_log_append_only ON hospital_audit_log;
CREATE TRIGGER hospital_audit_log_append_only
BEFORE UPDATE OR DELETE ON hospital_audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_hospital_audit_mutation();

COMMIT;
