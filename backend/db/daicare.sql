BEGIN;
CREATE TABLE IF NOT EXISTS daicare_directory (
 doctor_id INTEGER PRIMARY KEY REFERENCES doctor_profiles(user_id) ON DELETE CASCADE,
 council TEXT NOT NULL, registration_number TEXT NOT NULL, qualification TEXT NOT NULL,
 city TEXT NOT NULL, state TEXT NOT NULL, public_contact TEXT NOT NULL,
 languages JSONB NOT NULL DEFAULT '[]',
 pincodes JSONB NOT NULL DEFAULT '[]',
 modes JSONB NOT NULL DEFAULT '[]',
 mental_health BOOLEAN NOT NULL DEFAULT FALSE,
 verified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 verification_ref TEXT NOT NULL,
 suspended_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS daicare_council_registration
 ON daicare_directory (lower(council),lower(registration_number));
CREATE TABLE IF NOT EXISTS daicare_slots (
 id UUID PRIMARY KEY, doctor_id INTEGER NOT NULL REFERENCES daicare_directory(doctor_id),
 starts_at TIMESTAMPTZ NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('home','audio','video')),
 UNIQUE(doctor_id,starts_at)
);
CREATE TABLE IF NOT EXISTS daicare_visits (
 id UUID PRIMARY KEY, slot_id UUID NOT NULL REFERENCES daicare_slots(id),
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 pincode TEXT, address TEXT,
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','confirmed','completed','cancelled')),
 patient_consent_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 revoked_at TIMESTAMPTZ, follow_up_on DATE, follow_up TEXT, follow_up_seen_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS daicare_one_live_booking ON daicare_visits(slot_id) WHERE status<>'cancelled';
CREATE INDEX IF NOT EXISTS daicare_patient_visits ON daicare_visits(mother_id,created_at DESC);
CREATE TABLE IF NOT EXISTS daicare_on_call (
 id UUID PRIMARY KEY, doctor_id INTEGER NOT NULL REFERENCES daicare_directory(doctor_id),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL CHECK(ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS daicare_on_call_shift ON daicare_on_call(starts_at,ends_at);
CREATE TABLE IF NOT EXISTS daicare_epds (
 id UUID PRIMARY KEY, mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 answers JSONB NOT NULL, score SMALLINT NOT NULL CHECK(score BETWEEN 0 AND 30),
 item_ten SMALLINT NOT NULL CHECK(item_ten BETWEEN 0 AND 3),
 ai_status TEXT NOT NULL DEFAULT 'not_requested' CHECK(ai_status IN ('not_requested','pending','review','no_additional_flag','unavailable')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS daicare_epds_history ON daicare_epds(mother_id,created_at DESC);
CREATE TABLE IF NOT EXISTS daicare_mood (
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 logged_on DATE NOT NULL, mood SMALLINT NOT NULL CHECK(mood BETWEEN 1 AND 5),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(mother_id,logged_on)
);
CREATE TABLE IF NOT EXISTS daicare_referrals (
 screen_id UUID PRIMARY KEY REFERENCES daicare_epds(id) ON DELETE CASCADE,
 doctor_id INTEGER REFERENCES daicare_directory(doctor_id), shift_id UUID REFERENCES daicare_on_call(id),
 status TEXT NOT NULL CHECK(status IN ('waiting','assigned','acknowledged','resolved','withdrawn')),
 consent_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 assigned_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
 clinician_note TEXT
);
CREATE INDEX IF NOT EXISTS daicare_referral_queue ON daicare_referrals(doctor_id,status);
CREATE OR REPLACE FUNCTION dai_audit_access_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_actor INTEGER;
BEGIN
  PERFORM dai_audit_head_lock(NEW.mother_id);
  v_actor := CASE WHEN left(NEW.event_type,8)='daicare_' THEN NULLIF(NEW.details->>'actor_id','')::int
                  WHEN NEW.details->>'doctor_id' ~ '^-?[0-9]+$' THEN (NEW.details->>'doctor_id')::int
                  WHEN NEW.details->>'actor_id' ~ '^-?[0-9]+$' THEN (NEW.details->>'actor_id')::int END;
  INSERT INTO consent_audit_events(mother_id,source,event_type,actor_id,subject_type,subject_ref,payload,occurred_at)
  VALUES(NEW.mother_id,'access_event',NEW.event_type,v_actor,
         CASE WHEN v_actor IS NOT NULL THEN 'user' END, NULLIF(COALESCE(NEW.details->>'doctor_id',NEW.details->>'actor_id'),''),
         NEW.details,NEW.created_at);
  RETURN NEW;
END $$;
COMMIT;
