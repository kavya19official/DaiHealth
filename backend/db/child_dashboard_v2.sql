-- ============================================================================
-- Vaccination certificates + Notification Center
--
-- Apply AFTER child_dashboard.sql.
--   psql "$DATABASE_URL" -f backend/db/child_dashboard_v2.sql
-- Every statement is idempotent, so it is safe to re-run.
-- ============================================================================

BEGIN;

-- One certificate photo/PDF per dose given. A dose must already be marked
-- given (child_vaccinations row must exist) before a certificate can attach
-- to it — hence the FK straight to that table, not to children.
CREATE TABLE IF NOT EXISTS child_vaccination_certificates (
  child_id      INTEGER NOT NULL,
  vaccine_code  VARCHAR(20) NOT NULL,
  mime_type     VARCHAR(20) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  original_name VARCHAR(200) NOT NULL,
  size_bytes    INTEGER NOT NULL,
  data          BYTEA NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, vaccine_code),
  FOREIGN KEY (child_id, vaccine_code) REFERENCES child_vaccinations (child_id, vaccine_code) ON DELETE CASCADE
);

-- ----------------------------------------------------------------------------
-- Notification Center
--
-- Rows are computed, not typed by hand: on every GET /api/notifications, the
-- server re-derives the current set of things worth notifying about (a
-- vaccine due tomorrow, one that just became missed, an appointment coming
-- up, a low-weight flag, a care-timeline item due) and upserts them here by a
-- stable dedupe_key, so the same condition never creates two rows and a
-- condition that stops being true is removed automatically if unread, or left
-- in place (so the read history isn't rewritten) if the mother already saw it.
-- read_at/dismissed_at are the only fields a client ever changes directly.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key    VARCHAR(160) NOT NULL,
  severity      VARCHAR(10) NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'danger')),
  category      VARCHAR(20) NOT NULL CHECK (category IN ('vaccine', 'appointment', 'growth', 'milestone', 'care_plan', 'system')),
  title         VARCHAR(200) NOT NULL,
  body          VARCHAR(500),
  route         VARCHAR(30),          -- which page this should open, e.g. 'child', 'appointments'
  route_sub     VARCHAR(30),          -- e.g. 'vaccines'
  child_id      INTEGER REFERENCES children(id) ON DELETE CASCADE,
  event_date    DATE,                 -- the due/appointment date the notification is about, for sorting and "today" grouping
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at       TIMESTAMPTZ,
  dismissed_at  TIMESTAMPTZ,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_active
  ON notifications (user_id, dismissed_at, created_at DESC);

COMMIT;
