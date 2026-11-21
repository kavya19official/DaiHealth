CREATE TABLE IF NOT EXISTS postpartum_wellbeing_screens (
 id UUID PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 answers JSONB NOT NULL,
 score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 6),
 instrument TEXT NOT NULL DEFAULT 'PHQ-2',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 review_id UUID REFERENCES clinical_review_requests(id) ON DELETE SET NULL,
 shared_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS postpartum_screen_owner ON postpartum_wellbeing_screens(mother_id,created_at DESC);
ALTER TABLE patient_baby_logs DROP CONSTRAINT IF EXISTS patient_baby_logs_event_type_check;
ALTER TABLE patient_baby_logs ADD CONSTRAINT patient_baby_logs_event_type_check
 CHECK(event_type IN ('feed','sleep','wet','dirty','mixed'));
ALTER TABLE patient_baby_logs ADD COLUMN IF NOT EXISTS feeding_type TEXT
 CHECK(feeding_type IN ('breast','expressed','formula','other'));
