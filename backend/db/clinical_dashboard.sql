ALTER TABLE doctor_profiles ADD COLUMN IF NOT EXISTS credential_verified BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS clinical_dashboard_consent (
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 PRIMARY KEY(mother_id,doctor_id)
);
CREATE TABLE IF NOT EXISTS clinical_dashboard_entries (
 id SERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES users(id),
 recorded_on DATE NOT NULL,
 source_kind VARCHAR(20) NOT NULL CHECK(source_kind IN ('clinic_visit','clinic_scan')),
 values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
 targets_json JSONB NOT NULL DEFAULT '{}'::jsonb,
 scan_note TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clinical_dashboard_plan (
 id SERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES users(id),
 title VARCHAR(160) NOT NULL,
 description TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clinical_dashboard_adherence (
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id INTEGER NOT NULL REFERENCES clinical_dashboard_plan(id) ON DELETE CASCADE,
 log_date DATE NOT NULL,
 done BOOLEAN NOT NULL,
 PRIMARY KEY(mother_id,plan_id,log_date)
);
