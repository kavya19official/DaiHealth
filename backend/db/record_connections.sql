-- Prototype provider connections. ABHA entry is never proof of identity or consent.
CREATE TABLE IF NOT EXISTS record_connection_identities (
 mother_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 identity_cipher JSONB NOT NULL,
 number_last4 TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('self_reported','demo')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS record_connections (
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('abdm','digilocker')),
 mode TEXT NOT NULL DEFAULT 'demo' CHECK(mode='demo'),
 selected_records JSONB NOT NULL DEFAULT '[]'::jsonb,
 connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), disconnected_at TIMESTAMPTZ,
 PRIMARY KEY(mother_id,provider)
);
CREATE TABLE IF NOT EXISTS record_connection_consents (
 id UUID PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 providers JSONB NOT NULL,
 categories JSONB NOT NULL,
 from_date DATE NOT NULL, to_date DATE NOT NULL,
 purpose TEXT NOT NULL,
 days INTEGER NOT NULL CHECK(days IN (1,7,30)),
 state TEXT NOT NULL CHECK(state IN ('requested','granted','revoked')),
 expires_at TIMESTAMPTZ NOT NULL,
 granted_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
 created_by INTEGER NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(from_date<=to_date), CHECK(mother_id<>doctor_id)
);
CREATE INDEX IF NOT EXISTS rc_consent_scope ON record_connection_consents(mother_id,doctor_id,state);
CREATE TABLE IF NOT EXISTS connected_records (
 id UUID PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('abdm','digilocker')),
 provider_record_id TEXT NOT NULL,
 title TEXT NOT NULL, doc_type TEXT NOT NULL,
 report_date DATE NOT NULL, issuer TEXT NOT NULL,
 mime_type TEXT NOT NULL DEFAULT 'application/pdf',
 payload_cipher JSONB NOT NULL, content_sha256 TEXT NOT NULL,
 demo BOOLEAN NOT NULL DEFAULT TRUE CHECK(demo=TRUE),
 imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(mother_id,provider,provider_record_id)
);
CREATE TABLE IF NOT EXISTS record_connection_events (
 id BIGSERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id INTEGER REFERENCES users(id),
 event_type TEXT NOT NULL, reference_id TEXT, provider TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
