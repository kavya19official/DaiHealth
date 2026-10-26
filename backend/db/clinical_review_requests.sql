CREATE TABLE IF NOT EXISTS clinical_review_requests (
 id UUID PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('pregnancy_risk','clinical_recommendation','document_interpretation')),
 document_id INTEGER REFERENCES patient_documents(id),
 summary TEXT NOT NULL CHECK(length(summary)<=1000),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','review_recorded','escalated','closed')),
 reviewer_id INTEGER REFERENCES users(id),
 review_note TEXT,
 evidence_ref TEXT,
 version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_clinical_review ON clinical_review_requests(mother_id,kind,COALESCE(document_id,0)) WHERE state IN ('pending','escalated');
CREATE TABLE IF NOT EXISTS clinical_review_events (
 id SERIAL PRIMARY KEY,
 request_id UUID NOT NULL REFERENCES clinical_review_requests(id),
 actor_id INTEGER NOT NULL REFERENCES users(id),
 action TEXT NOT NULL,
 note TEXT NOT NULL,
 evidence_ref TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
