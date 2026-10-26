'use strict';

/**
 * Missed-Care Outreach Queue API
 *
 * Provides endpoints for:
 * - Generating missed care items from overdue milestones and appointments
 * - Retrieving prioritized outreach queue for staff
 * - Logging outreach attempts and outcomes
 * - Updating missed care item status
 */

module.exports = function(app, { pool, authenticateToken, authorizeRole }) {

  // ============================================================================
  // Helper Functions
  // ============================================================================

  const calculateOverdueDays = (dueDate) => {
    const today = new Date();
    const due = new Date(dueDate);
    const diffTime = today - due;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  const determineUrgency = (overdueDays, item) => {
    // Critical: >30 days overdue or high-risk pregnancy
    if (overdueDays > 30) return 'critical';
    if (overdueDays > 14) return 'high';
    if (overdueDays > 7) return 'medium';
    return 'low';
  };

  // ============================================================================
  // Public API: Mother - view her own missed care items
  // ============================================================================

  app.get('/api/patient/missed-care', authenticateToken, authorizeRole(['mother']), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, item_type, title, due_date, overdue_days, urgency_level,
                access_barriers, status, priority_score, created_at
         FROM missed_care_items
         WHERE mother_id = $1 AND status IN ('pending', 'in_progress')
         ORDER BY priority_score DESC, due_date ASC`,
        [req.user.id]
      );
      res.json({ missed_care_items: result.rows });
    } catch (error) {
      console.error('Fetch missed care error:', error);
      res.status(500).json({ error: 'Failed to fetch missed care items' });
    }
  });

  // ============================================================================
  // Public API: Staff (Doctor/Hospital) - Outreach queue
  // ============================================================================

  // Get prioritized outreach queue (for hospital staff and community health workers only)
  app.get('/api/outreach/queue', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const { status = 'pending', urgency, limit = 50 } = req.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 200);

      let query = `
        SELECT mci.id, mci.mother_id, mp.full_name, mp.phone, mp.address,
               mci.item_type, mci.title, mci.due_date, mci.overdue_days,
               mci.urgency_level, mci.access_barriers, mci.status,
               mci.priority_score, mci.created_at,
               COUNT(oa.id) as attempt_count
        FROM missed_care_items mci
        JOIN mother_profiles mp ON mci.mother_id = mp.user_id
        LEFT JOIN outreach_attempts oa ON mci.id = oa.missed_care_id
        WHERE mci.status = $1
      `;
      const params = [status];

      // Doctor only sees mothers whose access the mother has not turned off
      params.push(req.user.id);
      query += ` AND ${require('./accessControl').activeRelationshipSql('mci.mother_id', `$${params.length}::int`)}`;

      if (urgency) {
        params.push(urgency);
        query += ` AND mci.urgency_level = $${params.length}`;
      }

      query += `
        GROUP BY mci.id, mp.full_name, mp.phone, mp.address
        ORDER BY mci.priority_score DESC, mci.due_date ASC
        LIMIT $${params.length + 1}
      `;
      params.push(limitNum);

      const result = await pool.query(query, params);
      res.json({ queue: result.rows });
    } catch (error) {
      console.error('Fetch outreach queue error:', error);
      res.status(500).json({ error: 'Failed to fetch outreach queue' });
    }
  });

  // Get outreach attempts for a specific missed care item
  app.get('/api/outreach/:missedCareId/attempts', authenticateToken, async (req, res) => {
    try {
      const missedCareId = parseInt(req.params.missedCareId, 10);
      const result = await pool.query(
        `SELECT oa.id, oa.attempt_type, oa.attempt_date, oa.outcome,
                oa.notes, oa.next_action, oa.next_action_date,
                u.full_name as attempted_by_name
         FROM outreach_attempts oa
         LEFT JOIN users u ON oa.attempted_by = u.id
         WHERE oa.missed_care_id = $1
         ORDER BY oa.attempt_date DESC`,
        [missedCareId]
      );
      res.json({ attempts: result.rows });
    } catch (error) {
      console.error('Fetch outreach attempts error:', error);
      res.status(500).json({ error: 'Failed to fetch outreach attempts' });
    }
  });

  // Log an outreach attempt (staff only)
  app.post('/api/outreach/:missedCareId/attempts', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const missedCareId = parseInt(req.params.missedCareId, 10);
      const { attempt_type, outcome, notes, next_action, next_action_date } = req.body;

      if (!attempt_type || !outcome) {
        return res.status(400).json({ error: 'Attempt type and outcome are required' });
      }

      const validTypes = ['call', 'visit', 'message', 'other'];
      const validOutcomes = ['no_answer', 'reached', 'left_message', 'agreed_followup', 'declined', 'wrong_number', 'rescheduled'];

      if (!validTypes.includes(attempt_type)) {
        return res.status(400).json({ error: 'Invalid attempt type' });
      }

      if (!validOutcomes.includes(outcome)) {
        return res.status(400).json({ error: 'Invalid outcome' });
      }

      const result = await pool.query(
        `INSERT INTO outreach_attempts
         (missed_care_id, attempted_by, attempt_type, outcome, notes, next_action, next_action_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [missedCareId, req.user.id, attempt_type, outcome, notes || null, next_action || null, next_action_date || null]
      );

      // Update missed care item status based on outcome
      if (outcome === 'agreed_followup' || outcome === 'rescheduled') {
        await pool.query(
          `UPDATE missed_care_items SET status = 'in_progress' WHERE id = $1`,
          [missedCareId]
        );
      } else if (outcome === 'reached') {
        await pool.query(
          `UPDATE missed_care_items SET status = 'resolved' WHERE id = $1`,
          [missedCareId]
        );
      }

      res.status(201).json({ attempt: result.rows[0] });
    } catch (error) {
      console.error('Log outreach attempt error:', error);
      res.status(500).json({ error: 'Failed to log outreach attempt' });
    }
  });

  // Update missed care item status (staff only)
  app.patch('/api/outreach/:missedCareId/status', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const missedCareId = parseInt(req.params.missedCareId, 10);
      const { status, access_barriers } = req.body;

      const validStatuses = ['pending', 'in_progress', 'resolved', 'deferred'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const result = await pool.query(
        `UPDATE missed_care_items
         SET status = $1, access_barriers = COALESCE($2::jsonb, access_barriers)
         WHERE id = $3
         RETURNING *`,
        [status, access_barriers ? JSON.stringify(access_barriers) : null, missedCareId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Missed care item not found' });
      }

      res.json({ item: result.rows[0] });
    } catch (error) {
      console.error('Update missed care status error:', error);
      res.status(500).json({ error: 'Failed to update missed care status' });
    }
  });

  // ============================================================================
  // Internal API: Auto-generate missed care items from overdue milestones
  // ============================================================================

  // Generate missed care items from overdue milestones (can be called by a scheduled job)
  app.post('/api/outreach/generate', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Find overdue milestones that don't already have a missed care record
        const overdueMilestones = await client.query(
          `SELECT cm.id, cm.mother_id, cm.title, cm.due_date, cm.stage, cm.category
           FROM care_milestones cm
           WHERE cm.completed_at IS NULL
             AND cm.due_date < CURRENT_DATE
             AND NOT EXISTS (
               SELECT 1 FROM missed_care_items mci
               WHERE mci.milestone_id = cm.id AND mci.status != 'resolved'
             )`,
          []
        );

        for (const milestone of overdueMilestones.rows) {
          const overdueDays = calculateOverdueDays(milestone.due_date);
          const urgency = determineUrgency(overdueDays, milestone);

          await client.query(
            `INSERT INTO missed_care_items
             (mother_id, milestone_id, item_type, title, due_date, overdue_days, urgency_level, status)
             VALUES ($1, $2, 'milestone', $3, $4, $5, $6, 'pending')`,
            [milestone.mother_id, milestone.id, milestone.title, milestone.due_date, overdueDays, urgency]
          );
        }

        // Find missed/cancelled appointments
        const missedAppointments = await client.query(
          `SELECT a.id, a.mother_id, a.reason as title, a.requested_date as due_date
           FROM appointments a
           WHERE a.status IN ('cancelled', 'pending')
             AND a.requested_date < CURRENT_DATE
             AND NOT EXISTS (
               SELECT 1 FROM missed_care_items mci
               WHERE mci.appointment_id = a.id AND mci.status != 'resolved'
             )`,
          []
        );

        for (const appointment of missedAppointments.rows) {
          const overdueDays = calculateOverdueDays(appointment.due_date);
          const urgency = determineUrgency(overdueDays, appointment);

          await client.query(
            `INSERT INTO missed_care_items
             (mother_id, appointment_id, item_type, title, due_date, overdue_days, urgency_level, status)
             VALUES ($1, $2, 'appointment', $3, $4, $5, $6, 'pending')`,
            [appointment.mother_id, appointment.id, appointment.title, appointment.due_date, overdueDays, urgency]
          );
        }

        await client.query('COMMIT');

        res.json({
          message: 'Missed care items generated',
          milestones_added: overdueMilestones.rows.length,
          appointments_added: missedAppointments.rows.length
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Generate missed care items error:', error);
      res.status(500).json({ error: 'Failed to generate missed care items' });
    }
  });

  // Export helper functions for use in other modules
  module.exports.calculateOverdueDays = calculateOverdueDays;
  module.exports.determineUrgency = determineUrgency;
};
