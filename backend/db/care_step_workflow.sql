-- Explicit provenance; no clinical values are carried over the live stream.
CREATE TABLE IF NOT EXISTS care_step_events (
 id BIGSERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 milestone_id INTEGER NOT NULL REFERENCES care_milestones(id) ON DELETE CASCADE,
 actor_id INTEGER NOT NULL REFERENCES users(id),
 from_state TEXT NOT NULL,
 to_state TEXT NOT NULL CHECK(to_state IN ('patient_reported','evidence_submitted','awaiting_review','clinician_confirmed')),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS care_step_events_patient ON care_step_events(mother_id,id);
CREATE TABLE IF NOT EXISTS care_step_assistance_log (
 id BIGSERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 milestone_id INTEGER NOT NULL REFERENCES care_milestones(id) ON DELETE CASCADE,
 tools_used JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
