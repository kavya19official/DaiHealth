-- ============================================================================
-- Care Timeline + Appointments — schema
--
-- backend/server.js already implements the full Care Timeline and
-- Appointments feature set (milestone seeding/read/complete, appointment
-- request/list/status-update, doctor patient roster and per-patient
-- timeline), but the tables it queries were never added to version control.
-- This migration is the missing piece: it creates exactly the tables and
-- columns those routes rely on.
--
-- Assumes the `users`, `mother_profiles`, and `doctor_profiles` tables from
-- the existing authentication system already exist in the target database
-- (they are out of scope here — this migration only adds what Care
-- Timeline + Appointments needs). All statements are idempotent so this can
-- be safely re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- care_milestones
-- One row per milestone in a mother's care journey (seeded from the
-- MILESTONE_TEMPLATE in server.js at registration time). Queried by:
--   GET  /api/timeline
--   PATCH /api/timeline/:id/complete
--   GET  /api/doctor/patients                  (gap_count subquery)
--   GET  /api/doctor/patients/:motherId/timeline
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS care_milestones (
  id            SERIAL PRIMARY KEY,
  mother_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage         VARCHAR(50) NOT NULL,
  category      VARCHAR(20) NOT NULL CHECK (category IN ('pregnancy', 'child')),
  title         VARCHAR(255) NOT NULL,
  guidance      TEXT,
  due_date      DATE NOT NULL,
  completed_at  TIMESTAMP,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- GET /api/timeline and /api/doctor/patients/:motherId/timeline both filter
-- on mother_id and order by sort_order.
CREATE INDEX IF NOT EXISTS idx_care_milestones_mother_id
  ON care_milestones (mother_id, sort_order);

-- The gap_count subquery in /api/doctor/patients filters on mother_id +
-- completed_at IS NULL + due_date < CURRENT_DATE for every patient row, so
-- it benefits from an index on the open (not yet completed) milestones.
CREATE INDEX IF NOT EXISTS idx_care_milestones_open_due
  ON care_milestones (mother_id, due_date)
  WHERE completed_at IS NULL;

-- ----------------------------------------------------------------------------
-- appointments
-- One row per appointment request between a mother and a doctor. Queried by:
--   GET  /api/doctors                    (list of doctors to book)
--   POST /api/appointments               (mother requests)
--   GET  /api/appointments               (mother or doctor's own list)
--   PATCH /api/appointments/:id/status   (doctor updates status/notes)
--   GET  /api/doctor/patients            (roster derived from appointments)
--   GET  /api/doctor/patients/:motherId/timeline (relation check)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id              SERIAL PRIMARY KEY,
  mother_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_date  DATE NOT NULL,
  reason          TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  doctor_notes    TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- GET /api/appointments filters on mother_id (mother view) or doctor_id
-- (doctor view), each ordered by requested_date DESC.
CREATE INDEX IF NOT EXISTS idx_appointments_mother_id
  ON appointments (mother_id, requested_date DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_id
  ON appointments (doctor_id, requested_date DESC);

-- /api/doctor/patients and the timeline relation check both test for the
-- existence of a (doctor_id, mother_id) pair.
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_mother
  ON appointments (doctor_id, mother_id);

-- Keep updated_at current whenever a doctor changes status/notes via
-- PATCH /api/appointments/:id/status.
CREATE OR REPLACE FUNCTION set_appointments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION set_appointments_updated_at();

COMMIT;
