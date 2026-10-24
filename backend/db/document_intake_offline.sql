CREATE TABLE IF NOT EXISTS document_intake_drafts (
 id UUID PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES patient_documents(id),
 created_by INTEGER NOT NULL REFERENCES users(id), source_sha256 TEXT NOT NULL,
 source_text TEXT NOT NULL, candidates JSONB NOT NULL, warnings JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','verified')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS verified_report_records (
 id UUID PRIMARY KEY, draft_id UUID UNIQUE NOT NULL REFERENCES document_intake_drafts(id),
 document_id INTEGER NOT NULL REFERENCES patient_documents(id), mother_id INTEGER NOT NULL REFERENCES users(id),
 report_date DATE NOT NULL, document_type TEXT NOT NULL, observations JSONB NOT NULL,
 verified_by INTEGER NOT NULL REFERENCES users(id), review_note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS patient_offline_mutations (
 user_id INTEGER NOT NULL REFERENCES users(id), mutation_id UUID NOT NULL,
 payload_hash TEXT NOT NULL, result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,mutation_id)
);
