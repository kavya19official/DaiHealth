-- Reproducible, clinician-approved prototype calculations. Originals remain append-only.
CREATE TABLE IF NOT EXISTS clinical_tool_results (
 id UUID PRIMARY KEY, mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 calculator_id TEXT NOT NULL, calculator_version TEXT NOT NULL,
 inputs JSONB NOT NULL, result JSONB NOT NULL, provenance JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS clinical_tool_results_patient ON clinical_tool_results(mother_id,doctor_id,created_at DESC);

ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
