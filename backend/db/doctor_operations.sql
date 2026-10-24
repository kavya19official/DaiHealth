-- Operational state is separate from clinical milestone completion and risk.
CREATE TABLE IF NOT EXISTS doctor_queue_state (
 appointment_id INTEGER PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES users(id),
 state TEXT NOT NULL CHECK(state IN ('booked','waiting','in_consult','done','no_show')),
 version INTEGER NOT NULL DEFAULT 1,
 checked_in_at TIMESTAMPTZ,
 consultation_started_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS doctor_one_active_consult ON doctor_queue_state(doctor_id) WHERE state='in_consult';
CREATE TABLE IF NOT EXISTS doctor_worklist_action (
 doctor_id INTEGER NOT NULL REFERENCES users(id),
 milestone_id INTEGER NOT NULL REFERENCES care_milestones(id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK(state IN ('reviewed','dismissed','reopened')),
 reason TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(doctor_id,milestone_id)
);
CREATE TABLE IF NOT EXISTS doctor_operations_event (
 id SERIAL PRIMARY KEY,
 doctor_id INTEGER NOT NULL REFERENCES users(id),
 mother_id INTEGER NOT NULL REFERENCES users(id),
 action TEXT NOT NULL,
 entity_id INTEGER NOT NULL,
 detail JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
