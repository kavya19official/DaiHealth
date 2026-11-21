BEGIN;
CREATE TABLE IF NOT EXISTS child_development_checkins (
 id UUID PRIMARY KEY,
 child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 checkpoint_months INTEGER NOT NULL,
 age_days INTEGER NOT NULL,
 answers JSONB NOT NULL,
 lost_skills TEXT NOT NULL CHECK(lost_skills IN ('yes','no','unsure')),
 concern TEXT NOT NULL DEFAULT '',
 instrument TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS child_development_checkins_child ON child_development_checkins(child_id,created_at DESC);
COMMIT;
