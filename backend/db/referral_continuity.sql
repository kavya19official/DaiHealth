-- ============================================================================
-- Smart Referral Handoff & Mother-Newborn Continuity
--
-- This migration adds:
-- - Enhanced referral system with doctor-initiated referrals
-- - Referral outcomes and communication tracking
-- - Mother-child consent and linkage for continuity of care
-- - Permission-based access to linked records
--
-- Apply with:
--   psql "$DATABASE_URL" -f backend/db/referral_continuity.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Enhanced Referral System
-- Extend facility_referrals to support doctor-initiated referrals
-- ----------------------------------------------------------------------------
ALTER TABLE facility_referrals
  ADD COLUMN IF NOT EXISTS initiated_by VARCHAR(20) CHECK (initiated_by IN ('mother', 'doctor', 'facility'))
    DEFAULT 'mother',
  ADD COLUMN IF NOT EXISTS initiating_doctor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS initiating_facility_id INTEGER REFERENCES facilities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS medical_summary TEXT,
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) CHECK (priority IN ('routine', 'urgent', 'emergency', 'critical'))
    DEFAULT 'routine',
  ADD COLUMN IF NOT EXISTS estimated_arrival TIMESTAMP,
  ADD COLUMN IF NOT EXISTS patient_condition VARCHAR(50) CHECK (patient_condition IN ('stable', 'observation', 'critical', 'unknown'))
    DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS special_requirements TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Receiving facility staff
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_referrals_initiating_doctor ON facility_referrals(initiating_doctor_id);
CREATE INDEX IF NOT EXISTS idx_referrals_initiating_facility ON facility_referrals(initiating_facility_id);
CREATE INDEX IF NOT EXISTS idx_referrals_assigned_to ON facility_referrals(assigned_to);
CREATE INDEX IF NOT EXISTS idx_referrals_priority ON facility_referrals(priority);

