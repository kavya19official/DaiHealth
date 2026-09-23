-- ============================================================================
-- Mother dashboard — schema
--
-- Adds only what the redesigned mother dashboard needs that the existing
-- schema does not already provide. Meals, water, supplements, contractions and
-- baby growth already live in nutrition_logs / water_logs / supplement_logs /
-- contraction_logs / growth_logs (auth_and_wellness.sql), and the doctor's
-- continuity view reads those — so they are intentionally NOT duplicated here.
-- (The new /api/wellness/history and DELETE routes read/write those same tables.)
--
-- Apply AFTER auth_and_wellness.sql and care_timeline_and_appointments.sql.
-- Every statement is idempotent, so this is safe to re-run:
--
--   psql "$DATABASE_URL" -f backend/db/mother_dashboard.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- mother_profiles.pregnancy_confirmed_at
-- care_start_date is the "gestational day 0" anchor for the whole care timeline
-- (milestone offsets are 42 days = week 6 ... 280 days = delivery), but at
-- registration it is silently defaulted to *today* — registration does not ask
-- for a due date or last period. Every new mother therefore showed "Week 0".
-- This column records whether the mother has actually confirmed her LMP / due
-- date (PATCH /api/profile/pregnancy), so the UI can tell "confirmed" from
-- "defaulted to the registration date" instead of presenting a guess as fact.
-- ----------------------------------------------------------------------------
ALTER TABLE mother_profiles
  ADD COLUMN IF NOT EXISTS pregnancy_confirmed_at TIMESTAMP;

-- ----------------------------------------------------------------------------
-- health_logs
-- Append-only, time-stamped self-tracking events that had no home yet. One
-- table with a typed, server-validated JSONB payload keeps the trackers
-- uniform (list / add / delete). The API (never the client) decides which keys
-- are stored for each log_type; see LOG_VALIDATORS in motherDashboard.js.
--
--   blood_pressure  {systolic, diastolic, pulse?}
--   weight          {kg}                              (the mother's own weight)
--   blood_glucose   {mg_dl, context: fasting|after_meal_1h|after_meal_2h|random}
--   kick_session    {kicks, duration_sec}             (logged_at = session start)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_logs (
  id          SERIAL PRIMARY KEY,
  mother_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_type    VARCHAR(30) NOT NULL CHECK (log_type IN (
                'blood_pressure', 'weight', 'blood_glucose', 'kick_session')),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_health_logs_mother_type_time
  ON health_logs (mother_id, log_type, logged_at DESC);

-- ----------------------------------------------------------------------------
-- medications
-- The mother's own list of medicines / supplements (previously three hard-coded
-- checkboxes: Iron / Folic acid / Calcium). Only the NAMES live here — a daily
-- "taken" tick is stored in the existing supplement_logs table, keyed by name,
-- so the doctor's adherence figure (GET /api/doctor/patients/:id/wellness)
-- keeps working and counts custom medications too. Removing one only sets
-- active = false so history is preserved.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medications (
  id             SERIAL PRIMARY KEY,
  mother_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(50) NOT NULL,
  dose           VARCHAR(80),
  schedule       VARCHAR(80),
  prescribed_by  VARCHAR(120),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_medications_mother_active
  ON medications (mother_id) WHERE active;

-- ----------------------------------------------------------------------------
-- health_reports
-- Test / scan results a mother records against her care plan. Optionally
-- linked to the care_milestones row it fulfils (ON DELETE SET NULL so a
-- result outlives a re-seeded timeline).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_reports (
  id              SERIAL PRIMARY KEY,
  mother_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(160) NOT NULL,
  report_date     DATE NOT NULL,
  lab_name        VARCHAR(160),
  result_summary  TEXT,
  milestone_id    INTEGER REFERENCES care_milestones(id) ON DELETE SET NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_health_reports_mother_date
  ON health_reports (mother_id, report_date DESC);

-- ----------------------------------------------------------------------------
-- payment_methods / mother_profiles.financial_stability
-- A lightweight way for a mother to record how she plans to cover care costs
-- (insurance, mobile money, employer scheme, cash, ...) and to self-report how
-- manageable those costs currently feel. This is a self-declared signal, not a
-- credit check — no card/account numbers are stored, only a short reference
-- the mother chooses herself (e.g. a policy number's last digits).
-- ----------------------------------------------------------------------------
ALTER TABLE mother_profiles
  ADD COLUMN IF NOT EXISTS financial_stability VARCHAR(20);

CREATE TABLE IF NOT EXISTS payment_methods (
  id          SERIAL PRIMARY KEY,
  mother_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method_type VARCHAR(20) NOT NULL CHECK (method_type IN (
                'insurance', 'mobile_money', 'bank_card', 'cash', 'employer_scheme')),
  provider    VARCHAR(120),
  reference   VARCHAR(50),   -- mother-chosen label only, e.g. last 4 digits — never a full account/card number
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_mother_active
  ON payment_methods (mother_id) WHERE active;

COMMIT;
