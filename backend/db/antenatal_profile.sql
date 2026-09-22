-- Extended antenatal / maternal profile fields + risk snapshot
BEGIN;

ALTER TABLE mother_profiles
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS blood_group VARCHAR(10),
  ADD COLUMN IF NOT EXISTS pregnancy_status VARCHAR(20) DEFAULT 'pregnant'
    CHECK (pregnancy_status IS NULL OR pregnancy_status IN ('pregnant', 'delivered', 'planning')),
  ADD COLUMN IF NOT EXISTS lmp_date DATE,
  ADD COLUMN IF NOT EXISTS edd_date DATE,
  ADD COLUMN IF NOT EXISTS gravida INTEGER,
  ADD COLUMN IF NOT EXISTS parity INTEGER,
  ADD COLUMN IF NOT EXISTS previous_complications TEXT,
  ADD COLUMN IF NOT EXISTS medical_conditions TEXT,
  ADD COLUMN IF NOT EXISTS allergies TEXT,
  ADD COLUMN IF NOT EXISTS current_medications TEXT,
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS pre_pregnancy_weight_kg NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20),
  ADD COLUMN IF NOT EXISTS risk_factors JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_assessed_at TIMESTAMPTZ;

COMMIT;
