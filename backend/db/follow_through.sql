-- L. Postpartum and child follow-through: a recorded reason when a postnatal visit or a vaccine is
-- delayed. Completion stays in postpartum_contacts / child_vaccinations. A delay row never counts as
-- "done" and is ignored once the item is completed. Run AFTER patient_support.sql (it rebuilds the
-- notifications category list that file defines).
CREATE TABLE IF NOT EXISTS follow_through_delays (
  id            SERIAL PRIMARY KEY,
  mother_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id      INTEGER REFERENCES children(id) ON DELETE CASCADE,
  kind          VARCHAR(20) NOT NULL CHECK (kind IN ('postpartum_contact','vaccine')),
  item_code     VARCHAR(30) NOT NULL,
  reason        VARCHAR(30) NOT NULL,
  note          VARCHAR(300),
  new_target    DATE,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS follow_through_delays_item
  ON follow_through_delays (mother_id, kind, item_code, COALESCE(child_id, 0));

-- Postnatal visit reminders use a new notification category (existing categories are kept).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('vaccine','appointment','growth','milestone','care_plan','system','scheme','report','document','hospital','postpartum'));
