CREATE TABLE IF NOT EXISTS timeline_push_preferences (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 quiet_start INTEGER NOT NULL DEFAULT 21 CHECK(quiet_start BETWEEN 0 AND 23),
 quiet_end INTEGER NOT NULL DEFAULT 8 CHECK(quiet_end BETWEEN 0 AND 23),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS timeline_push_subscriptions (
 id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),endpoint_hash TEXT NOT NULL UNIQUE,
 encrypted_payload JSONB NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS timeline_push_deliveries (
 id BIGSERIAL PRIMARY KEY,subscription_id BIGINT NOT NULL REFERENCES timeline_push_subscriptions(id),
 dedupe_key TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(subscription_id,dedupe_key)
);
