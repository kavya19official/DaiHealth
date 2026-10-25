'use strict';

// ============================================================================
// K. Consent and sharing controls, enforced in the backend.
//
//   GET /api/patient/access            clinicians and facilities on her care team, state, last view
//   PUT /api/patient/access/:type/:ref { state: 'revoked' | 'granted', reason? }   type = doctor | facility
//   GET /api/patient/access/history    record views and blocked attempts made through DAI
//
// Rule used by every doctor path (see hasDoctorAccess / activeRelationshipSql): the doctor needs an
// appointment with the mother (the existing care-team relationship) AND no active revocation of that
// doctor, or of the facility on that appointment. A facility revoke closes only appointments at that
// facility. Paths that are not appointment based (document shares, dashboard consent) check the
// doctor revocation only.
// Not covered: access inside hospital systems, and emergency procedures there.
// ============================================================================

// SQL fragment: true when the mother has revoked this doctor (or, when facCol is given, that facility).
// Callers must pass qualified columns (alias.col) or numbered parameters: a bare column name such as
// mother_id would bind to the subquery's own column and make the revocation apply to every mother.
const SAFE_REF = /^(\$\d+(::int)?|[A-Za-z_]\w*\.[A-Za-z_]\w*)$/;
const checkRef = (v) => { if (!SAFE_REF.test(v)) throw new Error('accessControl: unqualified column reference ' + v); return v; };
const revokedSql = (motherCol, doctorCol, facCol) =>
  `EXISTS (SELECT 1 FROM patient_access_controls rc WHERE rc.mother_id = ${checkRef(motherCol)} AND rc.state = 'revoked'
     AND ((rc.grantee_type = 'doctor' AND rc.grantee_ref = ${checkRef(doctorCol)}::text)` +
  (facCol ? ` OR (rc.grantee_type = 'facility' AND ${checkRef(facCol)} IS NOT NULL AND rc.grantee_ref = ${checkRef(facCol)}::text)` : '') + '))';

// SQL fragment: the doctor has an appointment with the mother that the mother has not switched off.
const activeRelationshipSql = (motherCol, doctorCol) =>
  `EXISTS (SELECT 1 FROM appointments ra WHERE ra.mother_id = ${motherCol} AND ra.doctor_id = ${doctorCol}
     AND NOT ${revokedSql('ra.mother_id', 'ra.doctor_id', 'ra.facility_uuid')})`;

async function hasDoctorAccess(pool, doctorId, motherId) {
  return (await pool.query(`SELECT 1 WHERE ${activeRelationshipSql('$2::int', '$1::int')}`, [doctorId, motherId])).rows.length > 0;
}

async function logAccess(pool, motherId, doctorId, resource, allowed) {
  try {
    await pool.query('INSERT INTO patient_record_access_log(mother_id,doctor_id,resource,allowed) VALUES($1,$2,$3,$4)', [motherId, doctorId, resource, allowed]);
  } catch (e) { console.warn('Access log write failed:', e.message); }
}

// Parses :motherId, enforces access and records the view. Returns motherId, or null after sending 400/403.
async function gateDoctor(pool, req, res, resource) {
  const motherId = parseInt(req.params.motherId, 10);
  if (Number.isNaN(motherId)) { res.status(400).json({ error: 'Invalid patient id' }); return null; }
  const ok = await hasDoctorAccess(pool, req.user.id, motherId);
  await logAccess(pool, motherId, req.user.id, resource, ok);
  if (!ok) { res.status(403).json({ error: 'You do not have access to this patient' }); return null; }
  return motherId;
}

