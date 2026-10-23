-- Patient-facing scheduling and access history; safe for existing local databases.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS requested_time TIME;
CREATE TABLE IF NOT EXISTS patient_access_events (
 id SERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_type VARCHAR(50) NOT NULL,
 details JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS patient_access_events_owner ON patient_access_events(mother_id, created_at DESC);
