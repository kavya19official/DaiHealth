CREATE TABLE IF NOT EXISTS delivery_coordination (
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 record JSONB NOT NULL DEFAULT '{}'::jsonb,
 labour JSONB,
 labour_updated_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(mother_id,doctor_id)
);
