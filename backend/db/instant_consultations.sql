-- Apply after facility_discovery.sql, clinical_dashboard.sql and daicare.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS instant_doctor_availability (
  doctor_id INTEGER PRIMARY KEY REFERENCES doctor_profiles(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('available', 'busy', 'offline')),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS instant_consultations (
  id UUID PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concern VARCHAR(1000) NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('pregnancy', 'medication', 'report', 'general', 'other')),
  language TEXT NOT NULL CHECK (language IN ('en', 'hi', 'mr')),
  emergency_warning BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  status TEXT NOT NULL DEFAULT 'searching'
    CHECK (status IN ('searching', 'offered', 'accepted', 'in_progress', 'completed', 'cancelled', 'unavailable', 'expired')),
  doctor_id INTEGER REFERENCES doctor_profiles(user_id),
  facility_id INTEGER REFERENCES facilities(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  search_until TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  patient_connected_at TIMESTAMPTZ,
  doctor_connected_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS instant_consultations_one_open_patient
  ON instant_consultations (mother_id) WHERE status IN ('searching','offered','accepted','in_progress');
CREATE INDEX IF NOT EXISTS instant_consultations_patient_history
  ON instant_consultations (mother_id, created_at DESC);
CREATE INDEX IF NOT EXISTS instant_consultations_doctor_history
  ON instant_consultations (doctor_id, created_at DESC) WHERE doctor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS instant_consultations_open
  ON instant_consultations (search_until) WHERE status IN ('searching','offered','accepted','in_progress');

CREATE TABLE IF NOT EXISTS instant_consultation_offers (
  consultation_id UUID NOT NULL REFERENCES instant_consultations(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES doctor_profiles(user_id) ON DELETE CASCADE,
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  status TEXT NOT NULL CHECK (status IN ('offered','accepted','declined','timed_out','withdrawn')),
  offered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (consultation_id, doctor_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS instant_consultation_live_offer
  ON instant_consultation_offers (consultation_id) WHERE status IN ('offered','accepted');
CREATE INDEX IF NOT EXISTS instant_consultation_offers_inbox
  ON instant_consultation_offers (doctor_id, expires_at) WHERE status='offered';

CREATE TABLE IF NOT EXISTS instant_consultation_records (
  consultation_id UUID PRIMARY KEY REFERENCES instant_consultations(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES doctor_profiles(user_id),
  reason VARCHAR(1000) NOT NULL,
  observations VARCHAR(4000) NOT NULL,
  guidance VARCHAR(4000) NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('follow_up', 'in_person', 'hospital', 'emergency', 'unable_to_connect')),
  follow_up_on DATE,
  recommended_facility_id INTEGER REFERENCES facilities(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE instant_consultations DROP CONSTRAINT IF EXISTS instant_consultations_language_check;
ALTER TABLE instant_consultations ADD CONSTRAINT instant_consultations_language_check CHECK (language IN ('en','hi','mr'));

COMMIT;
