BEGIN;

CREATE TABLE IF NOT EXISTS ultrasound_analysis (
  id UUID PRIMARY KEY,
  source_id VARCHAR UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mother_id UUID NOT NULL REFERENCES mother(id),
  facility_id UUID NOT NULL REFERENCES facility(id),
  uploaded_by UUID NOT NULL REFERENCES portal_user(id),
  episode VARCHAR NOT NULL,
  image_digest VARCHAR NOT NULL,
  image_ciphertext BYTEA,
  image_expires_at TIMESTAMPTZ NOT NULL,
  pregnancy_context JSON NOT NULL,
  analysis JSON NOT NULL,
  priority INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  reviewed_by UUID REFERENCES portal_user(id),
  reviewed_at TIMESTAMPTZ,
  decision VARCHAR,
  review_note VARCHAR,
  UNIQUE (mother_id, facility_id, episode, image_digest)
);

CREATE INDEX IF NOT EXISTS ultrasound_facility_queue
  ON ultrasound_analysis (facility_id, reviewed_at, priority, created_at);
CREATE INDEX IF NOT EXISTS ultrasound_image_expiry
  ON ultrasound_analysis (image_expires_at) WHERE image_ciphertext IS NOT NULL;

COMMIT;
