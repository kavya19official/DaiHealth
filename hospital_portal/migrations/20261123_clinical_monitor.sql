BEGIN;

-- Clinical monitoring review artefacts. Flags are evidence-bound suggestions for
-- clinician review; they never modify diagnoses, care plans or confirmed risk.
CREATE TABLE IF NOT EXISTS clinical_monitor_run (
  id UUID PRIMARY KEY,
  source_id VARCHAR UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mother_id UUID NOT NULL REFERENCES mother(id),
  as_of VARCHAR NOT NULL,
  coverage JSON NOT NULL,
  trends JSON NOT NULL,
  UNIQUE (mother_id)
);

CREATE TABLE IF NOT EXISTS clinical_monitor_flag (
  id UUID PRIMARY KEY,
  source_id VARCHAR UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mother_id UUID NOT NULL REFERENCES mother(id),
  rule_key VARCHAR NOT NULL,
  rule_version VARCHAR NOT NULL,
  priority INTEGER NOT NULL,
  summary VARCHAR NOT NULL,
  action VARCHAR NOT NULL,
  reference_url VARCHAR NOT NULL,
  fingerprint VARCHAR NOT NULL,
  evidence JSON NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  reviewed_by UUID REFERENCES portal_user(id),
  review_note VARCHAR,
  reviewed_at TIMESTAMPTZ,
  UNIQUE (mother_id, rule_key)
);

CREATE INDEX IF NOT EXISTS clinical_monitor_flag_queue
  ON clinical_monitor_flag (active, reviewed_at, priority DESC, updated_at DESC);

COMMIT;
