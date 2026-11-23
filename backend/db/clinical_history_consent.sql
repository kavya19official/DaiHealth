-- Additional profile/history fields require a new explicit choice; existing grants stay limited.
ALTER TABLE clinical_dashboard_consent ADD COLUMN IF NOT EXISTS include_history BOOLEAN NOT NULL DEFAULT FALSE;
