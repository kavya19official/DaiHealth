CREATE TABLE IF NOT EXISTS timeline_location_consents (
 id BIGSERIAL PRIMARY KEY,mother_id INTEGER NOT NULL REFERENCES users(id),
 milestone_id INTEGER NOT NULL REFERENCES care_milestones(id),purpose TEXT NOT NULL DEFAULT 'nearest-centres-once',
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Coordinates are deliberately not stored in the consent log.
