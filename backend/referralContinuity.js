// ============================================================================
// Smart Referral Handoff & Mother-Newborn Continuity API
//
// Endpoints:
//   POST   /api/referrals/doctor-initiated      - Doctor creates referral
//   PATCH  /api/referrals/:id/accept              - Facility accepts referral
//   PATCH  /api/referrals/:id/reject              - Facility rejects referral
//   POST   /api/referrals/:id/outcome            - Record referral outcome
//   GET    /api/referrals/:id/messages           - Get referral messages
//   POST   /api/referrals/:id/messages           - Send referral message
//   POST   /api/continuity/consent               - Mother-child consent
//   GET    /api/continuity/consent/:motherId/:childId - Get consent status
//   POST   /api/continuity/linkage               - Request mother-child linkage
//   PATCH  /api/continuity/linkage/:id/verify    - Verify linkage
//   GET    /api/continuity/timeline/:motherId    - Get continuity timeline
//   GET    /api/continuity/timeline/:motherId/:childId - Get child-inclusive timeline
//   POST   /api/continuity/access                 - Grant continuity access
// ============================================================================

module.exports = function(app, { pool, authenticateToken, authorizeRole }) {
  const router = require('express').Router();

  // ==================== SMART REFERRAL HANDOFF ====================

  // POST /api/referrals/doctor-initiated
  // Doctor initiates a referral to another facility
  router.post('/doctor-initiated', async (req, res) => {
    try {
      const doctorId = req.user.id;
      const {
        to_facility_id,
        user_id, // Mother's user ID
        referral_reason,
        urgency = 'routine',
        priority = 'routine',
        medical_summary,
        patient_condition = 'unknown',
        special_requirements,
        estimated_arrival,
        attachments = []
      } = req.body;

      if (!to_facility_id || !user_id || !referral_reason) {
        return res.status(400).json({ error: 'To facility, patient, and reason are required' });
      }

      // Get doctor's facility if available
      const doctorFacilityResult = await pool.query(
        'SELECT facility_id FROM doctor_facilities WHERE doctor_id = $1 AND active = TRUE LIMIT 1',
        [doctorId]
      );
      const fromFacilityId = doctorFacilityResult.rows[0]?.facility_id || null;

      const result = await pool.query(
        `INSERT INTO facility_referrals
          (user_id, from_facility_id, to_facility_id, referral_reason, urgency, priority,
           initiating_doctor_id, initiating_facility_id, initiated_by, medical_summary,
           patient_condition, special_requirements, estimated_arrival, attachments, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'doctor', $9, $10, $11, $12, $13, $14, $15)
          RETURNING *`,
        [user_id, fromFacilityId, to_facility_id, referral_reason, urgency, priority,
         doctorId, fromFacilityId, medical_summary, patient_condition, special_requirements,
         estimated_arrival, JSON.stringify(attachments), doctorId]
      );

      // Create initial outcome record
      await pool.query(
        `INSERT INTO referral_outcomes
          (referral_id, outcome_type, outcome_details, recorded_by)
          VALUES ($1, 'referral_created', 'Referral initiated by doctor', $2)`,
        [result.rows[0].id, doctorId]
      );

      res.status(201).json({ referral: result.rows[0] });
    } catch (error) {
      console.error('Doctor-initiated referral error:', error);
      res.status(500).json({ error: 'Failed to create referral' });
    }
  });

  // PATCH /api/referrals/:id/accept
  // Facility accepts a referral
  router.patch('/:id/accept', async (req, res) => {
    try {
      const { id } = req.params;
      const { assigned_to, notes } = req.body;

      const result = await pool.query(
        `UPDATE facility_referrals
         SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, assigned_to = $2
         WHERE id = $1
         RETURNING *`,
        [id, assigned_to || null]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Referral not found' });
      }

      // Record outcome
      await pool.query(
        `INSERT INTO referral_outcomes
          (referral_id, outcome_type, outcome_details, recorded_by)
          VALUES ($1, 'accepted', $2, $3)`,
        [id, notes || 'Referral accepted', req.user.id]
      );

      res.json({ referral: result.rows[0] });
    } catch (error) {
      console.error('Accept referral error:', error);
      res.status(500).json({ error: 'Failed to accept referral' });
    }
  });

  // PATCH /api/referrals/:id/reject
  // Facility rejects a referral
  router.patch('/:id/reject', async (req, res) => {
    try {
      const { id } = req.params;
      const { rejection_reason } = req.body;

      const result = await pool.query(
        `UPDATE facility_referrals
         SET status = 'rejected', rejected_at = CURRENT_TIMESTAMP, rejection_reason = $2
         WHERE id = $1
         RETURNING *`,
        [id, rejection_reason]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Referral not found' });
      }

      // Record outcome
      await pool.query(
        `INSERT INTO referral_outcomes
          (referral_id, outcome_type, outcome_details, recorded_by)
          VALUES ($1, 'rejected', $2, $3)`,
        [id, rejection_reason || 'Referral rejected', req.user.id]
      );

      res.json({ referral: result.rows[0] });
    } catch (error) {
      console.error('Reject referral error:', error);
      res.status(500).json({ error: 'Failed to reject referral' });
    }
  });

  // POST /api/referrals/:id/outcome
  // Record referral outcome
  router.post('/:id/outcome', async (req, res) => {
    try {
      const { id } = req.params;
      const {
        outcome_type,
        outcome_details,
        follow_up_required = false,
        follow_up_date,
        follow_up_notes,
        attachments = []
      } = req.body;

      if (!outcome_type) {
        return res.status(400).json({ error: 'Outcome type is required' });
      }

      const result = await pool.query(
        `INSERT INTO referral_outcomes
          (referral_id, outcome_type, outcome_details, follow_up_required, follow_up_date, follow_up_notes, attachments, recorded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *`,
        [id, outcome_type, outcome_details, follow_up_required, follow_up_date, follow_up_notes,
         JSON.stringify(attachments), req.user.id]
      );

      // Update referral status based on outcome
      let statusUpdate = '';
      if (outcome_type === 'accepted') statusUpdate = 'accepted';
      else if (outcome_type === 'rejected') statusUpdate = 'rejected';
      else if (outcome_type === 'admitted') statusUpdate = 'in_transit';
      else if (outcome_type === 'completed') statusUpdate = 'completed';

      if (statusUpdate) {
        await pool.query(
          `UPDATE facility_referrals SET status = $2 WHERE id = $1`,
          [id, statusUpdate]
        );
      }

      res.status(201).json({ outcome: result.rows[0] });
    } catch (error) {
      console.error('Record outcome error:', error);
      res.status(500).json({ error: 'Failed to record outcome' });
    }
  });

  // GET /api/referrals/:id/messages
  // Get messages for a referral
  router.get('/:id/messages', async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `SELECT rm.*, u.full_name as sender_name, u.role as sender_role
         FROM referral_messages rm
         JOIN users u ON rm.sender_id = u.id
         WHERE rm.referral_id = $1
         ORDER BY rm.created_at ASC`,
        [id]
      );

      res.json({ messages: result.rows });
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Failed to get messages' });
    }
  });

  // POST /api/referrals/:id/messages
  // Send a message about a referral
  router.post('/:id/messages', async (req, res) => {
    try {
      const { id } = req.params;
      const { message, recipient_id, recipient_role, message_type = 'update', is_internal = false } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const result = await pool.query(
        `INSERT INTO referral_messages
          (referral_id, sender_id, sender_role, recipient_id, recipient_role, message, message_type, is_internal)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *`,
        [id, req.user.id, req.user.role, recipient_id, recipient_role, message, message_type, is_internal]
      );

      res.status(201).json({ message: result.rows[0] });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  // ==================== MOTHER-NEWBORN CONTINUITY ====================

  // POST /api/continuity/consent
  // Mother gives consent for mother-child record linkage
  router.post('/consent', async (req, res) => {
    try {
      const motherId = req.user.id;
      const {
        child_id,
        consent_type = 'full_continuity',
        relationship = 'mother',
        notes
      } = req.body;

      if (!child_id) {
        return res.status(400).json({ error: 'Child ID is required' });
      }

      // Verify mother is linked to this child
      const linkageResult = await pool.query(
        'SELECT * FROM mother_child_linkage WHERE mother_id = $1 AND child_id = $2',
        [motherId, child_id]
      );

      if (linkageResult.rows.length === 0) {
        return res.status(400).json({ error: 'Mother-child linkage not found. Request linkage first.' });
      }

      const result = await pool.query(
        `INSERT INTO mother_child_consent
          (mother_id, child_id, consent_type, consent_given, consented_by, relationship, notes)
          VALUES ($1, $2, $3, TRUE, $4, $5, $6)
          ON CONFLICT (mother_id, child_id, consent_type)
          DO UPDATE SET consent_given = TRUE, consented_at = CURRENT_TIMESTAMP, notes = $6
          RETURNING *`,
        [motherId, child_id, consent_type, motherId, relationship, notes]
      );

      res.status(201).json({ consent: result.rows[0] });
    } catch (error) {
      console.error('Consent error:', error);
      res.status(500).json({ error: 'Failed to save consent' });
    }
  });

  // GET /api/continuity/consent/:motherId/:childId
  // Get consent status for a mother-child pair
  router.get('/consent/:motherId/:childId', async (req, res) => {
    try {
      const { motherId, childId } = req.params;

      const result = await pool.query(
        'SELECT * FROM mother_child_consent WHERE mother_id = $1 AND child_id = $2',
        [motherId, childId]
      );

      res.json({ consents: result.rows });
    } catch (error) {
      console.error('Get consent error:', error);
      res.status(500).json({ error: 'Failed to get consent status' });
    }
  });

  // POST /api/continuity/linkage
  // Request mother-child linkage verification
  router.post('/linkage', async (req, res) => {
    try {
      const motherId = req.user.id;
      const {
        child_id,
        relationship_type = 'biological',
        verification_method = 'self_declaration',
        verification_document,
        notes
      } = req.body;

      if (!child_id) {
        return res.status(400).json({ error: 'Child ID is required' });
      }

      const result = await pool.query(
        `INSERT INTO mother_child_linkage
          (mother_id, child_id, relationship_type, verification_status, verification_method, verification_document, notes)
          VALUES ($1, $2, $3, 'pending', $4, $5, $6)
          ON CONFLICT (mother_id, child_id)
          DO UPDATE SET relationship_type = $3, verification_status = 'pending', verification_method = $4, notes = $6
          RETURNING *`,
        [motherId, child_id, relationship_type, verification_method, verification_document, notes]
      );

      res.status(201).json({ linkage: result.rows[0] });
    } catch (error) {
      console.error('Linkage error:', error);
      res.status(500).json({ error: 'Failed to request linkage' });
    }
  });

  // PATCH /api/continuity/linkage/:id/verify
  // Verify mother-child linkage (admin/doctor only)
  router.patch('/linkage/:id/verify', async (req, res) => {
    try {
      const { id } = req.params;
      const { verification_status, notes } = req.body;

      if (!['verified', 'rejected'].includes(verification_status)) {
        return res.status(400).json({ error: 'Invalid verification status' });
      }

      const result = await pool.query(
        `UPDATE mother_child_linkage
         SET verification_status = $2, verified_by = $3, verified_at = CURRENT_TIMESTAMP, notes = $4
         WHERE id = $1
         RETURNING *`,
        [id, verification_status, req.user.id, notes]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Linkage not found' });
      }

      res.json({ linkage: result.rows[0] });
    } catch (error) {
      console.error('Verify linkage error:', error);
      res.status(500).json({ error: 'Failed to verify linkage' });
    }
  });

  // GET /api/continuity/timeline/:motherId
  // Get continuity timeline for a mother
  router.get('/timeline/:motherId', async (req, res) => {
    try {
      const { motherId } = req.params;
      const { include_children = true } = req.query;

      let query = `
        SELECT ct.*,
          f.name as facility_name,
          dp.full_name as doctor_name,
          dp.specialization as doctor_specialization
        FROM continuity_timeline ct
        LEFT JOIN facilities f ON ct.facility_id = f.id
        LEFT JOIN doctor_profiles dp ON ct.doctor_id = dp.user_id
        WHERE ct.mother_id = $1
      `;
      const params = [motherId];

      if (include_children === 'true') {
        query += ` OR ct.child_id IN (
          SELECT child_id FROM mother_child_linkage
          WHERE mother_id = $1 AND verification_status = 'verified'
        )`;
      }

      query += ` ORDER BY ct.event_date DESC, ct.event_timestamp DESC`;

      const result = await pool.query(query, params);

      res.json({ timeline: result.rows });
    } catch (error) {
      console.error('Get timeline error:', error);
      res.status(500).json({ error: 'Failed to get timeline' });
    }
  });

  // GET /api/continuity/timeline/:motherId/:childId
  // Get continuity timeline for a specific mother-child pair
  router.get('/timeline/:motherId/:childId', async (req, res) => {
    try {
      const { motherId, childId } = req.params;

      // Verify linkage exists and is verified
      const linkageResult = await pool.query(
        'SELECT * FROM mother_child_linkage WHERE mother_id = $1 AND child_id = $2 AND verification_status = $3',
        [motherId, childId, 'verified']
      );

      if (linkageResult.rows.length === 0) {
        return res.status(403).json({ error: 'No verified linkage found between mother and child' });
      }

      const query = `
        SELECT ct.*,
          f.name as facility_name,
          dp.full_name as doctor_name,
          dp.specialization as doctor_specialization
        FROM continuity_timeline ct
        LEFT JOIN facilities f ON ct.facility_id = f.id
        LEFT JOIN doctor_profiles dp ON ct.doctor_id = dp.user_id
        WHERE (ct.mother_id = $1 OR ct.child_id = $2)
        ORDER BY ct.event_date DESC, ct.event_timestamp DESC
      `;

      const result = await pool.query(query, [motherId, childId]);

      res.json({ timeline: result.rows, linkage: linkageResult.rows[0] });
    } catch (error) {
      console.error('Get child timeline error:', error);
      res.status(500).json({ error: 'Failed to get timeline' });
    }
  });

  // POST /api/continuity/access
  // Grant access to continuity records
  router.post('/access', async (req, res) => {
    try {
      const {
        mother_id,
        child_id,
        granted_to_user_id,
        access_type,
        purpose,
        expires_at
      } = req.body;

      if (!mother_id || !granted_to_user_id || !access_type) {
        return res.status(400).json({ error: 'Mother ID, recipient, and access type are required' });
      }

      const result = await pool.query(
        `INSERT INTO continuity_access
          (mother_id, child_id, granted_to_user_id, access_type, granted_by, purpose, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (mother_id, child_id, granted_to_user_id, access_type)
          DO UPDATE SET purpose = $6, expires_at = $7
          RETURNING *`,
        [mother_id, child_id, granted_to_user_id, access_type, req.user.id, purpose, expires_at]
      );

      res.status(201).json({ access: result.rows[0] });
    } catch (error) {
      console.error('Grant access error:', error);
      res.status(500).json({ error: 'Failed to grant access' });
    }
  });

  // Register routes
  app.use('/api/referrals', authenticateToken, authorizeRole(['mother', 'doctor']), router);
  app.use('/api/continuity', authenticateToken, authorizeRole(['mother', 'doctor']), router);
};
