-- Per-account inbox cursor. Message content remains in demo_care_messages only.
CREATE TABLE IF NOT EXISTS demo_care_message_reads (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 peer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 last_read_id BIGINT NOT NULL DEFAULT 0 CHECK(last_read_id >= 0),
 PRIMARY KEY(user_id,peer_id)
);
