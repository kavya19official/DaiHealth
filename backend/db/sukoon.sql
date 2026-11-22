BEGIN;
-- Opaque, client-encrypted payload only. No decryption key or plaintext journal.
CREATE TABLE IF NOT EXISTS sukoon_vaults (
 mother_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 envelope JSONB NOT NULL, revision UUID NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sukoon_preferences (
 mother_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 reminders BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sukoon_requests (
 id UUID PRIMARY KEY, mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 grant_id UUID NOT NULL REFERENCES family_access_grants(id) ON DELETE CASCADE,
 minutes INTEGER NOT NULL CHECK(minutes BETWEEN 15 AND 120),
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','accepted','done','cancelled')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), accepted_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sukoon_duties (
 id UUID PRIMARY KEY, mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 grant_id UUID REFERENCES family_access_grants(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('feed','diaper','meal','settle','home')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sukoon_presence (
 mother_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE daicare_referrals ADD COLUMN IF NOT EXISTS follow_up_due_at TIMESTAMPTZ;
COMMIT;
