-- The milestone table remains the legacy write projection. Reads can be rebuilt
-- from these append-only change records, including writes from older API routes.
CREATE TABLE IF NOT EXISTS timeline_change_events (
 id BIGSERIAL PRIMARY KEY,
 mother_id INTEGER NOT NULL,
 milestone_id INTEGER NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('snapshot','INSERT','UPDATE','DELETE')),
 payload JSONB NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS timeline_events_patient ON timeline_change_events(mother_id,id);
CREATE OR REPLACE FUNCTION dai_capture_timeline() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.mother_id<>NEW.mother_id THEN
  INSERT INTO timeline_change_events(mother_id,milestone_id,operation,payload) VALUES(OLD.mother_id,OLD.id,'DELETE',to_jsonb(OLD));
 END IF;
 IF TG_OP='DELETE' THEN
  INSERT INTO timeline_change_events(mother_id,milestone_id,operation,payload) VALUES(OLD.mother_id,OLD.id,TG_OP,to_jsonb(OLD)); RETURN OLD;
 END IF;
 INSERT INTO timeline_change_events(mother_id,milestone_id,operation,payload) VALUES(NEW.mother_id,NEW.id,TG_OP,to_jsonb(NEW)); RETURN NEW;
END $$;
INSERT INTO timeline_change_events(mother_id,milestone_id,operation,payload)
 SELECT m.mother_id,m.id,'snapshot',to_jsonb(m) FROM care_milestones m
 WHERE NOT EXISTS(SELECT 1 FROM timeline_change_events e WHERE e.milestone_id=m.id AND e.mother_id=m.mother_id);
DROP TRIGGER IF EXISTS dai_timeline_changes ON care_milestones;
CREATE TRIGGER dai_timeline_changes AFTER INSERT OR UPDATE OR DELETE ON care_milestones FOR EACH ROW EXECUTE FUNCTION dai_capture_timeline();
CREATE TABLE IF NOT EXISTS timeline_chain_heads (
 mother_id INTEGER PRIMARY KEY, sequence BIGINT NOT NULL DEFAULT 0, head_hash TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS timeline_event_seals (
 event_id BIGINT PRIMARY KEY REFERENCES timeline_change_events(id),mother_id INTEGER NOT NULL,
 sequence BIGINT NOT NULL,previous_hash TEXT NOT NULL,event_hash TEXT NOT NULL,
 UNIQUE(mother_id,sequence)
);
CREATE OR REPLACE FUNCTION dai_immutable_timeline() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Timeline event history is append-only'; END $$;
DROP TRIGGER IF EXISTS immutable_timeline_events ON timeline_change_events;
CREATE TRIGGER immutable_timeline_events BEFORE UPDATE OR DELETE ON timeline_change_events FOR EACH ROW EXECUTE FUNCTION dai_immutable_timeline();
DROP TRIGGER IF EXISTS immutable_timeline_seals ON timeline_event_seals;
CREATE TRIGGER immutable_timeline_seals BEFORE UPDATE OR DELETE ON timeline_event_seals FOR EACH ROW EXECUTE FUNCTION dai_immutable_timeline();
CREATE TABLE IF NOT EXISTS timeline_summary_shares (
 id BIGSERIAL PRIMARY KEY,mother_id INTEGER NOT NULL REFERENCES users(id),
 doctor_id INTEGER NOT NULL REFERENCES users(id),token_hash TEXT NOT NULL UNIQUE,
 snapshot JSONB NOT NULL,signature TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),sensitive_consent BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS timeline_summary_reads (
 id BIGSERIAL PRIMARY KEY,share_id BIGINT NOT NULL REFERENCES timeline_summary_shares(id),
 actor_id INTEGER NOT NULL REFERENCES users(id),read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
