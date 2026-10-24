'use strict';

/**
 * Smart Referral Handoff API
 *
 * Provides endpoints for:
 * - Creating referrals to hospitals, specialists, labs, or NICU facilities
 * - Accepting/rejecting referrals with decision notes
 * - Tracking referral status and appointments
 * - Returning patient summaries to referring care team
 * - Permission-based access control
 */

module.exports = function(app, { pool, authenticateToken, authorizeRole }) {

  // ============================================================================
  // Helper Functions
  // ============================================================================

  const validateReferralType = (type) => {
    const validTypes = ['hospital', 'specialist', 'lab', 'nicu', 'radiology', 'other'];
    return validTypes.includes(type);
  };

  const validatePriority = (priority) => {
    const validPriorities = ['routine', 'urgent', 'emergency'];
    return validPriorities.includes(priority);
  };

  const validateStatus = (status) => {
    const validStatuses = ['pending', 'accepted', 'rejected', 'completed', 'cancelled'];
    return validStatuses.includes(status);
  };

  // ============================================================================
  // Public API: Doctor - Create Referral
  // ============================================================================

  // Create a new referral
  app.post('/api/referrals', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const {
        referral_type, patient_id, priority, receiving_facility_id,
        receiving_specialist_id, reason, clinical_summary, diagnosis,
        icd_code, urgency_notes, patient_instructions, required_documents
      } = req.body;

      if (!referral_type || !patient_id || !reason) {
        return res.status(400).json({ error: 'Referral type, patient ID, and reason are required' });
      }

      if (!validateReferralType(referral_type)) {
        return res.status(400).json({ error: 'Invalid referral type' });
      }

      if (priority && !validatePriority(priority)) {
        return res.status(400).json({ error: 'Invalid priority' });
      }

      // Verify the referring doctor has access to this patient
      const hasAccess = await pool.query(
        `SELECT 1 FROM appointments
         WHERE doctor_id = $1 AND mother_id = $2
         LIMIT 1`,
        [req.user.id, patient_id]
      );

      if (hasAccess.rows.length === 0) {
        return res.status(403).json({ error: 'You can only refer patients you have a relationship with' });
      }

      const result = await pool.query(
        `INSERT INTO referrals
         (referring_doctor_id, patient_id, referral_type, priority,
          receiving_facility_id, receiving_specialist_id, reason,
          clinical_summary, diagnosis, icd_code, urgency_notes,
          patient_instructions, required_documents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          req.user.id, patient_id, referral_type, priority || 'routine',
          receiving_facility_id || null, receiving_specialist_id || null,
          reason, clinical_summary || null, diagnosis || null, icd_code || null,
          urgency_notes || null, patient_instructions || null,
          required_documents ? JSON.stringify(required_documents) : null
        ]
      );

      // Grant view permission to the receiving facility/specialist
      if (receiving_facility_id) {
        await pool.query(
          `INSERT INTO smart_referral_permissions (referral_id, user_id, permission_level, granted_by)
           VALUES ($1, $2, 'respond', $3)`,
          [result.rows[0].id, receiving_facility_id, req.user.id]
        );
      }

      if (receiving_specialist_id) {
        await pool.query(
          `INSERT INTO smart_referral_permissions (referral_id, user_id, permission_level, granted_by)
           VALUES ($1, $2, 'respond', $3)`,
          [result.rows[0].id, receiving_specialist_id, req.user.id]
        );
      }

      res.status(201).json({ referral: result.rows[0] });
    } catch (error) {
      console.error('Create referral error:', error);
      res.status(500).json({ error: 'Failed to create referral' });
    }
  });

  // ============================================================================
  // Public API: Doctor/Staff - View Referrals
  // ============================================================================

  // Get referrals for a doctor (both sent and received)
  app.get('/api/referrals', authenticateToken, authorizeRole(['doctor', 'hospital']), async (req, res) => {
    try {
      const { status, type } = req.query;
      const userId = req.user.id;

      let query = `
        SELECT r.id, r.referral_type, r.priority, r.reason, r.diagnosis,
               r.status, r.decision_notes, r.appointment_scheduled, r.appointment_date,
               r.summary_returned, r.created_at,
               mp.full_name as patient_name,
               ref_doc.full_name as referring_doctor_name,
               rec_fac.full_name as receiving_facility_name,
               rec_spec.full_name as receiving_specialist_name
        FROM referrals r
        LEFT JOIN mother_profiles mp ON r.patient_id = mp.user_id
        LEFT JOIN doctor_profiles ref_doc ON r.referring_doctor_id = ref_doc.user_id
        LEFT JOIN doctor_profiles rec_fac ON r.receiving_facility_id = rec_fac.user_id
        LEFT JOIN doctor_profiles rec_spec ON r.receiving_specialist_id = rec_spec.user_id
        WHERE (r.referring_doctor_id = $1
               OR r.receiving_facility_id = $1
               OR r.receiving_specialist_id = $1
               OR EXISTS (
                 SELECT 1 FROM smart_referral_permissions rp
                 WHERE rp.referral_id = r.id AND rp.user_id = $1
               ))
      `;
      const params = [userId];
      let paramCount = 1;

      if (status && validateStatus(status)) {
        paramCount++;
        query += ` AND r.status = $${paramCount}`;
        params.push(status);
      }

      if (type && validateReferralType(type)) {
        paramCount++;
        query += ` AND r.referral_type = $${paramCount}`;
        params.push(type);
      }

      query += ` ORDER BY r.created_at DESC`;

      const result = await pool.query(query, params);
      res.json({ referrals: result.rows });
    } catch (error) {
      console.error('Fetch referrals error:', error);
      res.status(500).json({ error: 'Failed to fetch referrals' });
    }
  });

  // Get a specific referral with full details
  app.get('/api/referrals/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Check permission
      const hasPermission = await pool.query(
        `SELECT 1 FROM referrals r
         WHERE r.id = $1
           AND (r.referring_doctor_id = $2
                OR r.receiving_facility_id = $2
                OR r.receiving_specialist_id = $2
                OR EXISTS (
                  SELECT 1 FROM smart_referral_permissions rp
                  WHERE rp.referral_id = r.id AND rp.user_id = $2
                ))`,
        [id, userId]
      );

      if (hasPermission.rows.length === 0) {
        return res.status(403).json({ error: 'You do not have permission to view this referral' });
      }

      const result = await pool.query(
        `SELECT r.*,
         mp.full_name as patient_name, mp.phone as patient_phone,
         ref_doc.full_name as referring_doctor_name, ref_doc.phone as referring_doctor_phone,
         rec_fac.full_name as receiving_facility_name, rec_fac.phone as receiving_facility_phone,
         rec_spec.full_name as receiving_specialist_name, rec_spec.phone as receiving_specialist_phone
        FROM referrals r
        LEFT JOIN mother_profiles mp ON r.patient_id = mp.user_id
        LEFT JOIN doctor_profiles ref_doc ON r.referring_doctor_id = ref_doc.user_id
        LEFT JOIN doctor_profiles rec_fac ON r.receiving_facility_id = rec_fac.user_id
        LEFT JOIN doctor_profiles rec_spec ON r.receiving_specialist_id = rec_spec.user_id
        WHERE r.id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Referral not found' });
      }

      res.json({ referral: result.rows[0] });
    } catch (error) {
      console.error('Fetch referral error:', error);
      res.status(500).json({ error: 'Failed to fetch referral' });
    }
  });

  // ============================================================================
  // Public API: Receiving Facility/Specialist - Accept/Reject
  // ============================================================================

  // Accept or reject a referral
  app.patch('/api/referrals/:id/decision', authenticateToken, authorizeRole(['doctor', 'hospital']), async (req, res) => {
    try {
      const { id } = req.params;
      const { status, decision_notes, appointment_date } = req.body;

      if (!status || !validateStatus(status)) {
        return res.status(400).json({ error: 'Valid status required (accepted, rejected, cancelled)' });
      }

      if (!['accepted', 'rejected', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Only accepted, rejected, or cancelled status allowed for decisions' });
      }

      // Verify permission
      const hasPermission = await pool.query(
        `SELECT 1 FROM referrals r
         WHERE r.id = $1
           AND (r.receiving_facility_id = $2 OR r.receiving_specialist_id = $2)
           AND r.status = 'pending'`,
        [id, req.user.id]
      );

      if (hasPermission.rows.length === 0) {
        return res.status(403).json({ error: 'You do not have permission to decide on this referral' });
      }

      const result = await pool.query(
        `UPDATE referrals
         SET status = $1,
             decision_notes = $2,
             decision_by = $3,
             decision_at = CURRENT_TIMESTAMP,
             appointment_scheduled = CASE WHEN $4 IS NOT NULL THEN true ELSE appointment_scheduled END,
             appointment_date = $4
         WHERE id = $5
         RETURNING *`,
        [status, decision_notes || null, req.user.id, appointment_date || null, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Referral not found or already decided' });
      }

      // Log the decision as a communication
      await pool.query(
        `INSERT INTO referral_communications
         (referral_id, from_user_id, message_type, message)
         VALUES ($1, $2, 'status_update', $3)`,
        [id, req.user.id, `Referral ${status}: ${decision_notes || 'No notes provided'}`]
      );

      res.json({ referral: result.rows[0] });
    } catch (error) {
      console.error('Referral decision error:', error);
      res.status(500).json({ error: 'Failed to update referral decision' });
    }
  });

  // ============================================================================
  // Public API: Return Summary
  // ============================================================================

  // Return patient summary to referring care team
  app.post('/api/referrals/:id/summary', authenticateToken, authorizeRole(['doctor', 'hospital']), async (req, res) => {
    try {
      const { id } = req.params;
      const { summary_content } = req.body;

      if (!summary_content) {
        return res.status(400).json({ error: 'Summary content is required' });
      }

      // Verify permission (receiving facility/specialist)
      const hasPermission = await pool.query(
        `SELECT 1 FROM referrals r
         WHERE r.id = $1
           AND (r.receiving_facility_id = $2 OR r.receiving_specialist_id = $2)
           AND r.status = 'accepted'`,
        [id, req.user.id]
      );

      if (hasPermission.rows.length === 0) {
        return res.status(403).json({ error: 'You do not have permission to return summary for this referral' });
      }

      const result = await pool.query(
        `UPDATE referrals
         SET summary_returned = true,
             summary_returned_at = CURRENT_TIMESTAMP,
             summary_content = $1,
             status = 'completed'
         WHERE id = $2
         RETURNING *`,
        [summary_content, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Referral not found' });
      }

      // Log the summary return
      await pool.query(
        `INSERT INTO referral_communications
         (referral_id, from_user_id, message_type, message)
         VALUES ($1, $2, 'system', 'Patient summary returned to referring care team')`,
        [id, req.user.id]
      );

      res.json({ referral: result.rows[0] });
    } catch (error) {
      console.error('Return summary error:', error);
      res.status(500).json({ error: 'Failed to return summary' });
    }
  });

  // ============================================================================
  // Public API: Communications
  // ============================================================================

  // Get communications for a referral
  app.get('/api/referrals/:id/communications', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Check permission
      const hasPermission = await pool.query(
        `SELECT 1 FROM referrals r
         WHERE r.id = $1
           AND (r.referring_doctor_id = $2
                OR r.receiving_facility_id = $2
                OR r.receiving_specialist_id = $2
                OR EXISTS (
                  SELECT 1 FROM smart_referral_permissions rp
                  WHERE rp.referral_id = r.id AND rp.user_id = $2
                ))`,
        [id, userId]
      );

      if (hasPermission.rows.length === 0) {
        return res.status(403).json({ error: 'You do not have permission to view communications for this referral' });
      }

      const result = await pool.query(
        `SELECT rc.id, rc.message_type, rc.message, rc.metadata,
                rc.is_read, rc.read_at, rc.created_at,
                u.full_name as from_user_name
         FROM referral_communications rc
         LEFT JOIN users u ON rc.from_user_id = u.id
         WHERE rc.referral_id = $1
         ORDER BY rc.created_at ASC`,
        [id]
      );

      res.json({ communications: result.rows });
    } catch (error) {
      console.error('Fetch communications error:', error);
      res.status(500).json({ error: 'Failed to fetch communications' });
    }
  });

  // Add a communication message
  app.post('/api/referrals/:id/communications', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { message, message_type, to_user_id } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const validTypes = ['note', 'question', 'answer', 'attachment'];
      if (message_type && !validTypes.includes(message_type)) {
        return res.status(400).json({ error: 'Invalid message type' });
      }

      // Check permission
      const hasPermission = await pool.query(
        `SELECT 1 FROM referrals r
         WHERE r.id = $1
           AND (r.referring_doctor_id = $2
                OR r.receiving_facility_id = $2
                OR r.receiving_specialist_id = $2
                OR EXISTS (
                  SELECT 1 FROM smart_referral_permissions rp
                  WHERE rp.referral_id = r.id AND rp.user_id = $2
                ))`,
        [id, req.user.id]
      );

      if (hasPermission.rows.length === 0) {
        return res.status(403).json({ error: 'You do not have permission to add communications to this referral' });
      }

      const result = await pool.query(
        `INSERT INTO referral_communications
         (referral_id, from_user_id, to_user_id, message_type, message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, req.user.id, to_user_id || null, message_type || 'note', message]
      );

      res.status(201).json({ communication: result.rows[0] });
    } catch (error) {
      console.error('Add communication error:', error);
      res.status(500).json({ error: 'Failed to add communication' });
    }
  });

  // Mark communications as read
  app.patch('/api/referrals/:id/communications/read', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      await pool.query(
        `UPDATE referral_communications
         SET is_read = true, read_at = CURRENT_TIMESTAMP
         WHERE referral_id = $1 AND to_user_id = $2 AND is_read = false`,
        [id, userId]
      );

      res.json({ message: 'Communications marked as read' });
    } catch (error) {
      console.error('Mark communications read error:', error);
      res.status(500).json({ error: 'Failed to mark communications as read' });
    }
  });

  // Export helper functions
  module.exports.validateReferralType = validateReferralType;
  module.exports.validatePriority = validatePriority;
  module.exports.validateStatus = validateStatus;
};
