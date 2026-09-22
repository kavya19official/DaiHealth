'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const cleanStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

module.exports = function registerChildrenRoutes(app, { pool, authenticateToken, authorizeRole }) {
  const motherOnly = [authenticateToken, authorizeRole(['mother'])];

  async function assertChildOwned(childId, motherId) {
    const r = await pool.query(
      'SELECT * FROM children WHERE id = $1 AND mother_id = $2',
      [childId, motherId]
    );
    return r.rows[0] || null;
  }

  // List children for the signed-in mother
  app.get('/api/children', ...motherOnly, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT c.*,
           (SELECT json_build_object(
              'weight_kg', g.weight_kg, 'height_cm', g.height_cm, 'head_cm', g.head_cm,
              'log_date', g.log_date
            ) FROM child_growth_logs g
            WHERE g.child_id = c.id ORDER BY g.log_date DESC, g.id DESC LIMIT 1
           ) AS latest_growth
         FROM children c
         WHERE c.mother_id = $1
         ORDER BY c.date_of_birth DESC, c.id DESC`,
        [req.user.id]
      );
      res.json({ children: r.rows });
    } catch (err) {
      console.error('List children error:', err);
      res.status(500).json({ error: 'Failed to list children' });
    }
  });

  // Create a child profile
  app.post('/api/children', ...motherOnly, async (req, res) => {
    try {
      const full_name = cleanStr(req.body.full_name, 120);
      const date_of_birth = req.body.date_of_birth;
      const gender = cleanStr(req.body.gender, 20) || null;
      const blood_group = cleanStr(req.body.blood_group, 10) || null;
      const notes = cleanStr(req.body.notes, 500) || null;

      if (!full_name) return res.status(400).json({ error: 'Full name is required' });
      if (!isRealDate(date_of_birth)) return res.status(400).json({ error: 'Valid date of birth is required' });

      const r = await pool.query(
        `INSERT INTO children (mother_id, full_name, date_of_birth, gender, blood_group, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.user.id, full_name, date_of_birth, gender, blood_group, notes]
      );
      res.status(201).json({ child: r.rows[0] });
    } catch (err) {
      console.error('Create child error:', err);
      res.status(500).json({ error: 'Failed to create child' });
    }
  });

  // Update a child profile
  app.patch('/api/children/:id', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
      const existing = await assertChildOwned(id, req.user.id);
      if (!existing) return res.status(404).json({ error: 'Child not found' });

      const full_name = req.body.full_name !== undefined ? cleanStr(req.body.full_name, 120) : existing.full_name;
      const date_of_birth = req.body.date_of_birth !== undefined ? req.body.date_of_birth : existing.date_of_birth;
      const gender = req.body.gender !== undefined ? (cleanStr(req.body.gender, 20) || null) : existing.gender;
      const blood_group = req.body.blood_group !== undefined ? (cleanStr(req.body.blood_group, 10) || null) : existing.blood_group;
      const notes = req.body.notes !== undefined ? (cleanStr(req.body.notes, 500) || null) : existing.notes;

      if (!full_name) return res.status(400).json({ error: 'Full name is required' });
      if (!isRealDate(String(date_of_birth).slice(0, 10))) {
        return res.status(400).json({ error: 'Valid date of birth is required' });
      }

      const r = await pool.query(
        `UPDATE children SET full_name=$1, date_of_birth=$2, gender=$3, blood_group=$4, notes=$5
         WHERE id=$6 AND mother_id=$7 RETURNING *`,
        [full_name, String(date_of_birth).slice(0, 10), gender, blood_group, notes, id, req.user.id]
      );
      res.json({ child: r.rows[0] });
    } catch (err) {
      console.error('Update child error:', err);
      res.status(500).json({ error: 'Failed to update child' });
    }
  });

  // Delete a child (and cascade growth logs)
  app.delete('/api/children/:id', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
      const r = await pool.query(
        'DELETE FROM children WHERE id = $1 AND mother_id = $2 RETURNING id',
        [id, req.user.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Child not found' });
      res.json({ message: 'Child removed', id });
    } catch (err) {
      console.error('Delete child error:', err);
      res.status(500).json({ error: 'Failed to delete child' });
    }
  });

  // Growth history for one child
  app.get('/api/children/:id/growth', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
      const existing = await assertChildOwned(id, req.user.id);
      if (!existing) return res.status(404).json({ error: 'Child not found' });

      const r = await pool.query(
        `SELECT * FROM child_growth_logs
         WHERE child_id = $1 AND mother_id = $2
         ORDER BY log_date ASC, id ASC`,
        [id, req.user.id]
      );
      res.json({ growth: r.rows, child: existing });
    } catch (err) {
      console.error('Child growth list error:', err);
      res.status(500).json({ error: 'Failed to load growth' });
    }
  });

  // Add growth measurement
  app.post('/api/children/:id/growth', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
      const existing = await assertChildOwned(id, req.user.id);
      if (!existing) return res.status(404).json({ error: 'Child not found' });

      const log_date = req.body.log_date || new Date().toISOString().slice(0, 10);
      if (!isRealDate(log_date)) return res.status(400).json({ error: 'Valid log_date required' });

      const weight_kg = req.body.weight_kg != null ? Number(req.body.weight_kg) : null;
      const height_cm = req.body.height_cm != null ? Number(req.body.height_cm) : null;
      const head_cm = req.body.head_cm != null ? Number(req.body.head_cm) : null;
      const notes = cleanStr(req.body.notes, 300) || null;

      if (weight_kg != null && !isNum(weight_kg, 0.5, 80)) {
        return res.status(400).json({ error: 'weight_kg out of range' });
      }
      if (height_cm != null && !isNum(height_cm, 20, 150)) {
        return res.status(400).json({ error: 'height_cm out of range' });
      }
      if (head_cm != null && !isNum(head_cm, 20, 70)) {
        return res.status(400).json({ error: 'head_cm out of range' });
      }
      if (weight_kg == null && height_cm == null && head_cm == null) {
        return res.status(400).json({ error: 'At least one measurement is required' });
      }

      const r = await pool.query(
        `INSERT INTO child_growth_logs (child_id, mother_id, log_date, weight_kg, height_cm, head_cm, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, req.user.id, log_date, weight_kg, height_cm, head_cm, notes]
      );
      res.status(201).json({ entry: r.rows[0] });
    } catch (err) {
      console.error('Add child growth error:', err);
      res.status(500).json({ error: 'Failed to save growth' });
    }
  });

  // Delete a growth entry
  app.delete('/api/children/:childId/growth/:entryId', ...motherOnly, async (req, res) => {
    try {
      const childId = parseInt(req.params.childId, 10);
      const entryId = parseInt(req.params.entryId, 10);
      if (!Number.isInteger(childId) || !Number.isInteger(entryId)) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      const existing = await assertChildOwned(childId, req.user.id);
      if (!existing) return res.status(404).json({ error: 'Child not found' });

      const r = await pool.query(
        `DELETE FROM child_growth_logs
         WHERE id = $1 AND child_id = $2 AND mother_id = $3 RETURNING id`,
        [entryId, childId, req.user.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Entry not found' });
      res.json({ message: 'Deleted', id: entryId });
    } catch (err) {
      console.error('Delete child growth error:', err);
      res.status(500).json({ error: 'Failed to delete entry' });
    }
  });

  // Child-category milestones (vaccinations / developmental) for this mother
  app.get('/api/children/milestones', ...motherOnly, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT * FROM care_milestones
         WHERE mother_id = $1 AND category = 'child'
         ORDER BY sort_order ASC, due_date ASC`,
        [req.user.id]
      );
      res.json({ milestones: r.rows });
    } catch (err) {
      console.error('Child milestones error:', err);
      res.status(500).json({ error: 'Failed to load milestones' });
    }
  });
};
