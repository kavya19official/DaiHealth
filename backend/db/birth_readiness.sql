-- Patient-controlled preparation checklist. This is deliberately separate from
-- clinical observations: it records practical planning, not medical risk.
CREATE TABLE IF NOT EXISTS birth_readiness_items (
  mother_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key     VARCHAR(50) NOT NULL CHECK (item_key IN (
    'facility_selected','transport_arranged','emergency_contact',
    'blood_support','documents_ready','danger_signs_understood','benefits_started'
  )),
  completed    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by   INTEGER NOT NULL REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (mother_id, item_key)
);

CREATE TABLE IF NOT EXISTS birth_readiness_events (
  id                 BIGSERIAL PRIMARY KEY,
  mother_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id           INTEGER NOT NULL REFERENCES users(id),
  event_type         VARCHAR(40) NOT NULL CHECK (event_type IN ('self_view','item_updated','doctor_view','doctor_view_blocked')),
  item_key           VARCHAR(50),
  previous_completed BOOLEAN,
  completed          BOOLEAN,
  details            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_birth_readiness_events_mother
  ON birth_readiness_events(mother_id, created_at DESC);
