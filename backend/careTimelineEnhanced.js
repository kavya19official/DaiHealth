'use strict';

/**
 * Enhanced Care Timeline API
 *
 * Extends the existing care timeline with:
 * - Clinician edit capabilities with versioning
 * - Custom milestone additions
 * - Stage-aware filtering
 * - Gestational age calculation when LMP/EDD is known
 */

module.exports = function(app, { pool, authenticateToken, authorizeRole }) {

  // ============================================================================
  // Helper Functions
  // ============================================================================

  const calculateGestationalAge = (lmpDate, eddDate) => {
    const today = new Date();
    let lmp = null;

    if (lmpDate) {
      lmp = new Date(lmpDate);
    } else if (eddDate) {
      // EDD is typically 280 days from LMP
      lmp = new Date(new Date(eddDate).getTime() - 280 * 24 * 60 * 60 * 1000);
    }

    if (!lmp) return null;

    const diffTime = today - lmp;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const weeks = Math.floor(diffDays / 7);
    const days = diffDays % 7;

    return { weeks, days, total_days: diffDays };
  };

  const filterMilestonesByStage = (milestones, currentStage) => {
    // If current stage is unknown, return all milestones
    if (!currentStage) return milestones;

    // Define stage transitions (in weeks)
    const stageTransitions = {
      'Trimester 1': { start: 0, end: 13 },
      'Trimester 2': { start: 13, end: 27 },
      'Trimester 3': { start: 27, end: 40 },
      'Delivery': { start: 40, end: 41 },
      'Postpartum': { start: 41, end: 46 },
      'Child (0–1y)': { start: 46, end: 104 }
    };

    const currentTransition = stageTransitions[currentStage];
    if (!currentTransition) return milestones;

    // Return milestones relevant to current and nearby stages
    return milestones.filter(m => {
      const stageRange = stageTransitions[m.stage];
      if (!stageRange) return true; // Keep custom milestones
      // Show current stage, previous stage, and next stage
      return Math.abs(stageRange.start - currentTransition.start) <= 13;
    });
  };

  // ============================================================================
  // Enhanced Public API: Mother - Get personalised care timeline
  // ============================================================================

  app.get('/api/timeline/enhanced', authenticateToken, authorizeRole(['mother']), async (req, res) => {
    try {
      // Get mother profile for gestational age calculation
      const profile = await pool.query(
        'SELECT lmp_date, edd_date, pregnancy_status FROM mother_profiles WHERE user_id = $1',
        [req.user.id]
      );

      const gestationalAge = calculateGestationalAge(
        profile.rows[0]?.lmp_date,
        profile.rows[0]?.edd_date
      );

      // Determine current stage based on gestational age
      let currentStage = null;
      if (gestationalAge) {
        if (gestationalAge.weeks < 13) currentStage = 'Trimester 1';
        else if (gestationalAge.weeks < 27) currentStage = 'Trimester 2';
        else if (gestationalAge.weeks < 40) currentStage = 'Trimester 3';
        else if (gestationalAge.weeks < 41) currentStage = 'Delivery';
        else if (gestationalAge.weeks < 46) currentStage = 'Postpartum';
        else currentStage = 'Child (0–1y)';
      }

      // Get all milestones
      const result = await pool.query(
        `SELECT id, stage, category, title, guidance, due_date, completed_at,
                sort_order, completion_verification, verified_facility_name,
                CASE WHEN completed_at IS NOT NULL THEN 'completed'
                     WHEN due_date < CURRENT_DATE THEN 'overdue'
                     ELSE 'upcoming' END AS status,
                (SELECT COUNT(*) FROM care_timeline_edits cte WHERE cte.milestone_id = care_milestones.id) as edit_count
         FROM care_milestones
         WHERE mother_id = $1
         ORDER BY sort_order ASC`,
        [req.user.id]
      );

      let milestones = result.rows;

      // Keep the full recorded history by default, including antenatal care after birth.
      // A nearby-stage view must be explicitly requested; it is not the main journey.
      if (req.query?.scope === 'nearby_stages' && gestationalAge && currentStage) {
        milestones = filterMilestonesByStage(milestones, currentStage);
      }

      res.json({
        milestones,
        gestational_age: gestationalAge,
        current_stage: currentStage,
        pregnancy_status: profile.rows[0]?.pregnancy_status
      });
    } catch (error) {
      console.error('Fetch enhanced timeline error:', error);
      res.status(500).json({ error: 'Failed to fetch enhanced timeline' });
    }
  });

  // ============================================================================
  // Clinician API: Edit milestone (doctor only)
  // ============================================================================

  app.patch('/api/timeline/:id/edit', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const { id } = req.params;
      const { edit_type, new_value, edit_reason } = req.body;

      if (!edit_type || !new_value) {
        return res.status(400).json({ error: 'Edit type and new value are required' });
      }

      const validEditTypes = ['title', 'guidance', 'due_date'];
      if (!validEditTypes.includes(edit_type)) {
        return res.status(400).json({ error: 'Invalid edit type' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get current value
        const current = await client.query(
          `SELECT ${edit_type} as current_value FROM care_milestones WHERE id = $1`,
          [id]
        );

        if (current.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Milestone not found' });
        }

        // Log the edit
        await client.query(
          `INSERT INTO care_timeline_edits
           (milestone_id, edited_by, edit_type, previous_value, new_value, edit_reason)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, req.user.id, edit_type, current.rows[0].current_value, new_value, edit_reason || null]
        );

        // Update the milestone
        const updateQuery = edit_type === 'due_date'
          ? `UPDATE care_milestones SET ${edit_type} = $1::date WHERE id = $2`
          : `UPDATE care_milestones SET ${edit_type} = $1 WHERE id = $2`;

        await client.query(updateQuery, [new_value, id]);

        await client.query('COMMIT');

        res.json({ message: 'Milestone updated successfully' });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Edit milestone error:', error);
      res.status(500).json({ error: 'Failed to edit milestone' });
    }
  });

  // ============================================================================
  // Clinician API: Add custom milestone (doctor only)
  // ============================================================================

  app.post('/api/timeline/custom', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const { mother_id, stage, category, title, guidance, due_date } = req.body;

      if (!mother_id || !title || !due_date) {
        return res.status(400).json({ error: 'Mother ID, title, and due date are required' });
      }

      // Verify the doctor has a relationship with this mother (via appointments)
      const hasRelationship = { rows: (await require('./accessControl').hasDoctorAccess(pool, req.user.id, mother_id)) ? [1] : [] };

      if (hasRelationship.rows.length === 0) {
        return res.status(403).json({ error: 'You can only add milestones for your own patients' });
      }

      // Get the highest sort_order for this mother
      const maxSort = await pool.query(
        'SELECT MAX(sort_order) as max_sort FROM care_milestones WHERE mother_id = $1',
        [mother_id]
      );

      const newSortOrder = (maxSort.rows[0].max_sort || 0) + 1;

      const result = await pool.query(
        `INSERT INTO care_milestones
         (mother_id, stage, category, title, guidance, due_date, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [mother_id, stage || 'Custom', category || 'pregnancy', title, guidance || null, due_date, newSortOrder]
      );

      // Log the addition as an edit
      await pool.query(
        `INSERT INTO care_timeline_edits
         (milestone_id, edited_by, edit_type, previous_value, new_value, edit_reason)
         VALUES ($1, $2, 'custom_addition', NULL, $3, $4)`,
        [result.rows[0].id, req.user.id, title, 'Custom milestone added by clinician']
      );

      res.status(201).json({ milestone: result.rows[0] });
    } catch (error) {
      console.error('Add custom milestone error:', error);
      res.status(500).json({ error: 'Failed to add custom milestone' });
    }
  });

  // ============================================================================
  // Public API: Get edit history for a milestone
  // ============================================================================

  app.get('/api/timeline/:id/edits', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `SELECT cte.id, cte.edit_type, cte.previous_value, cte.new_value,
                cte.edit_reason, cte.created_at,
                u.full_name as edited_by_name
         FROM care_timeline_edits cte
         LEFT JOIN users u ON cte.edited_by = u.id
         WHERE cte.milestone_id = $1
         ORDER BY cte.created_at DESC`,
        [id]
      );

      res.json({ edits: result.rows });
    } catch (error) {
      console.error('Fetch edit history error:', error);
      res.status(500).json({ error: 'Failed to fetch edit history' });
    }
  });

  // ============================================================================
  // Mother API: Mark milestone complete with verification details
  // ============================================================================

  app.patch('/api/timeline/:id/complete-verified', authenticateToken, authorizeRole(['mother']), async (req, res) => {
    try {
      const { id } = req.params;
      const { completion_verification, verified_facility_name } = req.body;

      const result = await pool.query(
        `UPDATE care_milestones
         SET completed_at = CURRENT_TIMESTAMP,
             completion_verification = COALESCE($1, completion_verification),
             verified_facility_name = $2
         WHERE id = $3 AND mother_id = $4
         RETURNING id, completed_at, completion_verification, verified_facility_name`,
        [completion_verification || 'self_reported', verified_facility_name || null, id, req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Milestone not found' });
      }

      res.json({ message: 'Milestone marked complete', milestone: result.rows[0] });
    } catch (error) {
      console.error('Complete milestone verified error:', error);
      res.status(500).json({ error: 'Failed to update milestone' });
    }
  });

  // Export helper functions
  module.exports.calculateGestationalAge = calculateGestationalAge;
  module.exports.filterMilestonesByStage = filterMilestonesByStage;
};
