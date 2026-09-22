-- ============================================================================
-- Children — post-birth profiles linked to a mother, with growth logs.
-- Vaccination / developmental milestones reuse care_milestones (category='child').
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS children (
  id            SERIAL PRIMARY KEY,
  mother_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name     VARCHAR(120) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender        VARCHAR(20),
  blood_group   VARCHAR(10),
  notes         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_children_mother ON children (mother_id);

CREATE TABLE IF NOT EXISTS child_growth_logs (
  id          SERIAL PRIMARY KEY,
  child_id    INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  mother_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL,
  weight_kg   NUMERIC(5,2),
  height_cm   NUMERIC(5,2),
  head_cm     NUMERIC(5,2),
  notes       TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_child_growth_child_date
  ON child_growth_logs (child_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_child_growth_mother
  ON child_growth_logs (mother_id, log_date DESC);

COMMIT;
