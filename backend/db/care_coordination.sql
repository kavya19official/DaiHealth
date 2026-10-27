-- C. Sustainability-aware care coordination.
-- Every table records what happened; none of them claims an environmental or clinical outcome on its own.

-- Digital-first instructions written and verified by a clinician. Patients see only 'verified' packs.
-- in_person_required keeps clinically necessary visits explicit: a digital pack never replaces them.
CREATE TABLE IF NOT EXISTS care_instruction_packs (
  id                 SERIAL PRIMARY KEY,
  mother_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id     INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  kind               VARCHAR(24) NOT NULL CHECK (kind IN ('visit_instructions','test_preparation','follow_up_summary')),
  title              VARCHAR(160) NOT NULL,
  body               VARCHAR(2000) NOT NULL,
  in_person_required BOOLEAN NOT NULL DEFAULT FALSE,
  in_person_reason   VARCHAR(300),
  status             VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','verified','withdrawn')),
  verified_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at        TIMESTAMPTZ,
  patient_seen_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT in_person_required OR in_person_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS care_instruction_packs_mother ON care_instruction_packs(mother_id, status);
CREATE INDEX IF NOT EXISTS care_instruction_packs_doctor ON care_instruction_packs(doctor_id, created_at DESC);

-- Patient self-report on whether a verified pack saved a trip or paperwork. Self-reported, never inferred.
CREATE TABLE IF NOT EXISTS care_pack_feedback (
  pack_id    INTEGER NOT NULL REFERENCES care_instruction_packs(id) ON DELETE CASCADE,
  mother_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outcome    VARCHAR(24) NOT NULL CHECK (outcome IN ('avoided_trip','avoided_paperwork','still_needed_visit','unclear')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pack_id, mother_id)
);

-- Whether a referral reached the right facility first time, or needed repeated searching / a failed visit.
CREATE TABLE IF NOT EXISTS referral_journeys (
  id                SERIAL PRIMARY KEY,
  mother_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recorded_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recorder_role     VARCHAR(10) NOT NULL CHECK (recorder_role IN ('mother','doctor')),
  facility_id       INTEGER REFERENCES facilities(id) ON DELETE SET NULL,
  referral_id       INTEGER REFERENCES referrals(id) ON DELETE SET NULL,
  care_need         VARCHAR(100) NOT NULL,
  capability_matched BOOLEAN,
  prior_searches    INTEGER CHECK (prior_searches BETWEEN 0 AND 20),
  outcome           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (outcome IN ('pending','seen_first_visit','redirected','failed_visit','not_attended')),
  failure_reason    VARCHAR(30) CHECK (failure_reason IN ('capability_unavailable','closed_or_no_slot','turned_away','transport','cost','other')),
  note              VARCHAR(300),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS referral_journeys_mother ON referral_journeys(mother_id, created_at DESC);

-- A clinician's decision about a test when a prior report exists (or does not). The clinician always decides.
CREATE TABLE IF NOT EXISTS test_reuse_decisions (
  id          SERIAL PRIMARY KEY,
  mother_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES patient_documents(id) ON DELETE SET NULL,
  test_name   VARCHAR(100) NOT NULL,
  decision    VARCHAR(30) NOT NULL CHECK (decision IN ('prior_result_used','repeat_clinically_indicated','repeat_prior_unavailable','repeat_other')),
  reason      VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS test_reuse_decisions_doctor ON test_reuse_decisions(doctor_id, created_at DESC);

-- Preventive follow-up actions on a care gap and what happened next. Used to evaluate, not to claim, prevention.
CREATE TABLE IF NOT EXISTS preventive_followup_events (
  id                     SERIAL PRIMARY KEY,
  mother_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gap_key                VARCHAR(40) NOT NULL,
  action                 VARCHAR(20) NOT NULL CHECK (action IN ('reminder_sent','contacted','booked')),
  outcome                VARCHAR(20) NOT NULL CHECK (outcome IN ('pending','completed','rescheduled','unreachable','declined')),
  emergency_use_reported BOOLEAN NOT NULL DEFAULT FALSE,
  note                   VARCHAR(300),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS preventive_followup_events_doctor ON preventive_followup_events(doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS preventive_followup_events_gap ON preventive_followup_events(mother_id, gap_key);
