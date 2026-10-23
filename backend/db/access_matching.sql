-- Optional reported access information; unknown prices and slots remain NULL/empty.
BEGIN;
ALTER TABLE facility_services ADD COLUMN IF NOT EXISTS fee_min_inr NUMERIC(10,2) CHECK (fee_min_inr >= 0);
ALTER TABLE facility_services ADD COLUMN IF NOT EXISTS fee_max_inr NUMERIC(10,2) CHECK (fee_max_inr >= fee_min_inr);
ALTER TABLE facility_services ADD COLUMN IF NOT EXISTS fee_source TEXT;
ALTER TABLE facility_services ADD COLUMN IF NOT EXISTS fee_updated_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS facility_service_slots (
 id SERIAL PRIMARY KEY,
 facility_service_id INTEGER NOT NULL REFERENCES facility_services(id) ON DELETE CASCADE,
 doctor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 starts_at TIMESTAMPTZ NOT NULL,
 ends_at TIMESTAMPTZ NOT NULL,
 available_places INTEGER NOT NULL CHECK (available_places >= 0),
 source TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK (ends_at > starts_at),
 UNIQUE(facility_service_id, starts_at, doctor_id)
);
CREATE INDEX IF NOT EXISTS idx_service_slots_start ON facility_service_slots(facility_service_id,starts_at);
COMMENT ON TABLE facility_service_slots IS 'Reported availability, not a patient booking or reservation. Matching never books a slot.';
COMMIT;