function registerAccessControl(app, { pool, authenticateToken, authorizeRole }) {
  const own = [authenticateToken, authorizeRole(['mother'])];
  const fail = (res, label, e) => { console.error(label + ':', e.message); res.status(500).json({ error: 'Could not complete that request' }); };

  app.get('/api/patient/access', ...own, async (req, res) => {
    try {
      const rows = (await pool.query(
        `SELECT a.doctor_id, dp.full_name, dp.specialization, dp.facility_name, a.facility_uuid::text AS facility_ref, MAX(a.requested_date) AS last_appointment
           FROM appointments a LEFT JOIN doctor_profiles dp ON dp.user_id = a.doctor_id
          WHERE a.mother_id = $1 GROUP BY a.doctor_id, dp.full_name, dp.specialization, dp.facility_name, a.facility_uuid`, [req.user.id])).rows;
      const consents = (await pool.query(
        `SELECT c.doctor_id, dp.full_name, dp.specialization, dp.facility_name FROM clinical_dashboard_consent c LEFT JOIN doctor_profiles dp ON dp.user_id = c.doctor_id
          WHERE c.mother_id = $1 AND c.revoked_at IS NULL AND c.expires_at > NOW()`, [req.user.id])).rows;
      const controls = (await pool.query('SELECT grantee_type, grantee_ref, state FROM patient_access_controls WHERE mother_id=$1', [req.user.id])).rows;
      const views = (await pool.query('SELECT doctor_id, MAX(created_at) AS last_viewed FROM patient_record_access_log WHERE mother_id=$1 AND allowed GROUP BY doctor_id', [req.user.id])).rows;
      const revoked = (type, ref) => controls.some((c) => c.grantee_type === type && c.grantee_ref === String(ref) && c.state === 'revoked');
      const viewed = new Map(views.map((v) => [v.doctor_id, v.last_viewed]));

      const doctors = new Map(), facilities = new Map();
      const addDoctor = (r, basis, lastAppt) => {
        const d = doctors.get(r.doctor_id) || { doctor_id: r.doctor_id, name: r.full_name || 'Doctor', specialization: r.specialization || null, facility_name: r.facility_name || null,
          bases: [], last_appointment: null, revoked: revoked('doctor', r.doctor_id), last_viewed: viewed.get(r.doctor_id) || null };
        if (!d.bases.includes(basis)) d.bases.push(basis);
        if (lastAppt && (!d.last_appointment || lastAppt > d.last_appointment)) d.last_appointment = lastAppt;
        doctors.set(r.doctor_id, d);
        return d;
      };
      for (const r of rows) {
        const d = addDoctor(r, 'appointment', r.last_appointment);
        if (r.facility_ref) {
          const f = facilities.get(r.facility_ref) || { facility_ref: r.facility_ref, label: r.facility_name || 'Facility on your appointments', doctors: [], revoked: revoked('facility', r.facility_ref) };
          if (!f.doctors.includes(d.name)) f.doctors.push(d.name);
          facilities.set(r.facility_ref, f);
        }
      }
      for (const c of consents) addDoctor(c, 'clinical_dashboard_consent', null);
      for (const d of doctors.values()) d.effective_access = !d.revoked;
      res.set('Cache-Control', 'no-store').json({
        doctors: [...doctors.values()], facilities: [...facilities.values()],
        note: 'Access comes from your appointments and any dashboard sharing you agreed to. Turning it off here blocks that clinician or facility from your DAI record straight away. It does not delete hospital records the law requires to be kept, and it does not change emergency procedures inside a hospital.'
      });
    } catch (e) { fail(res, 'Access list', e); }
  });

  app.put('/api/patient/access/:type/:ref', ...own, async (req, res) => {
    try {
      const type = req.params.type, ref = String(req.params.ref || '').slice(0, 80), state = req.body?.state;
      if (!['doctor', 'facility'].includes(type) || !['revoked', 'granted'].includes(state)) return res.status(400).json({ error: 'Choose a doctor or facility, and revoked or granted' });
      const related = type === 'doctor'
        ? await pool.query(`SELECT 1 FROM appointments WHERE mother_id=$1 AND doctor_id::text=$2
                            UNION SELECT 1 FROM clinical_dashboard_consent WHERE mother_id=$1 AND doctor_id::text=$2 LIMIT 1`, [req.user.id, ref])
        : await pool.query('SELECT 1 FROM appointments WHERE mother_id=$1 AND facility_uuid::text=$2 LIMIT 1', [req.user.id, ref]);
      if (!related.rows.length) return res.status(404).json({ error: 'That clinician or facility is not on your care team' });
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : null;
      await pool.query(
        `INSERT INTO patient_access_controls(mother_id,grantee_type,grantee_ref,state,reason) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (mother_id,grantee_type,grantee_ref) DO UPDATE SET state=EXCLUDED.state, reason=EXCLUDED.reason, updated_at=NOW()`,
        [req.user.id, type, ref, state, reason]);
      await pool.query('INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,$2,$3)',
        [req.user.id, state === 'revoked' ? 'access_revoked' : 'access_granted', JSON.stringify({ grantee_type: type, grantee_ref: ref })]);
      res.json({ state, message: state === 'revoked' ? 'Access turned off. It takes effect immediately.' : 'Access restored.' });
    } catch (e) { fail(res, 'Access update', e); }
  });

  app.get('/api/patient/access/history', ...own, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const r = await pool.query(
        `SELECT resource, allowed, created_at, doctor_name FROM (
            SELECT l.resource, l.allowed, l.created_at, dp.full_name AS doctor_name
              FROM patient_record_access_log l LEFT JOIN doctor_profiles dp ON dp.user_id = l.doctor_id WHERE l.mother_id = $1
            UNION ALL
            SELECT 'care_workspace_roster', TRUE, e.created_at, dp.full_name
              FROM patient_access_events e LEFT JOIN doctor_profiles dp ON dp.user_id = (e.details->>'doctor_id')::int
             WHERE e.mother_id = $1 AND e.event_type = 'doctor_workspace_read') h
          ORDER BY created_at DESC LIMIT $2`, [req.user.id, limit]);
      res.set('Cache-Control', 'no-store').json({
        entries: r.rows,
        coverage: 'Shows views made through DAI clinician screens, and attempts that were blocked. It does not show access inside a hospital\u2019s own systems.'
      });
    } catch (e) { fail(res, 'Access history', e); }
  });
}

module.exports = registerAccessControl;
Object.assign(module.exports, { hasDoctorAccess, gateDoctor, logAccess, revokedSql, activeRelationshipSql });
