'use strict';

// ============================================================================
// O. Patient-friendly visit summary, written and approved by the clinician.
//
//   Doctor:
//     GET    /api/doctor/visit-summaries                    recent visits and their summary status
//     GET    /api/doctor/visit-summaries/:appointmentId     draft, approved version and plain-language hints
//     PUT    /api/doctor/visit-summaries/:appointmentId     save the draft
//     POST   /api/doctor/visit-summaries/:appointmentId/approve
//   Patient:
//     GET    /api/patient/visit-summaries                   approved summaries only, plus the next appointment
//     POST   /api/patient/visit-summaries/:id/seen
//
// Safety rules enforced here:
//  - The server never writes or suggests clinical content. It stores what the clinician typed.
//  - A patient can only ever read an 'approved' summary. Drafts and superseded versions are never returned.
//  - Only the clinician who saw the patient can write or approve, and only for a visit that has happened.
//  - A mother who turned that doctor off (see accessControl.js) blocks writing, but she keeps her own copies.
//  - There is no medicine field. The plain-language checker only flags doses and jargon.
// ============================================================================

const PlainLanguage = require('../shared/plain-language');
const access = require('./accessControl');
const { verifiedDoctor } = require('./clinicalDashboard');

const LIMITS = { summary: 1200, step: 200, steps: 8, tests: 8, testName: 100, testNote: 200, followText: 300 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => typeof s === 'string' && DATE_RE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');

// Validates and normalises what the clinician typed. Returns { content } or { error }.
function sanitize(body) {
  const b = body || {};
  const steps = (Array.isArray(b.next_steps) ? b.next_steps : []).map((s) => clean(s, LIMITS.step)).filter(Boolean);
  if (steps.length > LIMITS.steps) return { error: 'Please keep to ' + LIMITS.steps + ' next steps or fewer' };
  const tests = [];
  for (const t of Array.isArray(b.pending_tests) ? b.pending_tests : []) {
    const name = clean(t && t.name, LIMITS.testName); if (!name) continue;
    const item = { name }; const note = clean(t.note, LIMITS.testNote); if (note) item.note = note;
    if (t.due_date) { if (!isRealDate(t.due_date)) return { error: 'A test date is not valid' }; item.due_date = t.due_date; }
    tests.push(item);
  }
  if (tests.length > LIMITS.tests) return { error: 'Please keep to ' + LIMITS.tests + ' tests or fewer' };
  const f = b.follow_up || {}, follow = {}; const ft = clean(f.text, LIMITS.followText); if (ft) follow.text = ft;
  if (f.due_date) { if (!isRealDate(f.due_date)) return { error: 'The follow-up date is not valid' }; follow.due_date = f.due_date; }
  return { content: { summary_text: clean(b.summary_text, LIMITS.summary), next_steps: steps, follow_up: follow, pending_tests: tests } };
}
const isEmpty = (c) => !c.summary_text && !c.next_steps.length && !c.pending_tests.length && !c.follow_up.text && !c.follow_up.due_date;
const allText = (c) => [c.summary_text, ...(c.next_steps || []), (c.follow_up || {}).text, ...(c.pending_tests || []).map((t) => t.name + ' ' + (t.note || ''))].filter(Boolean).join('. ');

function registerVisitSummary(app, { pool, authenticateToken, authorizeRole }) {
  const doctorOnly = [authenticateToken, authorizeRole(['doctor'])];
  const mine = [authenticateToken, authorizeRole(['mother'])];
  const fail = (res, label, e) => { console.error(label + ':', e.message); res.status(500).json({ error: 'Could not complete that request' }); };

  // Loads the appointment, checks the caller is the clinician who saw the patient and still has access.
  async function ownAppointment(req, res, { mustHaveHappened }) {
    const id = Number(req.params.appointmentId);
    if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid visit' }); return null; }
    if (!(await verifiedDoctor(pool, req.user.id))) { res.status(403).json({ error: 'Visit summaries are limited to verified clinicians' }); return null; }
    const a = (await pool.query(
      `SELECT a.id, a.mother_id, a.doctor_id, a.status, a.reason, to_char(a.requested_date,'YYYY-MM-DD') AS visit_date,
              (a.requested_date <= CURRENT_DATE) AS happened, mp.full_name AS patient_name
         FROM appointments a LEFT JOIN mother_profiles mp ON mp.user_id = a.mother_id WHERE a.id = $1`, [id])).rows[0];
    if (!a || a.doctor_id !== req.user.id) { res.status(404).json({ error: 'Visit not found' }); return null; }
    const ok = await access.hasDoctorAccess(pool, req.user.id, a.mother_id);
    await access.logAccess(pool, a.mother_id, req.user.id, 'visit_summary', ok);
    if (!ok) { res.status(403).json({ error: 'You do not have access to this patient' }); return null; }
    if (mustHaveHappened && (a.status === 'cancelled' || !a.happened)) { res.status(409).json({ error: 'A summary can only be written for a visit that took place' }); return null; }
    return a;
  }
  const rowOut = (r) => r && ({ id: r.id, version: r.version, status: r.status, summary_text: r.summary_text, next_steps: r.next_steps, follow_up: r.follow_up, pending_tests: r.pending_tests, approved_at: r.approved_at, patient_seen_at: r.patient_seen_at, updated_at: r.updated_at });

  // ---------------- doctor ----------------
  app.get('/api/doctor/visit-summaries', ...doctorOnly, async (req, res) => {
    try {
      if (!(await verifiedDoctor(pool, req.user.id))) return res.status(403).json({ error: 'Visit summaries are limited to verified clinicians' });
      const r = await pool.query(
        `SELECT a.id, to_char(a.requested_date,'YYYY-MM-DD') AS visit_date, a.reason, a.status AS visit_status, mp.full_name AS patient_name,
                ap.approved_at, ap.patient_seen_at, ap.version,
                EXISTS (SELECT 1 FROM visit_summaries d WHERE d.appointment_id = a.id AND d.status = 'draft') AS has_draft
           FROM appointments a
           JOIN mother_profiles mp ON mp.user_id = a.mother_id
           LEFT JOIN visit_summaries ap ON ap.appointment_id = a.id AND ap.status = 'approved'
          WHERE a.doctor_id = $1 AND a.status <> 'cancelled' AND a.requested_date <= CURRENT_DATE AND a.requested_date >= CURRENT_DATE - 60
            AND NOT ${access.revokedSql('a.mother_id', 'a.doctor_id', 'a.facility_uuid')}
          ORDER BY a.requested_date DESC, a.id DESC LIMIT 100`, [req.user.id]);
      res.set('Cache-Control', 'no-store').json({ visits: r.rows.map((x) => ({ ...x, summary_status: x.approved_at ? 'approved' : x.has_draft ? 'draft' : 'none' })) });
    } catch (e) { fail(res, 'Visit list', e); }
  });

  app.get('/api/doctor/visit-summaries/:appointmentId', ...doctorOnly, async (req, res) => {
    try {
      const a = await ownAppointment(req, res, { mustHaveHappened: false }); if (!a) return;
      const rows = (await pool.query("SELECT * FROM visit_summaries WHERE appointment_id=$1 AND status IN ('draft','approved')", [a.id])).rows;
      const draft = rows.find((x) => x.status === 'draft'), approved = rows.find((x) => x.status === 'approved');
      res.set('Cache-Control', 'no-store').json({
        visit: { id: a.id, visit_date: a.visit_date, reason: a.reason, patient_name: a.patient_name, can_write: a.happened && a.status !== 'cancelled' },
        draft: rowOut(draft) || null, approved: rowOut(approved) || null,
        hints: draft ? PlainLanguage.check(allText(draft)) : [],
        reminder: 'Write only instructions you have decided. Medicines and doses belong on your signed prescription.'
      });
    } catch (e) { fail(res, 'Visit summary load', e); }
  });

  app.put('/api/doctor/visit-summaries/:appointmentId', ...doctorOnly, async (req, res) => {
    try {
      const a = await ownAppointment(req, res, { mustHaveHappened: true }); if (!a) return;
      const s = sanitize(req.body); if (s.error) return res.status(400).json({ error: s.error });
      const c = s.content;
      const r = await pool.query(
        `INSERT INTO visit_summaries(appointment_id, mother_id, doctor_id, status, summary_text, next_steps, follow_up, pending_tests)
         VALUES ($1,$2,$3,'draft',$4,$5::jsonb,$6::jsonb,$7::jsonb)
         ON CONFLICT (appointment_id) WHERE status = 'draft'
         DO UPDATE SET summary_text = EXCLUDED.summary_text, next_steps = EXCLUDED.next_steps, follow_up = EXCLUDED.follow_up,
                       pending_tests = EXCLUDED.pending_tests, doctor_id = EXCLUDED.doctor_id, updated_at = NOW()
         RETURNING *`,
        [a.id, a.mother_id, req.user.id, c.summary_text || null, JSON.stringify(c.next_steps), JSON.stringify(c.follow_up), JSON.stringify(c.pending_tests)]);
      res.json({ draft: rowOut(r.rows[0]), hints: PlainLanguage.check(allText(c)), message: 'Draft saved. The patient cannot see it until you approve it.' });
    } catch (e) { fail(res, 'Visit summary save', e); }
  });

  app.post('/api/doctor/visit-summaries/:appointmentId/approve', ...doctorOnly, async (req, res) => {
    let client;
    try {
      const a = await ownAppointment(req, res, { mustHaveHappened: true }); if (!a) return;
      client = await pool.connect();
      await client.query('BEGIN');
      const draft = (await client.query("SELECT * FROM visit_summaries WHERE appointment_id=$1 AND status='draft' FOR UPDATE", [a.id])).rows[0];
      if (!draft) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Save a draft first' }); }
      if (isEmpty({ summary_text: draft.summary_text, next_steps: draft.next_steps, follow_up: draft.follow_up, pending_tests: draft.pending_tests })) {
        await client.query('ROLLBACK'); return res.status(400).json({ error: 'The summary is empty' });
      }
      const next = Number((await client.query('SELECT COALESCE(MAX(version),0) + 1 AS v FROM visit_summaries WHERE appointment_id=$1', [a.id])).rows[0].v);
      await client.query("UPDATE visit_summaries SET status='superseded', updated_at=NOW() WHERE appointment_id=$1 AND status='approved'", [a.id]);
      const r = await client.query(
        "UPDATE visit_summaries SET status='approved', version=$2, approved_at=NOW(), approved_by=$3, patient_seen_at=NULL, updated_at=NOW() WHERE id=$1 RETURNING *",
        [draft.id, next, req.user.id]);
      await client.query('COMMIT');
      res.json({ approved: rowOut(r.rows[0]), message: 'Approved. The patient can now see this summary.' });
    } catch (e) { try { if (client) await client.query('ROLLBACK'); } catch (x) { /* already closed */ } fail(res, 'Visit summary approve', e); }
    finally { if (client) client.release(); }
  });

  // ---------------- patient ----------------
  app.get('/api/patient/visit-summaries', ...mine, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT s.id, s.version, s.summary_text, s.next_steps, s.follow_up, s.pending_tests, s.approved_at, s.patient_seen_at,
                to_char(a.requested_date,'YYYY-MM-DD') AS visit_date, a.reason, dp.full_name AS clinician, dp.specialization, dp.facility_name
           FROM visit_summaries s JOIN appointments a ON a.id = s.appointment_id LEFT JOIN doctor_profiles dp ON dp.user_id = s.doctor_id
          WHERE s.mother_id = $1 AND s.status = 'approved'
          ORDER BY a.requested_date DESC, s.approved_at DESC LIMIT 20`, [req.user.id]);
      const next = (await pool.query(
        `SELECT a.id, to_char(a.requested_date,'YYYY-MM-DD') AS date, a.requested_time::text AS time, a.status, a.reason, dp.full_name AS clinician, dp.facility_name
           FROM appointments a LEFT JOIN doctor_profiles dp ON dp.user_id = a.doctor_id
          WHERE a.mother_id = $1 AND a.requested_date >= CURRENT_DATE AND a.status IN ('pending','confirmed')
          ORDER BY a.requested_date, a.requested_time NULLS LAST LIMIT 1`, [req.user.id])).rows[0] || null;
      res.set('Cache-Control', 'no-store').json({
        summaries: r.rows,
        next_appointment: next && { ...next, confirmed: next.status === 'confirmed' },
        notice: 'This was written and confirmed by your clinician. It does not replace your prescription. If you feel worse, or have a danger sign, go to the nearest health facility or call 112.'
      });
    } catch (e) { fail(res, 'Patient visit summaries', e); }
  });

  app.post('/api/patient/visit-summaries/:id/seen', ...mine, async (req, res) => {
    try {
      const id = Number(req.params.id); if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid summary' });
      const r = await pool.query("UPDATE visit_summaries SET patient_seen_at = COALESCE(patient_seen_at, NOW()) WHERE id=$1 AND mother_id=$2 AND status='approved' RETURNING id", [id, req.user.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Summary not found' });
      res.json({ ok: true });
    } catch (e) { fail(res, 'Visit summary seen', e); }
  });
}

module.exports = registerVisitSummary;
Object.assign(module.exports, { sanitize, isEmpty, allText, LIMITS });