-- ----------------------------------------------------------------------------
-- Referral Outcomes
-- Track the outcome of referrals for care continuity
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_outcomes (
  id SERIAL PRIMARY KEY,
  referral_id INTEGER NOT NULL REFERENCES facility_referrals(id) ON DELETE CASCADE,
  outcome_type VARCHAR(50) NOT NULL CHECK (outcome_type IN (
    'accepted', 'rejected', 'transferred', 'admitted', 'treated',
    'referred_elsewhere', 'patient_declined', 'facility_unavailable'
  )),
  outcome_details TEXT,
  outcome_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  follow_up_required BOOLEAN DEFAULT FALSE,
  follow_up_date DATE,
  follow_up_notes TEXT,
  attachments JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_referral_outcomes_referral ON referral_outcomes(referral_id);
CREATE INDEX IF NOT EXISTS idx_referral_outcomes_type ON referral_outcomes(outcome_type);

-- ----------------------------------------------------------------------------
-- Referral Messages
-- Communication between facilities about a referral
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_messages (
  id SERIAL PRIMARY KEY,
  referral_id INTEGER NOT NULL REFERENCES facility_referrals(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role VARCHAR(20) NOT NULL CHECK (sender_role IN ('mother', 'doctor', 'facility_staff')),
  recipient_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient_role VARCHAR(20) CHECK (recipient_role IN ('mother', 'doctor', 'facility_staff')),
  message TEXT NOT NULL,
  message_type VARCHAR(20) CHECK (message_type IN ('update', 'question', 'answer', 'alert', 'handoff'))
    DEFAULT 'update',
  is_internal BOOLEAN DEFAULT FALSE, -- Internal facility communication vs patient-facing
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referral_messages_referral ON referral_messages(referral_id);
CREATE INDEX IF NOT EXISTS idx_referral_messages_sender ON referral_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_referral_messages_recipient ON referral_messages(recipient_id);

-- ----------------------------------------------------------------------------
-- Mother-Child Consent
-- Explicit consent for linking mother and child records
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mother_child_consent (
  id SERIAL PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  consent_type VARCHAR(50) NOT NULL CHECK (consent_type IN (
    'record_linkage', 'care_continuity', 'data_sharing', 'appointment_booking',
    'emergency_access', 'full_continuity'
  )),
  consent_given BOOLEAN NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consented_by INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Who gave consent (mother or guardian)
  relationship VARCHAR(50) CHECK (relationship IN ('mother', 'father', 'guardian', 'relative')),
  expires_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE(mother_id, child_id, consent_type)
);

CREATE INDEX IF NOT EXISTS idx_mother_child_consent_mother ON mother_child_consent(mother_id);
CREATE INDEX IF NOT EXISTS idx_mother_child_consent_child ON mother_child_consent(child_id);
CREATE INDEX IF NOT EXISTS idx_mother_child_consent_type ON mother_child_consent(consent_type);

-- ----------------------------------------------------------------------------
-- Mother-Child Linkage
-- Verified relationship between mother and child for continuity of care
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mother_child_linkage (
  id SERIAL PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  relationship_type VARCHAR(50) NOT NULL CHECK (relationship_type IN (
    'biological', 'adoptive', 'foster', 'guardian', 'other'
  )),
  verification_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (verification_status IN (
    'pending', 'verified', 'rejected', 'expired'
  )),
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  verification_method VARCHAR(50) CHECK (verification_method IN (
    'birth_certificate', 'hospital_record', 'self_declaration', 'court_order'
  )),
  verification_document TEXT, -- Reference to document
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_until DATE,
  is_primary BOOLEAN DEFAULT FALSE, -- Primary relationship if multiple
  notes TEXT,
  UNIQUE(mother_id, child_id)
);

CREATE INDEX IF NOT EXISTS idx_mother_child_linkage_mother ON mother_child_linkage(mother_id);
CREATE INDEX IF NOT EXISTS idx_mother_child_linkage_child ON mother_child_linkage(child_id);
CREATE INDEX IF NOT EXISTS idx_mother_child_linkage_status ON mother_child_linkage(verification_status);

-- ----------------------------------------------------------------------------
-- Continuity Timeline
-- Unified timeline showing linked mother-child care events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS continuity_timeline (
  id SERIAL PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id INTEGER REFERENCES children(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
    'pregnancy_start', 'antenatal_visit', 'delivery', 'postpartum_visit',
    'child_birth', 'child_vaccination', 'child_checkup', 'child_growth_record',
    'referral', 'admission', 'discharge', 'emergency', 'lab_result'
  )),
  event_date DATE NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  facility_id INTEGER REFERENCES facilities(id) ON DELETE SET NULL,
  doctor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  description TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  linked_to_ids JSONB DEFAULT '[]'::jsonb, -- IDs of related events
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_continuity_mother ON continuity_timeline(mother_id);
CREATE INDEX IF NOT EXISTS idx_continuity_child ON continuity_timeline(child_id);
CREATE INDEX IF NOT EXISTS idx_continuity_date ON continuity_timeline(event_date);
CREATE INDEX IF NOT EXISTS idx_continuity_type ON continuity_timeline(event_type);

-- ----------------------------------------------------------------------------
-- Referral Permissions
-- Control who can view and manage referrals
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_permissions (
  id SERIAL PRIMARY KEY,
  referral_id INTEGER NOT NULL REFERENCES facility_referrals(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_type VARCHAR(20) NOT NULL CHECK (permission_type IN (
    'view', 'edit', 'accept', 'reject', 'complete', 'message'
  )),
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  UNIQUE(referral_id, user_id, permission_type)
);

CREATE INDEX IF NOT EXISTS idx_referral_permissions_referral ON referral_permissions(referral_id);
CREATE INDEX IF NOT EXISTS idx_referral_permissions_user ON referral_permissions(user_id);

-- ----------------------------------------------------------------------------
-- Continuity Access Permissions
-- Control who can view linked mother-child records
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS continuity_access (
  id SERIAL PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id INTEGER REFERENCES children(id) ON DELETE SET NULL,
  granted_to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_type VARCHAR(20) NOT NULL CHECK (access_type IN (
    'view_pregnancy', 'view_postpartum', 'view_child', 'view_all',
    'edit_records', 'book_appointments', 'send_messages'
  )),
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  purpose TEXT,
  UNIQUE(mother_id, child_id, granted_to_user_id, access_type)
);

CREATE INDEX IF NOT EXISTS idx_continuity_access_mother ON continuity_access(mother_id);
CREATE INDEX IF NOT EXISTS idx_continuity_access_child ON continuity_access(child_id);
CREATE INDEX IF NOT EXISTS idx_continuity_access_user ON continuity_access(granted_to_user_id);

COMMIT;
