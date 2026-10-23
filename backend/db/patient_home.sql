-- Personal check-ins are self-reported, never clinician-entered measurements.
CREATE TABLE IF NOT EXISTS patient_daily_checkins (
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 check_date DATE NOT NULL,
 tasks JSONB NOT NULL DEFAULT '{}'::jsonb,
 mood VARCHAR(20) CHECK(mood IN ('good','okay','low','worried')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(mother_id,check_date)
);
CREATE TABLE IF NOT EXISTS patient_journal (
 id SERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 entry_date DATE NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 photo_document_id INTEGER REFERENCES patient_documents(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(length(note)<=2000)
);
CREATE INDEX IF NOT EXISTS patient_journal_owner ON patient_journal(mother_id,entry_date DESC,id DESC);
CREATE TABLE IF NOT EXISTS patient_baby_logs (
 id SERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 event_type VARCHAR(12) NOT NULL CHECK(event_type IN ('feed','sleep')),
 started_at TIMESTAMPTZ NOT NULL,
 duration_min NUMERIC CHECK(duration_min>0 AND duration_min<=1440),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS patient_baby_log_owner ON patient_baby_logs(mother_id,child_id,started_at DESC);
