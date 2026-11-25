-- Phase 2 clinical intelligence: deterministic flags, audit events and suggested actions.
-- Flags are derived from recorded data only; every flag keeps supporting record ids.
BEGIN;

CREATE TABLE IF NOT EXISTS clinical_flags (
  id SERIAL PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  fingerprint VARCHAR(200) NOT NULL,
  category VARCHAR(40) NOT NULL
    CHECK (category IN ('abnormal_measurement','significant_change','deteriorating_trend',
      'missing_information','overdue_investigation','pending_ultrasound_review',
      'pending_follow_up','outstanding_action')),
  parameter VARCHAR(60) NOT NULL,
  title VARCHAR(240) NOT NULL,
  current_value NUMERIC(12,4),
  previous_value NUMERIC(12,4),
  unit VARCHAR(40),
  current_on DATE,
  previous_on DATE,
  reference_low NUMERIC(12,4),
  reference_high NUMERIC(12,4),
  reference_text VARCHAR(255),
  reason TEXT NOT NULL,
  record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','under_review','acknowledged','resolved','monitoring')),
  severity VARCHAR(10) NOT NULL DEFAULT 'review' CHECK (severity IN ('info','review','urgent')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  UNIQUE(mother_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS clinical_flags_mother_status ON clinical_flags(mother_id, status, severity);
CREATE INDEX IF NOT EXISTS clinical_flags_doctor ON clinical_flags(doctor_id, status);

CREATE TABLE IF NOT EXISTS clinical_flag_events (
  id SERIAL PRIMARY KEY,
  flag_id INTEGER NOT NULL REFERENCES clinical_flags(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event VARCHAR(30) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS clinical_flag_events_flag ON clinical_flag_events(flag_id, created_at);

CREATE TABLE IF NOT EXISTS clinical_actions (
  id SERIAL PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action_key VARCHAR(120) NOT NULL,
  title VARCHAR(240) NOT NULL,
  detail TEXT,
  source VARCHAR(40) NOT NULL DEFAULT 'rule',
  record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','completed','deferred','not_applicable','follow_up')),
  status_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mother_id, action_key)
);
CREATE INDEX IF NOT EXISTS clinical_actions_mother_status ON clinical_actions(mother_id, status);

COMMIT;
