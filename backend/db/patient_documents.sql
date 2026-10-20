-- ============================================================================
-- Patient documents — upload, verification, sharing, history
--
-- Apply AFTER auth_and_wellness.sql (users table). Idempotent.
--
--   psql "$DATABASE_URL" -f backend/db/patient_documents.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS patient_documents (
  id                SERIAL PRIMARY KEY,
  mother_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             VARCHAR(200) NOT NULL,
  doc_type          VARCHAR(40) NOT NULL
                      CHECK (doc_type IN (
                        'medical_report',
                        'prescription',
                        'lab_report',
                        'discharge_summary',
                        'scan_imaging',
                        'other'
                      )),
  original_filename VARCHAR(255) NOT NULL,
  mime_type         VARCHAR(120) NOT NULL,
  size_bytes        INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  storage_key       VARCHAR(120) NOT NULL UNIQUE,
  verification_status VARCHAR(30) NOT NULL DEFAULT 'pending'
                      CHECK (verification_status IN (
                        'pending', 'verified', 'rejected', 'locked'
                      )),
  notes             TEXT,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_patient_documents_mother
  ON patient_documents (mother_id, uploaded_at DESC)
  WHERE deleted_at IS NULL;

-- Shares with authorised providers (doctors linked via appointments or explicit share)
CREATE TABLE IF NOT EXISTS patient_document_shares (
  id           SERIAL PRIMARY KEY,
  document_id  INTEGER NOT NULL REFERENCES patient_documents(id) ON DELETE CASCADE,
  doctor_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  UNIQUE (document_id, doctor_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_document_shares_doctor
  ON patient_document_shares (doctor_id)
  WHERE revoked_at IS NULL;

-- Immutable event log (upload, download, share, revoke, delete, verify)
CREATE TABLE IF NOT EXISTS patient_document_events (
  id           SERIAL PRIMARY KEY,
  document_id  INTEGER NOT NULL REFERENCES patient_documents(id) ON DELETE CASCADE,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type   VARCHAR(40) NOT NULL
                 CHECK (event_type IN (
                   'upload', 'download', 'share', 'revoke_share',
                   'delete', 'verify', 'reject', 'lock'
                 )),
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_document_events_doc
  ON patient_document_events (document_id, created_at DESC);

COMMIT;
