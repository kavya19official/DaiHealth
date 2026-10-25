-- K. Consent and sharing controls.
-- A mother can turn off a clinician (doctor) or a facility. A row here is a REVOCATION: care-team
-- membership still comes from her appointments (and any clinical-dashboard consent she gave), and
-- access is that relationship minus any active revocation. Every backend doctor-read/write path
-- uses accessControl.js, so a revoke is enforced by the server, not only hidden in the UI.
CREATE TABLE IF NOT EXISTS patient_access_controls (
  id           SERIAL PRIMARY KEY,
  mother_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grantee_type VARCHAR(10) NOT NULL CHECK (grantee_type IN ('doctor','facility')),
  grantee_ref  VARCHAR(80) NOT NULL,           -- doctor users.id, or appointments.facility_uuid
  state        VARCHAR(10) NOT NULL CHECK (state IN ('revoked','granted')),
  reason       VARCHAR(300),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mother_id, grantee_type, grantee_ref)
);

-- Views made through DAI clinician screens, including blocked attempts.
-- It does not cover access inside a hospital's own systems.
CREATE TABLE IF NOT EXISTS patient_record_access_log (
  id         SERIAL PRIMARY KEY,
  mother_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource   VARCHAR(40) NOT NULL,
  allowed    BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS patient_record_access_log_owner ON patient_record_access_log(mother_id, created_at DESC);
