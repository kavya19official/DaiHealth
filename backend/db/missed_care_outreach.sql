-- ============================================================================
-- Missed-Care Outreach Queue — schema
--
-- This migration adds tables for tracking missed care items and outreach
-- attempts. This enables hospital staff and community health workers to
-- prioritize follow-ups based on urgency, time overdue, and access barriers.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- missed_care_items
-- One row per missed care milestone or appointment that needs follow-up
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS missed_care_items (
  id              SERIAL PRIMARY KEY,
  mother_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone_id    INTEGER REFERENCES care_milestones(id) ON DELETE SET NULL,
  appointment_id  INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  item_type       VARCHAR(20) NOT NULL CHECK (item_type IN ('milestone', 'appointment')),
  title           VARCHAR(255) NOT NULL,
  due_date        DATE NOT NULL,
  overdue_days    INTEGER NOT NULL DEFAULT 0,
  urgency_level   VARCHAR(20) NOT NULL DEFAULT 'medium'
                   CHECK (urgency_level IN ('low', 'medium', 'high', 'critical')),
  access_barriers JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'in_progress', 'resolved', 'deferred')),
  priority_score  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for filtering by status and urgency
CREATE INDEX IF NOT EXISTS idx_missed_care_status_urgency
  ON missed_care_items (status, urgency_level, priority_score DESC);

-- Index for filtering by mother_id
CREATE INDEX IF NOT EXISTS idx_missed_care_mother_id
  ON missed_care_items (mother_id, status);

-- Index for filtering by due_date for overdue items
CREATE INDEX IF NOT EXISTS idx_missed_care_due_date
  ON missed_care_items (due_date, status) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- outreach_attempts
-- One row per outreach attempt (call, visit, message) to a patient
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_attempts (
  id              SERIAL PRIMARY KEY,
  missed_care_id  INTEGER NOT NULL REFERENCES missed_care_items(id) ON DELETE CASCADE,
  attempted_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  attempt_type    VARCHAR(20) NOT NULL CHECK (attempt_type IN ('call', 'visit', 'message', 'other')),
  attempt_date    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  outcome         VARCHAR(30) NOT NULL
                   CHECK (outcome IN ('no_answer', 'reached', 'left_message', 'agreed_followup', 'declined', 'wrong_number', 'rescheduled')),
  notes           TEXT,
  next_action     VARCHAR(255),
  next_action_date DATE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for filtering by missed_care_id
CREATE INDEX IF NOT EXISTS idx_outreach_missed_care
  ON outreach_attempts (missed_care_id, attempt_date DESC);

-- Index for filtering by attempted_by (staff view)
CREATE INDEX IF NOT EXISTS idx_outreach_attempted_by
  ON outreach_attempts (attempted_by, attempt_date DESC);

-- ----------------------------------------------------------------------------
-- care_timeline_edits
-- Track clinician edits to care milestones for versioning and audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS care_timeline_edits (
  id              SERIAL PRIMARY KEY,
  milestone_id    INTEGER NOT NULL REFERENCES care_milestones(id) ON DELETE CASCADE,
  edited_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  edit_type       VARCHAR(20) NOT NULL CHECK (edit_type IN ('title', 'guidance', 'due_date', 'custom_addition')),
  previous_value  TEXT,
  new_value       TEXT,
  edit_reason     TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for filtering by milestone_id
CREATE INDEX IF NOT EXISTS idx_timeline_edits_milestone
  ON care_timeline_edits (milestone_id, created_at DESC);

-- Index for filtering by edited_by (clinician view)
CREATE INDEX IF NOT EXISTS idx_timeline_edits_edited_by
  ON care_timeline_edits (edited_by, created_at DESC);

-- ----------------------------------------------------------------------------
-- Update triggers to keep updated_at current
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_missed_care_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_missed_care_updated_at ON missed_care_items;
CREATE TRIGGER trg_missed_care_updated_at
  BEFORE UPDATE ON missed_care_items
  FOR EACH ROW
  EXECUTE FUNCTION update_missed_care_updated_at();

-- ----------------------------------------------------------------------------
-- Function to calculate priority score based on urgency and overdue days
-- Priority score = (urgency_weight * 10) + overdue_days
-- urgency weights: critical=4, high=3, medium=2, low=1
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_priority_score()
RETURNS TRIGGER AS $$
DECLARE
  urgency_weight INTEGER;
BEGIN
  CASE NEW.urgency_level
    WHEN 'critical' THEN urgency_weight := 4;
    WHEN 'high' THEN urgency_weight := 3;
    WHEN 'medium' THEN urgency_weight := 2;
    WHEN 'low' THEN urgency_weight := 1;
    ELSE urgency_weight := 2;
  END CASE;

  NEW.priority_score := (urgency_weight * 10) + NEW.overdue_days;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calculate_priority_score ON missed_care_items;
CREATE TRIGGER trg_calculate_priority_score
  BEFORE INSERT OR UPDATE OF urgency_level, overdue_days ON missed_care_items
  FOR EACH ROW
  EXECUTE FUNCTION calculate_priority_score();

COMMIT;
