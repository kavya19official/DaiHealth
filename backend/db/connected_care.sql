BEGIN;
ALTER TABLE clinical_review_requests DROP CONSTRAINT IF EXISTS clinical_review_requests_kind_check;
ALTER TABLE clinical_review_requests ADD CONSTRAINT clinical_review_requests_kind_check CHECK(kind IN ('pregnancy_risk','clinical_recommendation','document_interpretation','postpartum_wellbeing'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE mother_profiles ADD COLUMN IF NOT EXISTS catchment_ward TEXT;
ALTER TABLE mother_profiles ADD COLUMN IF NOT EXISTS village TEXT;
CREATE TABLE IF NOT EXISTS remote_visits (
 appointment_id INTEGER PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
 mode TEXT NOT NULL CHECK(mode IN ('audio','video')),
 consent_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
 clinician_notes TEXT NOT NULL DEFAULT '', released_at TIMESTAMPTZ,
 prescription_document_id INTEGER REFERENCES patient_documents(id) ON DELETE SET NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS remote_visit_note_versions (
 id UUID PRIMARY KEY, appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES users(id), notes TEXT NOT NULL,
 prescription_document_id INTEGER REFERENCES patient_documents(id) ON DELETE SET NULL,
 released BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS family_access_grants (
 id UUID PRIMARY KEY, mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 grantee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 recipient_email TEXT NOT NULL, invite_hash TEXT UNIQUE, scopes JSONB NOT NULL, child_ids INTEGER[] NOT NULL DEFAULT '{}',
 expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(mother_id<>grantee_id)
);
CREATE INDEX IF NOT EXISTS family_grantee ON family_access_grants(grantee_id);
CREATE TABLE IF NOT EXISTS family_access_events (
 id BIGSERIAL PRIMARY KEY, mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 grant_id UUID, action TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS message_preferences (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('sms','whatsapp')), encrypted_contact JSONB NOT NULL,
 phone_suffix TEXT NOT NULL, verified_at TIMESTAMPTZ, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 otp_hash TEXT, otp_expires_at TIMESTAMPTZ, otp_attempts INTEGER NOT NULL DEFAULT 0,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS message_deliveries (
 id UUID PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 dedupe_key TEXT NOT NULL, channel TEXT NOT NULL,
 status TEXT NOT NULL, provider_ref TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(user_id,dedupe_key)
);
COMMIT;
