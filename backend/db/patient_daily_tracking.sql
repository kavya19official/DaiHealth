-- Self-reported additions and idempotency for private daily tracking.
CREATE TABLE IF NOT EXISTS patient_daily_entries (
 id SERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 mutation_id UUID NOT NULL,
 log_date DATE NOT NULL,
 kind VARCHAR(30) NOT NULL,
 data JSONB NOT NULL,
 logged_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(mother_id,mutation_id)
);
CREATE INDEX IF NOT EXISTS patient_daily_date ON patient_daily_entries(mother_id,log_date,logged_at);
CREATE TABLE IF NOT EXISTS patient_daily_consent (
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(mother_id,doctor_id)
);
CREATE TABLE IF NOT EXISTS patient_daily_preferences (
 mother_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 reminder_time VARCHAR(5),
 reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE
);
