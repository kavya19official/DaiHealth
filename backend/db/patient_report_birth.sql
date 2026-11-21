BEGIN;
CREATE TABLE IF NOT EXISTS patient_report_entries (
 id UUID PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES patient_documents(id) ON DELETE CASCADE,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 report_date DATE NOT NULL, observations JSONB NOT NULL, source_sha256 TEXT NOT NULL,
 confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(document_id,source_sha256,report_date)
);
CREATE INDEX IF NOT EXISTS patient_report_entries_owner ON patient_report_entries(mother_id,report_date DESC);
CREATE TABLE IF NOT EXISTS patient_birth_plans (
 mother_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
 version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
