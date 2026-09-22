-- ============================================================================
-- Child dashboard — schema
--
-- Until now a child existed only as a single shared "growth widget" on the
-- mother's account: no name, no date of birth, no photo, and nothing that could
-- tell one child from another (or a 2-week-old from a 2-year-old). This adds
-- a real child entity and the per-child records that hang off it:
--
--   children              one row per child (name, DOB, sex, birth details, ...)
--   child_photos          the profile picture, kept apart so list queries stay small
--   child_vaccinations    which doses of the schedule (shared/child-reference.js) were given, and when
--   child_growth_logs     weight / height / head circumference, per child
--   child_milestones      developmental milestones the mother has ticked off
--
-- The old shared `growth_logs` table is left exactly as it is (the "Baby
-- development" growth widget keeps working). A mother can copy those old
-- measurements onto a child from the Child dashboard.
--
-- Apply AFTER auth_and_wellness.sql, care_timeline_and_appointments.sql and
-- mother_dashboard.sql. Every statement is idempotent, so it is safe to re-run:
--
--   psql "$DATABASE_URL" -f backend/db/child_dashboard.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS children (
  id                SERIAL PRIMARY KEY,
  mother_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(120) NOT NULL,
  date_of_birth     DATE NOT NULL,
  sex               VARCHAR(10) NOT NULL CHECK (sex IN ('female', 'male', 'other')),
  -- Weeks of pregnancy at birth. Used to plot babies born before 37 weeks on
  -- CORRECTED age. NULL = not recorded (treated as full term).
  born_at_weeks     SMALLINT CHECK (born_at_weeks BETWEEN 22 AND 44),
  birth_weight_kg   NUMERIC(4,2) CHECK (birth_weight_kg BETWEEN 0.4 AND 7),
  birth_length_cm   NUMERIC(4,1) CHECK (birth_length_cm BETWEEN 20 AND 65),
  blood_group       VARCHAR(3) CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies         VARCHAR(300),
  notes             VARCHAR(500),
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_children_mother ON children (mother_id, date_of_birth);

-- The picture itself (a small JPEG/PNG, resized in the browser before upload).
CREATE TABLE IF NOT EXISTS child_photos (
  child_id    INTEGER PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  mime_type   VARCHAR(20) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
  data        BYTEA NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per dose given. vaccine_code is validated in the API against
-- shared/child-reference.js, so the schedule can change without a migration.
CREATE TABLE IF NOT EXISTS child_vaccinations (
  child_id      INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  vaccine_code  VARCHAR(20) NOT NULL,
  given_on      DATE NOT NULL,
  facility      VARCHAR(120),
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, vaccine_code)
);

CREATE TABLE IF NOT EXISTS child_growth_logs (
  id           SERIAL PRIMARY KEY,
  child_id     INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  measured_on  DATE NOT NULL,
  weight_kg    NUMERIC(5,2) CHECK (weight_kg BETWEEN 0.4 AND 150),
  height_cm    NUMERIC(5,1) CHECK (height_cm BETWEEN 20 AND 220),
  head_cm      NUMERIC(4,1) CHECK (head_cm BETWEEN 20 AND 70),
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT child_growth_has_measurement CHECK (weight_kg IS NOT NULL OR height_cm IS NOT NULL OR head_cm IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_child_growth_child_date ON child_growth_logs (child_id, measured_on);

CREATE TABLE IF NOT EXISTS child_milestones (
  child_id       INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  milestone_code VARCHAR(20) NOT NULL,
  achieved_on    DATE NOT NULL,
  PRIMARY KEY (child_id, milestone_code)
);

COMMIT;
