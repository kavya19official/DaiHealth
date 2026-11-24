BEGIN;

CREATE TABLE IF NOT EXISTS pregnancy_library_journeys (
  id UUID PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  due_date DATE NOT NULL,
  birth_date DATE,
  demo_seeded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  UNIQUE (id, mother_id)
);
CREATE INDEX IF NOT EXISTS pregnancy_library_journeys_owner
  ON pregnancy_library_journeys (mother_id, start_date DESC);

CREATE TABLE IF NOT EXISTS pregnancy_library_entries (
  id UUID PRIMARY KEY,
  mother_id INTEGER NOT NULL,
  journey_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'diary', 'letter')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK (char_length(body) <= 8000),
  entry_date DATE NOT NULL,
  week SMALLINT NOT NULL CHECK (week BETWEEN 1 AND 41),
  tags TEXT[] NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, mother_id),
  FOREIGN KEY (journey_id, mother_id) REFERENCES pregnancy_library_journeys(id, mother_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pregnancy_library_entries_owner
  ON pregnancy_library_entries (mother_id, journey_id, entry_date DESC, id);

CREATE TABLE IF NOT EXISTS pregnancy_library_media (
  id UUID PRIMARY KEY,
  mother_id INTEGER NOT NULL,
  entry_id UUID NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/webp', 'video/mp4')),
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 7),
  data BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 20971520),
  size_bytes INTEGER GENERATED ALWAYS AS (octet_length(data)) STORED,
  FOREIGN KEY (entry_id, mother_id) REFERENCES pregnancy_library_entries(id, mother_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pregnancy_library_media_owner
  ON pregnancy_library_media (mother_id, entry_id, position);

CREATE TABLE IF NOT EXISTS pregnancy_library_moments (
  journey_id UUID NOT NULL,
  mother_id INTEGER NOT NULL,
  code TEXT NOT NULL CHECK (code IN ('ultrasound', 'heartbeat', 'kick', 'shower', 'birth')),
  recorded_on DATE NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (journey_id, code),
  FOREIGN KEY (journey_id, mother_id) REFERENCES pregnancy_library_journeys(id, mother_id) ON DELETE CASCADE
);

COMMIT;
