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
  // Shared SQL: keep items current and create the ones that are missing
  // ============================================================================

  const access = require('./accessControl');
  const URGENCY_SQL = `CASE WHEN overdue > 30 THEN 'critical' WHEN overdue > 14 THEN 'high' WHEN overdue > 7 THEN 'medium' ELSE 'low' END`;
  const BARRIERS = ['transport', 'cost', 'time_off_work', 'childcare', 'distance', 'language', 'family_permission', 'other'];

  // Closes items whose milestone is done, then re-scores open items so "days overdue", urgency and
  // priority never show the value from the day the row was created.
  async function refreshOpenItems(scopeSql = '', params = []) {
    await pool.query(
      `UPDATE missed_care_items mci SET status = 'resolved', updated_at = now()
        WHERE mci.status IN ('pending','in_progress') AND mci.milestone_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM care_milestones cm WHERE cm.id = mci.milestone_id AND cm.completed_at IS NOT NULL) ${scopeSql}`, params);
    await pool.query(
      `UPDATE missed_care_items mci SET overdue_days = s.overdue, urgency_level = s.urg,
              priority_score = (CASE s.urg WHEN 'critical' THEN 400 WHEN 'high' THEN 300 WHEN 'medium' THEN 200 ELSE 100 END)
                               + LEAST(s.overdue, 60) + 10 * jsonb_array_length(mci.access_barriers),
              updated_at = now()
         FROM (SELECT id, overdue, ${URGENCY_SQL} AS urg
                 FROM (SELECT id, GREATEST(0, (CURRENT_DATE - due_date))::int AS overdue FROM missed_care_items) x) s
        WHERE s.id = mci.id AND mci.status IN ('pending','in_progress') ${scopeSql}`, params);
  }

  // Creates missing items from overdue milestones and missed appointments. scopeSql narrows to one mother
  // or to a doctor's active patients; it always references mother column alias `m`.
  async function generateItems(scopeSql = '', params = []) {
    const ms = await pool.query(
      `INSERT INTO missed_care_items (mother_id, milestone_id, item_type, title, due_date, overdue_days, urgency_level, status)
       SELECT m.mother_id, m.id, 'milestone', m.title, m.due_date, 0, 'low', 'pending'
         FROM care_milestones m
        WHERE m.completed_at IS NULL AND m.due_date < CURRENT_DATE
          AND NOT EXISTS (SELECT 1 FROM missed_care_items x WHERE x.milestone_id = m.id AND x.status <> 'resolved') ${scopeSql}
       RETURNING id`, params);
    const ap = await pool.query(
      `INSERT INTO missed_care_items (mother_id, appointment_id, item_type, title, due_date, overdue_days, urgency_level, status)
       SELECT m.mother_id, m.id, 'appointment', COALESCE(NULLIF(m.reason, ''), 'Appointment follow-up'), m.requested_date, 0, 'low', 'pending'
         FROM appointments m
        WHERE m.status IN ('cancelled','pending') AND m.requested_date < CURRENT_DATE
          AND NOT EXISTS (SELECT 1 FROM missed_care_items x WHERE x.appointment_id = m.id AND x.status <> 'resolved') ${scopeSql}
       RETURNING id`, params);
    return { milestones_added: ms.rows.length, appointments_added: ap.rows.length };
  }

  const motherScope = (id) => ({ sql: ' AND m.mother_id = $1', params: [id] });
  const refreshScope = (id) => ({ sql: ' AND mci.mother_id = $1', params: [id] });
  const doctorGen = (id) => ({ sql: ` AND ${access.activeRelationshipSql('m.mother_id', '$1::int')}`, params: [id] });
  const doctorRefresh = (id) => ({ sql: ` AND ${access.activeRelationshipSql('mci.mother_id', '$1::int')}`, params: [id] });

  // A doctor may act on an item only while the mother has not turned that doctor's access off.
  async function doctorCanAct(doctorId, itemId) {
    const r = await pool.query(
      `SELECT 1 FROM missed_care_items mci WHERE mci.id = $1 AND ${access.activeRelationshipSql('mci.mother_id', '$2::int')}`, [itemId, doctorId]);
    return r.rows.length > 0;
  }
  const parseId = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

  // ============================================================================
  // Mother: her own missed care
  // ============================================================================

  app.get('/api/patient/missed-care', authenticateToken, authorizeRole(['mother']), async (req, res) => {
    try {
      const g = motherScope(req.user.id), r = refreshScope(req.user.id);
      await generateItems(g.sql, g.params);
      await refreshOpenItems(r.sql, r.params);
      const result = await pool.query(
        `SELECT mci.id, mci.item_type, mci.title, mci.due_date, mci.overdue_days, mci.urgency_level,
                mci.access_barriers, mci.status, mci.priority_score, mci.created_at,
                COUNT(oa.id)::int AS attempt_count, MAX(oa.attempt_date) AS last_attempt_at
           FROM missed_care_items mci
           LEFT JOIN outreach_attempts oa ON oa.missed_care_id = mci.id
          WHERE mci.mother_id = $1 AND mci.status IN ('pending','in_progress')
          GROUP BY mci.id
          ORDER BY mci.priority_score DESC, mci.due_date ASC`, [req.user.id]);
      res.json({ missed_care_items: result.rows, barrier_options: BARRIERS });
    } catch (error) {
      console.error('Fetch missed care error:', error);
      res.status(500).json({ error: 'Could not load your follow-up items' });
    }
  });

  // The mother tells her care team what is in the way. Only whitelisted reasons are stored.
  app.post('/api/patient/missed-care/:id/barriers', authenticateToken, authorizeRole(['mother']), async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const list = Array.isArray(req.body && req.body.barriers) ? req.body.barriers : null;
      if (!id || !list || list.some((b) => !BARRIERS.includes(b))) return res.status(400).json({ error: 'Choose from the listed reasons' });
      const clean = [...new Set(list)];
      const r = await pool.query(
        `UPDATE missed_care_items SET access_barriers = $1::jsonb, updated_at = now()
          WHERE id = $2 AND mother_id = $3 AND status IN ('pending','in_progress') RETURNING id, access_barriers`,
        [JSON.stringify(clean), id, req.user.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Follow-up item not found' });
      await refreshOpenItems(' AND mci.id = $1', [id]);
      res.json({ item: r.rows[0] });
    } catch (error) {
      console.error('Save barriers error:', error);
      res.status(500).json({ error: 'Could not save this' });
    }
  });

  // ============================================================================
  // Doctor: prioritized outreach queue (patients whose access has not been turned off)
  // ============================================================================

  app.get('/api/outreach/queue', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const status = ['pending', 'in_progress', 'resolved', 'deferred'].includes(req.query.status) ? req.query.status : 'pending';
      const urgency = ['critical', 'high', 'medium', 'low'].includes(req.query.urgency) ? req.query.urgency : null;
      const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

      const g = doctorGen(req.user.id), r = doctorRefresh(req.user.id);
      await generateItems(g.sql, g.params);
      await refreshOpenItems(r.sql, r.params);

      const params = [status, req.user.id];
      let where = `mci.status = $1 AND ${access.activeRelationshipSql('mci.mother_id', '$2::int')}`;
      const summary = await pool.query(
        `SELECT mci.urgency_level, COUNT(*)::int n FROM missed_care_items mci WHERE ${where} GROUP BY mci.urgency_level`, params);
      if (urgency) { params.push(urgency); where += ` AND mci.urgency_level = $${params.length}`; }
      params.push(limitNum);
      const result = await pool.query(
        `SELECT mci.id, mci.mother_id, mp.full_name, mp.phone, mp.address, mci.item_type, mci.title, mci.due_date,
                mci.overdue_days, mci.urgency_level, mci.access_barriers, mci.status, mci.priority_score, mci.created_at,
                COUNT(oa.id)::int AS attempt_count, MAX(oa.attempt_date) AS last_attempt_at
           FROM missed_care_items mci
           JOIN mother_profiles mp ON mci.mother_id = mp.user_id
           LEFT JOIN outreach_attempts oa ON mci.id = oa.missed_care_id
          WHERE ${where}
          GROUP BY mci.id, mp.full_name, mp.phone, mp.address
          ORDER BY mci.priority_score DESC, mci.due_date ASC
          LIMIT $${params.length}`, params);
      const counts = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const row of summary.rows) counts[row.urgency_level] = row.n;
      res.json({ queue: result.rows, summary: counts });
    } catch (error) {
      console.error('Fetch outreach queue error:', error);
      res.status(500).json({ error: 'Failed to fetch outreach queue' });
    }
  });

  app.get('/api/outreach/:missedCareId/attempts', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const id = parseId(req.params.missedCareId);
      if (!id) return res.status(400).json({ error: 'Invalid item' });
      if (!(await doctorCanAct(req.user.id, id))) return res.status(403).json({ error: 'No access to this patient' });
      const result = await pool.query(
        `SELECT oa.id, oa.attempt_type, oa.attempt_date, oa.outcome, oa.notes, oa.next_action, oa.next_action_date,
                COALESCE(dp.full_name, u.email) AS attempted_by_name
           FROM outreach_attempts oa
           LEFT JOIN users u ON oa.attempted_by = u.id
           LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
          WHERE oa.missed_care_id = $1
          ORDER BY oa.attempt_date DESC`, [id]);
      res.json({ attempts: result.rows });
    } catch (error) {
      console.error('Fetch outreach attempts error:', error);
      res.status(500).json({ error: 'Failed to fetch outreach attempts' });
    }
  });

  app.post('/api/outreach/:missedCareId/attempts', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const id = parseId(req.params.missedCareId);
      const { attempt_type, outcome, notes, next_action, next_action_date } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Invalid item' });
      if (!attempt_type || !outcome) return res.status(400).json({ error: 'Attempt type and outcome are required' });
      const validTypes = ['call', 'visit', 'message', 'other'];
      const validOutcomes = ['no_answer', 'reached', 'left_message', 'agreed_followup', 'declined', 'wrong_number', 'rescheduled'];
      if (!validTypes.includes(attempt_type)) return res.status(400).json({ error: 'Invalid attempt type' });
      if (!validOutcomes.includes(outcome)) return res.status(400).json({ error: 'Invalid outcome' });
      if (next_action_date && !/^\d{4}-\d{2}-\d{2}$/.test(next_action_date)) return res.status(400).json({ error: 'Invalid date' });
      if (!(await doctorCanAct(req.user.id, id))) return res.status(403).json({ error: 'No access to this patient' });

      const result = await pool.query(
        `INSERT INTO outreach_attempts (missed_care_id, attempted_by, attempt_type, outcome, notes, next_action, next_action_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, req.user.id, attempt_type, outcome, (notes || '').slice(0, 2000) || null, (next_action || '').slice(0, 255) || null, next_action_date || null]);

      // "Reached" is contact, not completed care: the item stays open (in progress) until the care itself is recorded.
      if (['agreed_followup', 'rescheduled', 'reached'].includes(outcome)) {
        await pool.query(`UPDATE missed_care_items SET status = 'in_progress', updated_at = now() WHERE id = $1 AND status = 'pending'`, [id]);
      }
      res.status(201).json({ attempt: result.rows[0] });
    } catch (error) {
      console.error('Log outreach attempt error:', error);
      res.status(500).json({ error: 'Failed to log outreach attempt' });
    }
  });

  app.patch('/api/outreach/:missedCareId/status', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const id = parseId(req.params.missedCareId);
      const { status } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Invalid item' });
      if (!['pending', 'in_progress', 'resolved', 'deferred'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      if (!(await doctorCanAct(req.user.id, id))) return res.status(403).json({ error: 'No access to this patient' });
      const result = await pool.query(`UPDATE missed_care_items SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`, [status, id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Missed care item not found' });
      res.json({ item: result.rows[0] });
    } catch (error) {
      console.error('Update missed care status error:', error);
      res.status(500).json({ error: 'Failed to update missed care status' });
    }
  });

  // Manual refresh button: same logic the queue runs on every load, scoped to this doctor's patients.
  app.post('/api/outreach/generate', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const g = doctorGen(req.user.id), r = doctorRefresh(req.user.id);
      const added = await generateItems(g.sql, g.params);
      await refreshOpenItems(r.sql, r.params);
      res.json({ message: 'Missed care items refreshed', ...added });
    } catch (error) {
      console.error('Generate missed care items error:', error);
      res.status(500).json({ error: 'Failed to refresh missed care items' });
    }
  });

  module.exports.calculateOverdueDays = calculateOverdueDays;
  module.exports.determineUrgency = determineUrgency;
};
