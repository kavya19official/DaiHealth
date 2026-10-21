-- ============================================================================
-- Child health: medical history + child-linked paediatric appointments
--
-- Adds
--   child_health_events    the child's medical history log: illnesses, injuries,
--                          hospital stays, surgeries, allergies/reactions,
--                          medications, check-ups and free notes
--   appointments.child_id  lets an appointment be booked "for" a specific child,
--                          so it shows on that child's timeline and visit history
--
-- Apply AFTER child_dashboard.sql and care_timeline_and_appointments.sql.
-- Every statement is idempotent, so it is safe to re-run:
--
--   psql "$DATABASE_URL" -f backend/db/child_health_v3.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS child_health_events (
  id           SERIAL PRIMARY KEY,
  child_id     INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  -- Validated against HEALTH_EVENT_TYPES in shared/child-reference.js as well.
  event_type   VARCHAR(20) NOT NULL
                 CHECK (event_type IN ('checkup', 'illness', 'injury', 'hospitalisation', 'surgery', 'allergy', 'medication', 'note')),
  title        VARCHAR(160) NOT NULL,
  details      VARCHAR(1000),
  event_date   DATE NOT NULL,
  doctor_name  VARCHAR(120),
  facility     VARCHAR(120),
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_child_health_events_child_date
  ON child_health_events (child_id, event_date DESC, id DESC);

-- An appointment may optionally be about one of the mother's children. If the child
-- profile is later removed the appointment stays (it is still the mother's booking).
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS child_id INTEGER REFERENCES children(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_child
  ON appointments (child_id, requested_date DESC) WHERE child_id IS NOT NULL;

COMMIT;
