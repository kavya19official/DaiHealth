-- Reports a connected clinician adds to a patient's record (patient sees them in Reports & records).
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id);
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS uploaded_by_role TEXT NOT NULL DEFAULT 'mother';
ALTER TABLE patient_documents DROP CONSTRAINT IF EXISTS patient_documents_uploaded_by_role_check;
ALTER TABLE patient_documents ADD CONSTRAINT patient_documents_uploaded_by_role_check CHECK (uploaded_by_role IN ('mother','doctor'));
CREATE INDEX IF NOT EXISTS idx_patient_documents_clinician_upload ON patient_documents (uploaded_by) WHERE uploaded_by_role = 'doctor';
