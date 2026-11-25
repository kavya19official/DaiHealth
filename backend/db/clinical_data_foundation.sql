BEGIN;

ALTER TABLE mother_profiles
  ADD COLUMN IF NOT EXISTS obstetric_history TEXT,
  ADD COLUMN IF NOT EXISTS data_label VARCHAR(120);

ALTER TABLE doctor_profiles
  ADD COLUMN IF NOT EXISTS qualifications TEXT,
  ADD COLUMN IF NOT EXISTS availability_status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available', 'in_consultation', 'off_duty')),
  ADD COLUMN IF NOT EXISTS next_available_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_label VARCHAR(120);

ALTER TABLE clinical_dashboard_entries
  ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_record_id VARCHAR(160),
  ADD COLUMN IF NOT EXISTS measurement_status VARCHAR(30) NOT NULL DEFAULT 'recorded'
    CHECK (measurement_status IN ('recorded', 'not_recorded', 'not_applicable', 'pending_review')),
  ADD COLUMN IF NOT EXISTS record_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS clinical_entries_record_key
  ON clinical_dashboard_entries(record_key) WHERE record_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS clinical_entries_appointment
  ON clinical_dashboard_entries(appointment_id, recorded_on);

CREATE TABLE IF NOT EXISTS anc_visits (
  id SERIAL PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  visit_date DATE NOT NULL,
  gestational_week INTEGER NOT NULL CHECK (gestational_week BETWEEN 0 AND 45),
  status VARCHAR(20) NOT NULL CHECK (status IN ('scheduled', 'completed', 'missed', 'cancelled')),
  visit_type VARCHAR(60) NOT NULL DEFAULT 'ANC',
  notes TEXT,
  follow_up_date DATE,
  source_record_id VARCHAR(160) NOT NULL,
  record_key VARCHAR(160) NOT NULL UNIQUE,
  data_label VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(appointment_id)
);
CREATE INDEX IF NOT EXISTS anc_visits_mother_date
  ON anc_visits(mother_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS anc_visits_doctor_date
  ON anc_visits(doctor_id, visit_date DESC);

CREATE TABLE IF NOT EXISTS clinical_investigations (
  id SERIAL PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  panel_code VARCHAR(60) NOT NULL,
  test_code VARCHAR(60) NOT NULL,
  test_name VARCHAR(160) NOT NULL,
  value_numeric NUMERIC(12,4),
  value_text VARCHAR(255),
  unit VARCHAR(40),
  reference_low NUMERIC(12,4),
  reference_high NUMERIC(12,4),
  reference_text VARCHAR(255),
  specimen_context VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'awaiting_result', 'not_recorded', 'not_applicable', 'pending_review')),
  review_status VARCHAR(30) NOT NULL DEFAULT 'pending_clinician_review'
    CHECK (review_status IN ('pending_clinician_review', 'reviewed', 'not_required')),
  collected_on DATE,
  resulted_on DATE,
  source_type VARCHAR(60) NOT NULL,
  source_record_id VARCHAR(160) NOT NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  record_key VARCHAR(160) NOT NULL UNIQUE,
  data_label VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'recorded' AND (value_numeric IS NOT NULL OR value_text IS NOT NULL) AND resulted_on IS NOT NULL)
    OR (status = 'pending_review' AND (value_numeric IS NOT NULL OR value_text IS NOT NULL) AND resulted_on IS NOT NULL)
    OR status IN ('awaiting_result', 'not_recorded', 'not_applicable')
  )
);
CREATE INDEX IF NOT EXISTS clinical_investigations_mother_date
  ON clinical_investigations(mother_id, COALESCE(resulted_on, collected_on) DESC);
CREATE INDEX IF NOT EXISTS clinical_investigations_panel
  ON clinical_investigations(mother_id, panel_code, test_code);
CREATE INDEX IF NOT EXISTS clinical_investigations_review
  ON clinical_investigations(mother_id, status, review_status);

COMMIT;
