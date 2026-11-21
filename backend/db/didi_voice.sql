-- Dai Didi: structured entries created from voice (app or phone call).
-- The server re-runs the shared fixed-rule engine on the mother's own words when
-- saving, so stored triage never depends on what a browser claims. Raw audio is
-- never stored; only the text of what she said, which she can delete.
BEGIN;
CREATE TABLE IF NOT EXISTS voice_care_entries (
  id                  BIGSERIAL PRIMARY KEY,
  mother_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel             VARCHAR(8) NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'phone')),
  language            VARCHAR(10) NOT NULL DEFAULT 'en',
  context             VARCHAR(12) NOT NULL CHECK (context IN ('pregnant', 'postpartum')),
  triage_level        VARCHAR(10) NOT NULL CHECK (triage_level IN ('emergency', 'urgent', 'unsure')),
  review_status       VARCHAR(32) NOT NULL DEFAULT 'clinician_review_suggested',
  entry               JSONB NOT NULL,
  spoken_turns        JSONB NOT NULL DEFAULT '[]'::jsonb,
  emergency_event_id  INTEGER REFERENCES emergency_events(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_voice_care_entries_mother_time ON voice_care_entries (mother_id, created_at DESC);
COMMIT;
