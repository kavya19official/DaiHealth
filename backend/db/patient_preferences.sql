-- Patient notification + privacy preferences (idempotent)
CREATE TABLE IF NOT EXISTS patient_preferences (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE patient_preferences IS
  'Notification toggles and privacy flags for the mother/patient settings panel.';
