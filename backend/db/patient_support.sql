-- Personal scheme checklist only; never proof of government eligibility or payment.
CREATE TABLE IF NOT EXISTS patient_support_progress (
 mother_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 scheme_id VARCHAR(30) NOT NULL,
 step INTEGER NOT NULL DEFAULT 0 CHECK(step BETWEEN 0 AND 4),
 documents JSONB NOT NULL DEFAULT '{}'::jsonb,
 reminder_on DATE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(mother_id,scheme_id)
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK(category IN ('vaccine','appointment','growth','milestone','care_plan','system','scheme','report','document','hospital'));
