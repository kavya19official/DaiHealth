-- Private mother-owned household context. Listing a support person grants no access.
CREATE TABLE IF NOT EXISTS family_circle_profiles (
 mother_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 record JSONB NOT NULL DEFAULT '{}'::jsonb,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
