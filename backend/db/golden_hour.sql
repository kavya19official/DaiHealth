-- Golden Hour: emergency pre-alert (PROTOTYPE, synthetic demo only).
-- One row per alert raised by a mother or an authorised family member. The server
-- re-runs the shared fixed triage rules and builds the SBAR itself; it never trusts
-- a browser-computed level, facility or summary.
BEGIN;
CREATE TABLE IF NOT EXISTS golden_hour_alerts (
  id                    VARCHAR(36) PRIMARY KEY,
  mother_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  triggered_by_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  triggered_by          VARCHAR(8) NOT NULL CHECK (triggered_by IN ('mother', 'family')),
  emergency_event_id    INTEGER REFERENCES emergency_events(id) ON DELETE SET NULL,
  request_key           VARCHAR(80) NOT NULL,
  priority              VARCHAR(10) NOT NULL CHECK (priority IN ('emergency', 'urgent')),
  symptoms              JSONB NOT NULL DEFAULT '[]'::jsonb,
  triage                JSONB NOT NULL,
  requirements          JSONB NOT NULL,
  candidates            JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ranked facilities with eligibility, kept so a decline can be re-routed
  facility_code         VARCHAR(40),
  facility_name         VARCHAR(255),
  distance_km           NUMERIC(6, 1),
  eta_minutes           INTEGER,
  origin                JSONB NOT NULL DEFAULT '{}'::jsonb,   -- approximate point + how it was resolved
  sbar                  JSONB,
  status                VARCHAR(24) NOT NULL DEFAULT 'sent',
  delivery              VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (delivery IN ('pending', 'delivered', 'not_delivered', 'none')),
  portal_alert_id       VARCHAR(36),
  portal_status         VARCHAR(24),
  history               JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions               JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (mother_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_golden_hour_alerts_mother_time ON golden_hour_alerts (mother_id, created_at DESC);
COMMIT;
