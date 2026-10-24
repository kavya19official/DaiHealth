-- M. Facility freshness indicators.
-- Contact reports are what users say happened when they tried to reach a facility. The app shows
-- them only as counts, only once enough exist, and they never feed ranking. The API allows one
-- report per user per facility per week.
CREATE TABLE IF NOT EXISTS facility_contact_reports (
  id          SERIAL PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outcome     VARCHAR(12) NOT NULL CHECK (outcome IN ('reached','not_reached')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS facility_contact_reports_facility ON facility_contact_reports(facility_id, created_at DESC);
