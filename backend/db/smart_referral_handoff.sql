-- ============================================================================
-- Smart Referral Handoff — schema
--
-- Enables clinicians to refer patients to hospitals, specialists, labs, or
-- NICU-capable facilities with acceptance/rejection workflow and summary return.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- referrals
-- Main referral record with tracking status
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referrals (
  id              SERIAL PRIMARY KEY,
  referring_doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_type   VARCHAR(30) NOT NULL CHECK (referral_type IN (
    'hospital', 'specialist', 'lab', 'nicu', 'radiology', 'other'
  )),
  priority        VARCHAR(20) NOT NULL DEFAULT 'routine'
                   CHECK (priority IN ('routine', 'urgent', 'emergency')),
  receiving_facility_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  receiving_specialist_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT NOT NULL,
  clinical_summary TEXT,
  diagnosis       VARCHAR(255),
  icd_code        VARCHAR(20),
  urgency_notes   TEXT,
  patient_instructions TEXT,
  required_documents TEXT[], -- List of required document types
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'accepted', 'rejected', 'completed', 'cancelled')),
  decision_notes  TEXT,
  decision_by     INTEGER REFERENCES users(id),
  decision_at     TIMESTAMP,
  appointment_scheduled BOOLEAN NOT NULL DEFAULT false,
  appointment_date TIMESTAMP,
  summary_returned BOOLEAN NOT NULL DEFAULT false,
  summary_returned_at TIMESTAMP,
  summary_content TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referrals_referring_doctor
  ON referrals (referring_doctor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referrals_patient
  ON referrals (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referrals_receiving_facility
  ON referrals (receiving_facility_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referrals_status
  ON referrals (status, priority, created_at DESC);

-- ----------------------------------------------------------------------------
-- referral_documents
-- Documents attached to referrals
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_documents (
  id              SERIAL PRIMARY KEY,
  referral_id     INTEGER NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  document_id     INTEGER REFERENCES patient_documents(id) ON DELETE SET NULL,
  document_type   VARCHAR(50) NOT NULL,
  file_name       VARCHAR(255),
  file_url        VARCHAR(500),
  uploaded_by     INTEGER REFERENCES users(id),
  uploaded_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referral_documents_referral
  ON referral_documents (referral_id, document_type);

-- ----------------------------------------------------------------------------
-- referral_communications
-- Communication log for referrals (messages, status updates)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_communications (
  id              SERIAL PRIMARY KEY,
  referral_id     INTEGER NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  from_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message_type    VARCHAR(30) NOT NULL CHECK (message_type IN (
    'note', 'status_update', 'question', 'answer', 'attachment', 'system'
  )),
  message         TEXT NOT NULL,
  metadata        JSONB,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  read_at         TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referral_communications_referral
  ON referral_communications (referral_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_communications_unread
  ON referral_communications (to_user_id, is_read, created_at DESC)
  WHERE is_read = false;

-- ----------------------------------------------------------------------------
-- smart_referral_permissions
-- Defines who can view/act on specific referrals
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smart_referral_permissions (
  id              SERIAL PRIMARY KEY,
  referral_id     INTEGER NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_level VARCHAR(20) NOT NULL CHECK (permission_level IN (
    'view', 'respond', 'full_access'
  )),
  granted_by      INTEGER REFERENCES users(id),
  granted_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(referral_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_smart_referral_permissions_referral
  ON smart_referral_permissions (referral_id, permission_level);

CREATE INDEX IF NOT EXISTS idx_smart_referral_permissions_user
  ON smart_referral_permissions (user_id, referral_id);

-- ----------------------------------------------------------------------------
-- Update triggers for updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_referral_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_referrals_updated_at ON referrals;
CREATE TRIGGER trg_referrals_updated_at
  BEFORE UPDATE ON referrals
  FOR EACH ROW
  EXECUTE FUNCTION update_referral_updated_at();

COMMIT;
