-- O. Patient-friendly visit summary. The clinician writes and approves every word. A summary is shown to
-- the patient only while it is 'approved'. Editing starts a new draft; approving it supersedes the old one.
-- No field generates or stores a prescription: medicines and doses belong on the signed prescription.
CREATE TABLE IF NOT EXISTS visit_summaries (
  id               SERIAL PRIMARY KEY,
  appointment_id   INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  mother_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL DEFAULT 0,
  status           VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded')),
  summary_text     VARCHAR(1200),
  next_steps       JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up        JSONB NOT NULL DEFAULT '{}'::jsonb,
  pending_tests    JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_at      TIMESTAMPTZ,
  approved_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  patient_seen_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS visit_summaries_one_draft ON visit_summaries(appointment_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS visit_summaries_one_approved ON visit_summaries(appointment_id) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS visit_summaries_mother ON visit_summaries(mother_id, status);
