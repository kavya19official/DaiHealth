CREATE TABLE IF NOT EXISTS care_capsules (
  id UUID PRIMARY KEY,
  mother_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL CHECK (subject IN ('mother','child')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS care_capsules_owner ON care_capsules(mother_id, created_at DESC);
CREATE INDEX IF NOT EXISTS care_capsules_revoked ON care_capsules(expires_at) WHERE revoked_at IS NOT NULL;
