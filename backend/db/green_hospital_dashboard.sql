-- ============================================================================
-- Green Hospital Dashboard — schema
--
-- Tracks sustainability metrics for participating hospitals with transparent
-- data quality labeling and comparable indicators.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- green_metrics
-- Monthly resource and sustainability metrics per facility
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS green_metrics (
  id              SERIAL PRIMARY KEY,
  facility_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reporting_month DATE NOT NULL, -- First day of the month
  metric_type     VARCHAR(30) NOT NULL CHECK (metric_type IN (
    'water_use', 'electricity_use', 'energy_intensity',
    'waste_total', 'waste_recycled', 'biomedical_waste',
    'paper_use', 'digital_records', 'teleconsultations',
    'patient_journeys', 'repeat_journeys'
  )),
  value           NUMERIC(15,2) NOT NULL,
  unit            VARCHAR(20) NOT NULL, -- e.g., 'kL', 'kWh', 'kg', 'count'
  denominator     NUMERIC(15,2), -- For intensity metrics (e.g., occupied bed-days)
  denominator_unit VARCHAR(20), -- e.g., 'bed-days'
  data_quality    VARCHAR(20) NOT NULL DEFAULT 'facility_reported'
                   CHECK (data_quality IN ('measured', 'facility_reported', 'estimated', 'unavailable')),
  data_source     VARCHAR(100),
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(facility_id, reporting_month, metric_type)
);

CREATE INDEX IF NOT EXISTS idx_green_metrics_facility_month
  ON green_metrics (facility_id, reporting_month DESC, metric_type);

CREATE INDEX IF NOT EXISTS idx_green_metrics_type
  ON green_metrics (metric_type, reporting_month DESC);

-- ----------------------------------------------------------------------------
-- green_actions
-- Staff-logged sustainability actions with targets and progress
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS green_actions (
  id              SERIAL PRIMARY KEY,
  facility_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type     VARCHAR(50) NOT NULL CHECK (action_type IN (
    'water_efficiency', 'energy_efficiency', 'waste_reduction',
    'digital_workflow', 'travel_optimization', 'building_upgrade',
    'equipment_maintenance', 'process_improvement', 'other'
  )),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  responsible_person VARCHAR(255),
  baseline_value   NUMERIC(15,2),
  baseline_unit   VARCHAR(20),
  target_value    NUMERIC(15,2),
  target_unit     VARCHAR(20),
  target_date     DATE,
  current_value   NUMERIC(15,2),
  current_unit    VARCHAR(20),
  status          VARCHAR(20) NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned', 'in_progress', 'completed', 'on_hold', 'cancelled')),
  completion_date DATE,
  evidence_url     VARCHAR(500),
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_green_actions_facility
  ON green_actions (facility_id, status, target_date);

CREATE INDEX IF NOT EXISTS idx_green_actions_type
  ON green_actions (action_type, status);

-- ----------------------------------------------------------------------------
-- green_alerts
-- Automated alerts for unusual consumption or maintenance needs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS green_alerts (
  id              SERIAL PRIMARY KEY,
  facility_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_type      VARCHAR(30) NOT NULL CHECK (alert_type IN (
    'water_spike', 'electricity_spike', 'waste_anomaly',
    'maintenance_needed', 'leak_detected', 'efficiency_drop'
  )),
  severity        VARCHAR(20) NOT NULL DEFAULT 'medium'
                   CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  metric_type     VARCHAR(30),
  expected_value  NUMERIC(15,2),
  actual_value    NUMERIC(15,2),
  threshold_percent NUMERIC(5,2),
  message         TEXT NOT NULL,
  resolved        BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMP,
  resolved_by     INTEGER REFERENCES users(id),
  resolution_notes TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_green_alerts_facility
  ON green_alerts (facility_id, resolved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_green_alerts_severity
  ON green_alerts (severity, resolved, created_at DESC);

-- ----------------------------------------------------------------------------
-- Update triggers for updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_green_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_green_metrics_updated_at ON green_metrics;
CREATE TRIGGER trg_green_metrics_updated_at
  BEFORE UPDATE ON green_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_green_updated_at();

DROP TRIGGER IF EXISTS trg_green_actions_updated_at ON green_actions;
CREATE TRIGGER trg_green_actions_updated_at
  BEFORE UPDATE ON green_actions
  FOR EACH ROW
  EXECUTE FUNCTION update_green_updated_at();

COMMIT;
