BEGIN;

-- Family Circle extends the existing scoped caregiver grant. Relationship is
-- descriptive only: it never creates clinical, legal or decision-making power.
ALTER TABLE family_access_grants
  ADD COLUMN IF NOT EXISTS relationship TEXT NOT NULL DEFAULT 'caregiver';

COMMIT;
