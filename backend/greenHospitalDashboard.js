'use strict';

/**
 * Green Hospital Dashboard API
 *
 * Provides endpoints for:
 * - Resource tracking (water, electricity, energy, waste)
 * - Water-efficiency actions and alerts
 * - Energy and cooling tracking
 * - Waste-smart workflows
 * - Travel and service efficiency metrics
 * - Green actions register with progress tracking
 * - Transparent status with data quality labeling
 */

module.exports = function(app, { pool, authenticateToken, authorizeRole }) {

  // ============================================================================
  // Helper Functions
  // ============================================================================

  const validateMetricType = (type) => {
    const validTypes = [
      'water_use', 'electricity_use', 'energy_intensity',
      'waste_total', 'waste_recycled', 'biomedical_waste',
      'paper_use', 'digital_records', 'teleconsultations',
      'patient_journeys', 'repeat_journeys'
    ];
    return validTypes.includes(type);
  };

  const validateActionType = (type) => {
    const validTypes = [
      'water_efficiency', 'energy_efficiency', 'waste_reduction',
      'digital_workflow', 'travel_optimization', 'building_upgrade',
      'equipment_maintenance', 'process_improvement', 'other'
    ];
    return validTypes.includes(type);
  };

  // ============================================================================
  // Public API: Hospital/Admin - Resource Metrics
  // ============================================================================

  // Get metrics for a facility
  app.get('/api/green/metrics', authenticateToken, authorizeRole(['hospital', 'admin']), async (req, res) => {
    try {
      const { metric_type, start_month, end_month, limit = 12 } = req.query;
      const facilityId = req.user.id;

      let query = `
        SELECT id, reporting_month, metric_type, value, unit,
               denominator, denominator_unit, data_quality, data_source, notes, created_at
        FROM green_metrics
        WHERE facility_id = $1
      `;
      const params = [facilityId];
      let paramCount = 1;

      if (metric_type && validateMetricType(metric_type)) {
        paramCount++;
        query += ` AND metric_type = $${paramCount}`;
        params.push(metric_type);
      }

      if (start_month) {
        paramCount++;
        query += ` AND reporting_month >= $${paramCount}`;
        params.push(start_month);
      }

      if (end_month) {
        paramCount++;
        query += ` AND reporting_month <= $${paramCount}`;
        params.push(end_month);
      }

      query += ` ORDER BY reporting_month DESC, metric_type ASC LIMIT $${paramCount + 1}`;
      params.push(parseInt(limit, 10));

      const result = await pool.query(query, params);
      res.json({ metrics: result.rows });
    } catch (error) {
      console.error('Fetch green metrics error:', error);
      res.status(500).json({ error: 'Failed to fetch green metrics' });
    }
  });

  // Add or update a metric
  app.post('/api/green/metrics', authenticateToken, authorizeRole(['hospital', 'admin']), async (req, res) => {
    try {
      const {
        reporting_month, metric_type, value, unit,
        denominator, denominator_unit, data_quality, data_source, notes
      } = req.body;

      if (!reporting_month || !metric_type || !value || !unit) {
        return res.status(400).json({ error: 'Reporting month, metric type, value, and unit are required' });
      }

      if (!validateMetricType(metric_type)) {
        return res.status(400).json({ error: 'Invalid metric type' });
      }

      const validQualities = ['measured', 'facility_reported', 'estimated', 'unavailable'];
      if (data_quality && !validQualities.includes(data_quality)) {
        return res.status(400).json({ error: 'Invalid data quality' });
      }

      const result = await pool.query(
        `INSERT INTO green_metrics
         (facility_id, reporting_month, metric_type, value, unit,
          denominator, denominator_unit, data_quality, data_source, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (facility_id, reporting_month, metric_type)
         DO UPDATE SET value = EXCLUDED.value,
                       unit = EXCLUDED.unit,
                       denominator = EXCLUDED.denominator,
                       denominator_unit = EXCLUDED.denominator_unit,
                       data_quality = EXCLUDED.data_quality,
                       data_source = EXCLUDED.data_source,
                       notes = EXCLUDED.notes,
                       updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [
          req.user.id, reporting_month, metric_type, value, unit,
          denominator || null, denominator_unit || null,
          data_quality || 'facility_reported', data_source || null, notes || null
        ]
      );

      res.status(201).json({ metric: result.rows[0] });
    } catch (error) {
      console.error('Add green metric error:', error);
      res.status(500).json({ error: 'Failed to save green metric' });
    }
  });

  // Get metrics summary for dashboard
  app.get('/api/green/summary', authenticateToken, authorizeRole(['hospital', 'admin']), async (req, res) => {
    try {
      const facilityId = req.user.id;
      const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
      const previousMonth = new Date(new Date().setMonth(new Date().getMonth() - 1))
        .toISOString().slice(0, 7) + '-01';

      const [current, previous, actions, alerts] = await Promise.all([
        pool.query(
          `SELECT metric_type, value, unit, data_quality
           FROM green_metrics
           WHERE facility_id = $1 AND reporting_month = $2`,
          [facilityId, currentMonth]
        ),
        pool.query(
          `SELECT metric_type, value, unit
           FROM green_metrics
           WHERE facility_id = $1 AND reporting_month = $2`,
          [facilityId, previousMonth]
        ),
        pool.query(
          `SELECT action_type, status, COUNT(*) as count
           FROM green_actions
           WHERE facility_id = $1
           GROUP BY action_type, status`,
          [facilityId]
        ),
        pool.query(
          `SELECT alert_type, severity, COUNT(*) as count
           FROM green_alerts
           WHERE facility_id = $1 AND resolved = false
           GROUP BY alert_type, severity`,
          [facilityId]
        )
      ]);

      res.json({
        current_month: current.rows,
        previous_month: previous.rows,
        actions: actions.rows,
        alerts: alerts.rows
      });
    } catch (error) {
      console.error('Fetch green summary error:', error);
      res.status(500).json({ error: 'Failed to fetch green summary' });
    }
  });

  // ============================================================================
  // Green Actions Register
  // ============================================================================

  // Get all green actions for a facility
  app.get('/api/green/actions', authenticateToken, authorizeRole(['hospital', 'admin']), async (req, res) => {
    try {
      const { status, action_type } = req.query;
      const facilityId = req.user.id;

      let query = `
        SELECT id, action_type, title, description, responsible_person,
               baseline_value, baseline_unit, target_value, target_unit,
               target_date, current_value, current_unit, status,
               completion_date, evidence_url, notes, created_at, updated_at
        FROM green_actions
        WHERE facility_id = $1
      `;
      const params = [facilityId];
      let paramCount = 1;

      if (status) {
        paramCount++;
        query += ` AND status = $${paramCount}`;
        params.push(status);
      }

      if (action_type && validateActionType(action_type)) {
        paramCount++;
        query += ` AND action_type = $${paramCount}`;
        params.push(action_type);
      }

      query += ` ORDER BY target_date ASC, created_at DESC`;

      const result = await pool.query(query, params);
      res.json({ actions: result.rows });
    } catch (error) {
      console.error('Fetch green actions error:', error);
      res.status(500).json({ error: 'Failed to fetch green actions' });
    }
  });

  // Create a new green action
  app.post('/api/green/actions', authenticateToken, authorizeRole(['hospital', 'admin']), async (req, res) => {
    try {
      const {
        action_type, title, description, responsible_person,
        baseline_value, baseline_unit, target_value, target_unit,
        target_date, notes
      } = req.body;

      if (!action_type || !title || !target_value) {
        return res.status(400).json({ error: 'Action type, title, and target value are required' });
      }

      if (!validateActionType(action_type)) {
        return res.status(400).json({ error: 'Invalid action type' });
      }

      const result = await pool.query(
        `INSERT INTO green_actions
         (facility_id, action_type, title, description, responsible_person,
          baseline_value, baseline_unit, target_value, target_unit, target_date, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          req.user.id, action_type, title, description || null,
          responsible_person || null, baseline_value || null, baseline_unit || null,
          target_value, target_unit || target_value.toString(), target_date || null, notes || null
        ]
      );

      res.status(201).json({ action: result.rows[0] });
    } catch (error) {
      console.error('Create green action error:', error);
      res.status(500).json({ error: 'Failed to create green action' });
    }
  });

  // Update green action progress
  app.patch('/api/green/actions/:id', authenticateToken, authorizeRole(['hospital', 'admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { current_value, current_unit, status, completion_date, evidence_url, notes } = req.body;

      const validStatuses = ['planned', 'in_progress', 'completed', 'on_hold', 'cancelled'];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const result = await pool.query(
        `UPDATE green_actions
         SET current_value = COALESCE($1, current_value),
             current_unit = COALESCE($2, current_unit),
             status = COALESCE($3, status),
             completion_date = COALESCE($4, completion_date),
             evidence_url = COALESCE($5, evidence_url),
             notes = COALESCE($6, notes),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $7 AND facility_id = $8
         RETURNING *`,
        [
          current_value || null, current_unit || null, status || null,
          completion_date || null, evidence_url || null, notes || null,
          parseInt(id, 10), req.user.id
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Action not found' });
      }

      res.json({ action: result.rows[0] });
    } catch (error) {
      console.error('Update green action error:', error);
      res.status(500).json({ error: 'Failed to update green action' });
    }
  });

  // ============================================================================
  // Green Alerts
  // ============================================================================

  // Get alerts for a facility
  app.get('/api/green/alerts', authenticateToken, authorizeRole(['hospital', 'admin']), async (req, res) => {
    try {
      const { resolved } = req.query;
      const facilityId = req.user.id;

      let query = `
        SELECT id, alert_type, severity, metric_type, expected_value,
               actual_value, threshold_percent, message, resolved,
               resolved_at, resolution_notes, created_at
        FROM green_alerts
        WHERE facility_id = $1
      `;
      const params = [facilityId];

      if (resolved !== undefined) {
        query += ` AND resolved = $2`;
        params.push(resolved === 'true');
      }

      query += ` ORDER BY created_at DESC`;

      const result = await pool.query(query, params);
      res.json({ alerts: result.rows });
    } catch (error) {
      console.error('Fetch green alerts error:', error);
      res.status(500).json({ error: 'Failed to fetch green alerts' });
    }
  });

  // Resolve an alert
  app.patch('/api/green/alerts/:id/resolve', authenticateToken, authorizeRole(['hospital', 'admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const { resolution_notes } = req.body;

      const result = await pool.query(
        `UPDATE green_alerts
         SET resolved = true,
             resolved_at = CURRENT_TIMESTAMP,
             resolved_by = $1,
             resolution_notes = $2
         WHERE id = $3 AND facility_id = $4
         RETURNING *`,
        [req.user.id, resolution_notes || null, parseInt(id, 10), req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      res.json({ alert: result.rows[0] });
    } catch (error) {
      console.error('Resolve green alert error:', error);
      res.status(500).json({ error: 'Failed to resolve alert' });
    }
  });

  // Auto-generate alerts based on metric anomalies (can be called as a scheduled job)
  app.post('/api/green/alerts/generate', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    try {
      // This would analyze metrics and create alerts for anomalies
      // For now, return a placeholder
      res.json({ message: 'Alert generation requires custom business logic implementation' });
    } catch (error) {
      console.error('Generate green alerts error:', error);
      res.status(500).json({ error: 'Failed to generate alerts' });
    }
  });

  // Export helper functions
  module.exports.validateMetricType = validateMetricType;
  module.exports.validateActionType = validateActionType;
};
