-- Patient-facing released nursing summaries; raw alerts and internal notes never leave this boundary.
CREATE TABLE IF NOT EXISTS patient_hospital_stays (
 id SERIAL PRIMARY KEY, mother_id INTEGER NOT NULL REFERENCES users(id),
 facility_name TEXT NOT NULL, ward_name TEXT NOT NULL, bed_label TEXT,
 admitted_at TIMESTAMPTZ NOT NULL, discharged_at TIMESTAMPTZ,
 visible_days_after_discharge INTEGER NOT NULL DEFAULT 7 CHECK(visible_days_after_discharge BETWEEN 0 AND 30),
 nurse_contact TEXT, synthetic BOOLEAN NOT NULL DEFAULT FALSE,
 CHECK(discharged_at IS NULL OR discharged_at>=admitted_at)
);
CREATE TABLE IF NOT EXISTS patient_stay_updates (
 id SERIAL PRIMARY KEY, stay_id INTEGER NOT NULL REFERENCES patient_hospital_stays(id),
 child_id INTEGER REFERENCES children(id),
 kind TEXT NOT NULL CHECK(kind IN ('vitals','medicine','feeding','weight','phototherapy','kangaroo','handover','next_check','followup')),
 recorded_at TIMESTAMPTZ NOT NULL, recorded_by TEXT NOT NULL,
 patient_text TEXT NOT NULL, values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
 verified_at TIMESTAMPTZ, verified_by TEXT, released_at TIMESTAMPTZ, released_by TEXT,
 supersedes_id INTEGER REFERENCES patient_stay_updates(id),
 CHECK(verified_at IS NULL OR verified_at>=recorded_at),
 CHECK(released_at IS NULL OR (verified_at IS NOT NULL AND released_at>=verified_at AND released_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS patient_stay_updates_stay ON patient_stay_updates(stay_id,released_at);
CREATE TABLE IF NOT EXISTS patient_stay_notes (
 id SERIAL PRIMARY KEY, stay_id INTEGER NOT NULL REFERENCES patient_hospital_stays(id),
 mother_id INTEGER NOT NULL REFERENCES users(id), note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 1000), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS patient_stay_preferences (
 mother_id INTEGER PRIMARY KEY REFERENCES users(id), caregiver_sharing BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS patient_stay_access_log (
 id SERIAL PRIMARY KEY, mother_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
