BEGIN;

CREATE TABLE IF NOT EXISTS care_scan_sources (
  document_id INTEGER PRIMARY KEY REFERENCES patient_documents(id) ON DELETE CASCADE,
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS care_scan_source_hash_idx ON care_scan_sources(source_sha256);

CREATE TABLE IF NOT EXISTS care_scan_entries (
  id BIGSERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES care_scan_sources(document_id) ON DELETE CASCADE,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id INTEGER REFERENCES children(id) ON DELETE CASCADE,
  occurred_on DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('medicine','vaccination','lab_result','antenatal_visit','other')),
  label VARCHAR(160) NOT NULL CHECK (length(trim(label)) > 0),
  dosage VARCHAR(120),
  result VARCHAR(160),
  unit VARCHAR(40),
  notes VARCHAR(300),
  fingerprint TEXT NOT NULL,
  patient_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind <> 'lab_result' OR length(trim(COALESCE(result,''))) > 0)
);
CREATE INDEX IF NOT EXISTS care_scan_timeline_idx ON care_scan_entries(mother_id, occurred_on, id);
CREATE INDEX IF NOT EXISTS care_scan_duplicate_idx ON care_scan_entries(mother_id, child_id, fingerprint);

COMMIT;
