-- Clinician-owned planning content; no copied patient charts or external delivery state.
CREATE TABLE IF NOT EXISTS doctor_workbench_items (
 id SERIAL PRIMARY KEY,
 doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('registry','education','evidence','referral','practice')),
 title TEXT NOT NULL,
 payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 version INTEGER NOT NULL DEFAULT 1,
 approved_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS doctor_workbench_owner ON doctor_workbench_items(doctor_id,kind,updated_at DESC);
CREATE TABLE IF NOT EXISTS doctor_workbench_events (
 id SERIAL PRIMARY KEY,
 doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_id INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('created','edited','approved','deleted')),
 version INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
