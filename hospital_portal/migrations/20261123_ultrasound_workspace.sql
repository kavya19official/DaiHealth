BEGIN;
CREATE TABLE IF NOT EXISTS ultrasound_workspace_scan (
    id uuid PRIMARY KEY,
    source_id varchar UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    patient_account_id integer NOT NULL,
    doctor_account_id integer NOT NULL,
    facility_ref varchar NOT NULL,
    episode varchar NOT NULL,
    image_digest varchar NOT NULL,
    image_ciphertext bytea,
    image_expires_at timestamptz NOT NULL,
    pregnancy_context json NOT NULL,
    analysis json NOT NULL,
    revision integer NOT NULL,
    started_at timestamptz,
    reviewed_at timestamptz,
    released_at timestamptz,
    decision varchar,
    review_note varchar,
    findings varchar,
    instructions varchar,
    UNIQUE (patient_account_id, episode, doctor_account_id, facility_ref, image_digest)
);
CREATE INDEX IF NOT EXISTS ultrasound_workspace_patient
    ON ultrasound_workspace_scan (patient_account_id, created_at);
CREATE INDEX IF NOT EXISTS ultrasound_workspace_queue
    ON ultrasound_workspace_scan (doctor_account_id, released_at, created_at);
CREATE INDEX IF NOT EXISTS ultrasound_workspace_expiry
    ON ultrasound_workspace_scan (image_expires_at) WHERE image_ciphertext IS NOT NULL;
COMMIT;
