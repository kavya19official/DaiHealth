-- N. Privacy-preserving analytics. Only an audit trail is stored: the dashboard computes aggregates on
-- demand from existing tables and never stores or returns row-level data.
CREATE TABLE IF NOT EXISTS analytics_access_log (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        VARCHAR(10) NOT NULL CHECK (kind IN ('view','export')),
  metric      VARCHAR(40) NOT NULL,
  group_by    VARCHAR(20) NOT NULL,
  window_days INTEGER NOT NULL,
  rows_shown  INTEGER NOT NULL DEFAULT 0,
  rows_hidden INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS analytics_access_log_user ON analytics_access_log(user_id, kind, created_at DESC);
