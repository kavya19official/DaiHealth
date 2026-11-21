BEGIN;

-- Existing and staff-provisioned accounts retain their original sign-in policy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS pending_email_signups (
  email VARCHAR(255) PRIMARY KEY CHECK (email = lower(email)),
  challenge_id UUID NOT NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation UUID NOT NULL,
  otp_digest BYTEA NOT NULL CHECK (octet_length(otp_digest) = 32),
  attempts_remaining SMALLINT NOT NULL CHECK (attempts_remaining BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  resend_at TIMESTAMPTZ NOT NULL,
  discard_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pending_email_signups_discard ON pending_email_signups(discard_at);

CREATE TABLE IF NOT EXISTS email_signup_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  resets_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS email_signup_rate_limits_reset ON email_signup_rate_limits(resets_at);

COMMIT;
