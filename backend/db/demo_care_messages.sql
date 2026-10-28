-- Local synthetic-demo communication only; no external delivery or AI processing.
CREATE TABLE IF NOT EXISTS demo_care_messages (
 id BIGSERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_id UUID NOT NULL,
 body TEXT NOT NULL CHECK(char_length(body) BETWEEN 1 AND 2000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(sender_id,client_id)
);
CREATE INDEX IF NOT EXISTS demo_care_messages_thread ON demo_care_messages(mother_id,doctor_id,id DESC);
