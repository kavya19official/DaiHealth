-- Stores only the same suppressed/banded aggregate DTO returned to its requesting clinician.
-- No patient-level data, prompts or medical notes. Expires after 15 minutes; cleaned on report generation.
CREATE TABLE IF NOT EXISTS analytics_report_snapshots (
 id UUID PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 report JSONB NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_report_snapshots_expiry ON analytics_report_snapshots(expires_at);
