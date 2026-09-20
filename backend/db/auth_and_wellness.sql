-- ============================================================================
-- Auth + Wellness — schema
--
-- The `users`, `mother_profiles`, and `doctor_profiles` tables were assumed
-- to already exist (see care_timeline_and_appointments.sql), but they were
-- never actually checked in anywhere in this repo, which is why login has
-- never been able to work end to end. This migration creates them, plus the
-- wellness tables (nutrition / water / supplements / contractions / growth)
-- so that day-to-day tracking survives a cleared browser and is visible to
-- a mother's doctor. All statements are idempotent so this can be re-run.
--
-- Apply with:
--   psql "$DATABASE_URL" -f backend/db/auth_and_wellness.sql
-- Apply BEFORE care_timeline_and_appointments.sql (that file's foreign keys
-- reference users(id), which this file creates).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- users / mother_profiles / doctor_profiles
-- Queried throughout server.js (auth routes, getUserProfile, timeline,
-- appointments, doctor colleague routes).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           VARCHAR(10) NOT NULL CHECK (role IN ('mother', 'doctor')),
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mother_profiles (
  user_id                    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name                  VARCHAR(255) NOT NULL,
  phone                      VARCHAR(20),
  emergency_contact_name     VARCHAR(255),
  emergency_contact_phone    VARCHAR(20),
  care_start_date            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctor_profiles (
  user_id                  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name                VARCHAR(255) NOT NULL,
  phone                    VARCHAR(20),
  specialization           VARCHAR(255) NOT NULL,
  medical_license_number   VARCHAR(100) NOT NULL,
  facility_name            VARCHAR(255)
);

-- ----------------------------------------------------------------------------
-- Wellness tracking — every table is scoped by `log_date`, a plain DATE
-- supplied by the client (the mother's own local calendar date, not the
-- server's timezone), so "today" always means the mother's local today and
-- everything naturally resets when that date rolls over.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS nutrition_logs (
  id          SERIAL PRIMARY KEY,
  mother_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL,
  text        TEXT NOT NULL,
  logged_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_mother_date ON nutrition_logs (mother_id, log_date);

CREATE TABLE IF NOT EXISTS water_logs (
  mother_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL,
  glasses     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mother_id, log_date)
);

CREATE TABLE IF NOT EXISTS supplement_logs (
  mother_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL,
  supplement  VARCHAR(50) NOT NULL,
  taken       BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (mother_id, log_date, supplement)
);

CREATE TABLE IF NOT EXISTS growth_logs (
  id          SERIAL PRIMARY KEY,
  mother_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL,
  weight_kg   NUMERIC(5,2),
  height_cm   NUMERIC(5,2),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_growth_logs_mother_date ON growth_logs (mother_id, log_date);

-- One row per contraction. started_at is a full timestamp (not just a date)
-- because the 5-1-1 check needs real gaps between contractions, including
-- ones that straddle midnight.
CREATE TABLE IF NOT EXISTS contraction_logs (
  id            SERIAL PRIMARY KEY,
  mother_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date      DATE NOT NULL,
  started_at    TIMESTAMP NOT NULL,
  duration_ms   INTEGER NOT NULL,
  gap_ms        INTEGER,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contraction_logs_mother_started ON contraction_logs (mother_id, started_at);

COMMIT;
