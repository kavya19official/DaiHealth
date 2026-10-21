-- ============================================================================
-- Care extensions v4 — predictive risk history, postpartum pathway, emergency
--
-- Apply AFTER mother_dashboard.sql, antenatal_profile.sql and child_dashboard.sql.
-- Idempotent — safe to re-run:
--
--   psql "$DATABASE_URL" -f backend/db/care_extensions_v4.sql
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- risk_assessments
-- mother_profiles.risk_level only ever holds the LATEST result, so there was no
-- way to see a trend. One row per assessment run; inputs and the explanation are
-- stored as they were at the time so an old result can always be explained.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_assessments (
  id           SERIAL PRIMARY KEY,
  mother_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  risk_level   VARCHAR(20) NOT NULL,
  knn_level    VARCHAR(20),                       -- model's own answer before clinical overrides
  factors      JSONB NOT NULL DEFAULT '[]'::jsonb,
  inputs       JSONB NOT NULL DEFAULT '{}'::jsonb,
  explanation  JSONB,
  trigger      VARCHAR(20) NOT NULL DEFAULT 'manual'
                 CHECK (trigger IN ('manual', 'auto_log', 'registration')),
  assessed_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_mother_time
  ON risk_assessments (mother_id, assessed_at DESC);

-- ----------------------------------------------------------------------------
-- Postpartum pathway
--   postpartum_profile   delivery date/type (the care timeline only records that
--                        the "Delivery" milestone was ticked, not how it went)
--   postpartum_checkins  daily self check-in; red-flag result is computed by the
--                        server (shared/postpartum-rules.js), never trusted from
--                        the client
--   postpartum_contacts  which scheduled postnatal contacts have happened
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS postpartum_profile (
  mother_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  delivery_date  DATE NOT NULL,
  delivery_type  VARCHAR(12) NOT NULL DEFAULT 'unknown'
                   CHECK (delivery_type IN ('vaginal', 'caesarean', 'assisted', 'unknown')),
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS postpartum_checkins (
  id            SERIAL PRIMARY KEY,
  mother_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_date  DATE NOT NULL,
  answers       JSONB NOT NULL,                  -- whitelisted keys only (see shared/postpartum-rules.js)
  level         VARCHAR(10) NOT NULL CHECK (level IN ('ok', 'watch', 'urgent', 'emergency')),
  flags         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_postpartum_checkins_mother_date
  ON postpartum_checkins (mother_id, checkin_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS postpartum_contacts (
  mother_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_code  VARCHAR(30) NOT NULL,
  completed_on  DATE NOT NULL,
  PRIMARY KEY (mother_id, contact_code)
);

-- ----------------------------------------------------------------------------
-- Emergency response
--   emergency_plans   the mother's own pre-arranged plan (facility, transport...)
--                     — her words, not data pulled from anywhere else.
--   emergency_events  one row per SOS. `actions` holds what the MOTHER says she
--                     did ("called ambulance", "shared summary"). Nothing here
--                     ever records that a hospital accepted or has a bed.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_plans (
  mother_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  facility_name        VARCHAR(160),
  facility_phone       VARCHAR(20),
  backup_facility_name VARCHAR(160),
  backup_facility_phone VARCHAR(20),
  transport_note       VARCHAR(300),
  blood_donor_name     VARCHAR(120),
  blood_donor_phone    VARCHAR(20),
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS emergency_events (
  id            SERIAL PRIMARY KEY,
  mother_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context       VARCHAR(12) NOT NULL CHECK (context IN ('pregnant', 'postpartum')),
  symptoms      JSONB NOT NULL DEFAULT '[]'::jsonb,
  triage_level  VARCHAR(10) NOT NULL CHECK (triage_level IN ('emergency', 'urgent', 'unsure')),
  note          VARCHAR(500),
  summary       JSONB NOT NULL,                  -- snapshot at the time, incl. data timestamps
  actions       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{action, at}] self-reported by the mother
  status        VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  outcome       VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_emergency_events_mother_time
  ON emergency_events (mother_id, created_at DESC);

COMMIT;
