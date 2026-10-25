'use strict';

// ============================================================================
// L. Postpartum and child follow-through: reason for delay.
//   GET    /api/follow-through                 her recorded delays (completed items are dropped)
//   PUT    /api/follow-through/delays          { kind, item_code, child_id?, reason, note?, new_target? }
//   DELETE /api/follow-through/delays          { kind, item_code, child_id? }
//   GET    /api/doctor/patients/:motherId/follow-through   (relationship + revocation checked)
// Schedules come from the verified shared rules (shared/postpartum-rules.js,
// shared/child-reference.js). A recorded reason never marks anything done, never
// changes a due date, and never replaces a clinician's advice.
// ============================================================================

const PP = require('../shared/postpartum-rules');
const Ref = require('../shared/child-reference');
const access = require('./accessControl');

const REASONS = {
  mother_unwell: 'I was unwell',
  child_unwell: 'My baby was unwell',
  clinician_advised: 'My doctor or nurse advised waiting',
  facility_closed: 'The centre was closed or no session was held',
  vaccine_unavailable: 'The vaccine or service was not available',
  travel_cost: 'Travel or cost was a problem',
  family_reasons: 'Family or work reasons',
  other: 'Other'
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => typeof s === 'string' && DATE_RE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

function validate(body) {
  const kind = body?.kind, code = typeof body?.item_code === 'string' ? body.item_code.slice(0, 30) : '';
  if (!['postpartum_contact', 'vaccine'].includes(kind)) return { error: 'Choose a postnatal visit or a vaccine' };
  if (kind === 'postpartum_contact' && !PP.CONTACTS.some((c) => c.code === code)) return { error: 'Unknown postnatal visit' };
  if (kind === 'vaccine' && !Object.prototype.hasOwnProperty.call(Ref.VACCINE_BY_CODE, code)) return { error: 'Unknown vaccine' };
  return { kind, code };
}

module.exports = function registerFollowThrough(app, { pool, authenticateToken, authorizeRole }) {
  const own = [authenticateToken, authorizeRole(['mother'])];
  const fail = (res, label, e) => { console.error(label + ':', e.message); res.status(500).json({ error: 'Could not complete that request' }); };
  const childOf = async (motherId, childId) => (await pool.query('SELECT id FROM children WHERE id=$1 AND mother_id=$2', [childId, motherId])).rows[0];

  async function listFor(motherId) {
    const r = await pool.query(
      `SELECT d.kind, d.item_code, d.child_id, d.reason, d.note, to_char(d.new_target,'YYYY-MM-DD') AS new_target, d.recorded_at
         FROM follow_through_delays d
        WHERE d.mother_id=$1
          AND NOT (d.kind='postpartum_contact' AND EXISTS (SELECT 1 FROM postpartum_contacts p WHERE p.mother_id=d.mother_id AND p.contact_code=d.item_code))
          AND NOT (d.kind='vaccine' AND EXISTS (SELECT 1 FROM child_vaccinations v WHERE v.child_id=d.child_id AND v.vaccine_code=d.item_code))
        ORDER BY d.recorded_at DESC`, [motherId]);
    return r.rows.map((x) => ({ ...x, reason_label: REASONS[x.reason] || x.reason }));
  }

  app.get('/api/follow-through', ...own, async (req, res) => {
    try { res.json({ delays: await listFor(req.user.id), reasons: REASONS }); }
    catch (e) { fail(res, 'Follow-through list', e); }
  });

  app.put('/api/follow-through/delays', ...own, async (req, res) => {
    try {
      const v = validate(req.body); if (v.error) return res.status(400).json({ error: v.error });
      const b = req.body, reason = b.reason;
      if (!Object.prototype.hasOwnProperty.call(REASONS, reason)) return res.status(400).json({ error: 'Choose a reason' });
      let childId = null;
      if (v.kind === 'vaccine') {
        childId = Number(b.child_id);
        if (!Number.isInteger(childId) || !(await childOf(req.user.id, childId))) return res.status(404).json({ error: 'Child not found' });
        if ((await pool.query('SELECT 1 FROM child_vaccinations WHERE child_id=$1 AND vaccine_code=$2', [childId, v.code])).rows.length) return res.status(409).json({ error: 'That vaccine is already recorded as given' });
      } else if ((await pool.query('SELECT 1 FROM postpartum_contacts WHERE mother_id=$1 AND contact_code=$2', [req.user.id, v.code])).rows.length) {
        return res.status(409).json({ error: 'That visit is already recorded as done' });
      }
      let target = null;
      if (b.new_target != null && b.new_target !== '') {
        if (!isRealDate(b.new_target)) return res.status(400).json({ error: 'Enter a valid date' });
        const today = (await pool.query("SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') AS d")).rows[0].d;
        if (b.new_target < today) return res.status(400).json({ error: 'A new target date cannot be in the past' });
        target = b.new_target;
      }
      const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : null;
      await pool.query(
        `INSERT INTO follow_through_delays(mother_id,child_id,kind,item_code,reason,note,new_target) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (mother_id, kind, item_code, COALESCE(child_id, 0))
         DO UPDATE SET reason=EXCLUDED.reason, note=EXCLUDED.note, new_target=EXCLUDED.new_target, recorded_at=NOW()`,
        [req.user.id, childId, v.kind, v.code, reason, note, target]);
      res.json({ message: 'Reason saved. This does not mark the visit or vaccine as done.', delays: await listFor(req.user.id) });
    } catch (e) { fail(res, 'Follow-through save', e); }
  });

  app.delete('/api/follow-through/delays', ...own, async (req, res) => {
    try {
      const v = validate(req.body); if (v.error) return res.status(400).json({ error: v.error });
      const childId = v.kind === 'vaccine' ? Number(req.body.child_id) : null;
      await pool.query('DELETE FROM follow_through_delays WHERE mother_id=$1 AND kind=$2 AND item_code=$3 AND COALESCE(child_id,0)=COALESCE($4::int,0)', [req.user.id, v.kind, v.code, childId]);
      res.json({ message: 'Reason removed' });
    } catch (e) { fail(res, 'Follow-through delete', e); }
  });

  app.get('/api/doctor/patients/:motherId/follow-through', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      const motherId = await access.gateDoctor(pool, req, res, 'follow_through'); if (motherId == null) return;
      res.json({ delays: await listFor(motherId) });
    } catch (e) { fail(res, 'Doctor follow-through', e); }
  });
};
module.exports.REASONS = REASONS;
module.exports.validate = validate;
