-- Shared appointment context and explicit report consent. Idempotent upgrade.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS facility_uuid TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS unit_uuid TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS unit_label TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS room TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS visit_type TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS change_reason TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS milestone_id INTEGER REFERENCES care_milestones(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS slot_end TIME;
ALTER TABLE care_milestones ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id);
ALTER TABLE care_milestones ADD COLUMN IF NOT EXISTS result_id INTEGER REFERENCES patient_documents(id);
ALTER TABLE care_milestones ADD COLUMN IF NOT EXISTS completion_verification TEXT;
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS report_date DATE;
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS facility_name TEXT;
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS child_id INTEGER REFERENCES children(id);
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS milestone_id INTEGER REFERENCES care_milestones(id);
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id);
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS doctor_note TEXT;
ALTER TABLE patient_document_shares ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS patient_hospital_outbox (
 appointment_id INTEGER PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 synced_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS patient_record_issues (
 id SERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id),
 document_id INTEGER NOT NULL REFERENCES patient_documents(id),
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE care_milestones ADD COLUMN IF NOT EXISTS verified_facility_name TEXT;
ALTER TABLE patient_document_events DROP CONSTRAINT IF EXISTS patient_document_events_event_type_check;
ALTER TABLE patient_document_events ADD CONSTRAINT patient_document_events_event_type_check CHECK(event_type IN ('upload','download','share','revoke_share','delete','verify','reject','lock','metadata_read','preview','reveal','problem_report'));
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS report_category TEXT;
