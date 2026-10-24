-- Assistance consent is opt-in and separate from clinical or family-sharing consent.
CREATE TABLE IF NOT EXISTS patient_ml_settings (
 patient_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 personalization BOOLEAN NOT NULL DEFAULT FALSE,
 location BOOLEAN NOT NULL DEFAULT FALSE,
 reminders BOOLEAN NOT NULL DEFAULT FALSE,
 events BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS events (
 id BIGSERIAL PRIMARY KEY,
 patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL CHECK(event_type IN ('reminder_sent','reminder_opened','action_started','action_completed','facility_viewed','facility_chosen','appointment_kept')),
 timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 channel TEXT NOT NULL CHECK(channel IN ('app','SMS','WhatsApp','voice')),
 entity_id TEXT,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS events_patient_time ON events(patient_id,timestamp);
CREATE TABLE IF NOT EXISTS patient_reminder_plans (
 id BIGSERIAL PRIMARY KEY,
 patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_date DATE NOT NULL,
 hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),
 channel TEXT NOT NULL DEFAULT 'app',
 reason TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('ml','rules')),
 state TEXT NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','ready','opened','cancelled')),
 due_at TIMESTAMPTZ NOT NULL,
 UNIQUE(patient_id,plan_date)
);
ALTER TABLE care_milestones ADD COLUMN IF NOT EXISTS added_by_doctor_id INTEGER REFERENCES users(id);
ALTER TABLE care_milestones ADD COLUMN IF NOT EXISTS clinician_priority TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS events_completed_once ON events(patient_id,event_type,entity_id)
 WHERE event_type IN ('action_completed','appointment_kept');
