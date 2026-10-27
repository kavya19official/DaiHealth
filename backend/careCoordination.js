'use strict';
// ============================================================================
// C. Sustainability-aware care coordination
//  - Digital-first: clinician-verified visit instructions, test preparation and follow-up summaries.
//    A pack marked in_person_required always tells the patient to attend; digital never replaces it.
//  - Right facility: required clinical capability is an eligibility gate first, then location, then
//    availability. Referral journeys record whether care happened first time or needed more searching.
//  - Duplicate work: authorised clinicians see shared prior reports and referral status. Recording a
//    test decision never blocks or suggests a repeat test: the clinician decides.
//  - Preventive follow-up: care-gap queue plus outcome events. Evaluation reports counts only; it does
//    not claim prevented deterioration, emergency use, travel or carbon.
// ============================================================================
const { parsePreferences, rankFacilities } = require('./facilityMatching');
const { resolveLocation } = require('./delhiGazetteer');
const { FACILITY_ROWS_SQL } = require('./facilityDiscovery');
const access = require('./accessControl');
const PlainLanguage = require('../shared/plain-language');

// Mirrors the facility_capabilities CHECK constraint in db/facility_discovery.sql.
const CAPABILITIES = ['high_risk_pregnancy', 'emergency_maternity', 'c_section_24x7', 'blood_transfusion', 'neonatal_surgery', 'icu_mother', 'telemedicine', 'home_visits', 'mental_health_support'];
const KINDS = ['visit_instructions', 'test_preparation', 'follow_up_summary'];
const FEEDBACK = ['avoided_trip', 'avoided_paperwork', 'still_needed_visit', 'unclear'];
const JOURNEY_OUTCOMES = ['pending', 'seen_first_visit', 'redirected', 'failed_visit', 'not_attended'];
const FAILURE_REASONS = ['capability_unavailable', 'closed_or_no_slot', 'turned_away', 'transport', 'cost', 'other'];
const TEST_DECISIONS = ['prior_result_used', 'repeat_clinically_indicated', 'repeat_prior_unavailable', 'repeat_other'];
const FOLLOWUP_ACTIONS = ['reminder_sent', 'contacted', 'booked'];
const FOLLOWUP_OUTCOMES = ['pending', 'completed', 'rescheduled', 'unreachable', 'declined'];
const GAP_KEY = /^(missed|followup):([1-9]\d{0,9})$/;

const NOTICES = {
  pack: 'Written and verified by your clinician. If it says an in-person visit is needed, please attend. If you feel unwell, seek care now; do not wait for a message.',
  test: 'Prior reports are shown so a test is not repeated only because a record was missing. Whether to repeat a test is always the clinician\'s decision.',
  evaluation: 'Counts of recorded events only. Reminders are not assumed to prevent deterioration or emergency use, and no travel, carbon or cost savings are calculated. Missing data stays missing.',
  match: 'Facilities without the required clinical capability are excluded first; the rest are ordered by distance, then availability. Call to confirm before travelling.',
};

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const intOrNull = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isInteger(n) && n > 0 ? n : NaN; };
const pick = (v, list) => (list.includes(v) ? v : null);
class Bad extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }

function validatePack(b = {}) {
  const kind = pick(b.kind, KINDS); if (!kind) throw new Bad(400, 'Choose visit instructions, test preparation or follow-up summary');
  const title = clean(b.title, 160); if (title.length < 3) throw new Bad(400, 'Add a short title');
  const body = clean(b.body, 2000); if (body.length < 10) throw new Bad(400, 'Add the instructions (at least a sentence)');
  const inPerson = b.in_person_required === true;
  const reason = clean(b.in_person_reason, 300);
  if (inPerson && reason.length < 5) throw new Bad(400, 'Say why an in-person visit is needed');
  return { kind, title, body, in_person_required: inPerson, in_person_reason: inPerson ? reason : null };
}

function validateJourney(b = {}) {
  const care_need = clean(b.care_need, 100); if (care_need.length < 2) throw new Bad(400, 'Say what care was needed');
  const outcome = b.outcome === undefined ? 'pending' : pick(b.outcome, JOURNEY_OUTCOMES);
  if (!outcome) throw new Bad(400, 'Unknown referral outcome');
  let failure_reason = null;
  if (b.failure_reason !== undefined && b.failure_reason !== null && b.failure_reason !== '') {
    failure_reason = pick(b.failure_reason, FAILURE_REASONS);
    if (!failure_reason) throw new Bad(400, 'Unknown failure reason');
    if (!['redirected', 'failed_visit', 'not_attended'].includes(outcome)) throw new Bad(400, 'A failure reason only applies when the visit did not go ahead');
  }
  let prior_searches = null;
  if (b.prior_searches !== undefined && b.prior_searches !== null && b.prior_searches !== '') {
    prior_searches = Number(b.prior_searches);
    if (!Number.isInteger(prior_searches) || prior_searches < 0 || prior_searches > 20) throw new Bad(400, 'Prior searches must be 0 to 20');
  }
  const facility_id = intOrNull(b.facility_id), referral_id = intOrNull(b.referral_id);
  if (Number.isNaN(facility_id) || Number.isNaN(referral_id)) throw new Bad(400, 'Invalid facility or referral');
  return { care_need, outcome, failure_reason, prior_searches, facility_id, referral_id, note: clean(b.note, 300) || null };
}

function validateTestDecision(b = {}) {
  const test_name = clean(b.test_name, 100); if (test_name.length < 2) throw new Bad(400, 'Name the test');
  const decision = pick(b.decision, TEST_DECISIONS); if (!decision) throw new Bad(400, 'Unknown test decision');
  const reason = clean(b.reason, 300);
  if (decision.startsWith('repeat_') && reason.length < 5) throw new Bad(400, 'Record the clinical reason for repeating the test');
  const document_id = intOrNull(b.document_id); if (Number.isNaN(document_id)) throw new Bad(400, 'Invalid report');
  return { test_name, decision, reason: reason || null, document_id };
}

function validateFollowup(b = {}) {
  const m = GAP_KEY.exec(String(b.gap_key || '')); if (!m) throw new Bad(400, 'Unknown care gap');
  const action = pick(b.action, FOLLOWUP_ACTIONS); if (!action) throw new Bad(400, 'Unknown follow-up action');
  const outcome = b.outcome === undefined ? 'pending' : pick(b.outcome, FOLLOWUP_OUTCOMES); if (!outcome) throw new Bad(400, 'Unknown follow-up outcome');
  const mother_id = intOrNull(b.mother_id); if (!mother_id) throw new Bad(400, 'Invalid patient');
  return { mother_id, gap_key: b.gap_key, gap_type: m[1], gap_id: Number(m[2]), action, outcome, emergency_use_reported: b.emergency_use_reported === true, note: clean(b.note, 300) || null };
}

// Capability first (already an eligibility gate inside rankFacilities), then location, then availability.
function coordinationOrder(ranked, capability, now = new Date()) {
  const slots = (f) => (Array.isArray(f.slots) ? f.slots : []).filter((s) => new Date(s.starts_at) > now && Number(s.available_places) > 0).length;
  return ranked
    .map((f) => ({
      id: f.id, name: f.name, address: f.address || null, phone: f.phone || null,
      distance_km: f.distance_km == null ? null : Math.round(Number(f.distance_km) * 10) / 10,
      open_slots: slots(f),
      coordination: { order: ['clinical_capability', 'location', 'availability'], capability, capability_confirmed: true, availability: slots(f) ? 'slots_reported' : 'not_reported' },
    }))
    .sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) || b.open_slots - a.open_slots || String(a.name).localeCompare(String(b.name)));
}

// Open care gaps (missed-care items + approved follow-ups now due without a later booking) with the latest outcome.
async function careGaps(db, scope, params) {
  const rows = (await db.query(
    `SELECT * FROM (
       SELECT 'missed:'||mci.id AS gap_key, mci.mother_id, mp.full_name AS patient_name, mci.title, mci.due_date::date AS due_date, mci.urgency_level AS urgency, 'missed_care' AS source
         FROM missed_care_items mci JOIN mother_profiles mp ON mp.user_id=mci.mother_id
        WHERE mci.status IN ('pending','in_progress') AND ${scope('mci.mother_id')}
       UNION ALL
       SELECT 'followup:'||s.id, s.mother_id, mp.full_name, COALESCE(NULLIF(s.follow_up->>'text',''),'Follow-up visit'), (s.follow_up->>'due_date')::date, 'routine', 'visit_summary'
         FROM visit_summaries s JOIN appointments a ON a.id=s.appointment_id JOIN mother_profiles mp ON mp.user_id=s.mother_id
        WHERE s.status='approved' AND COALESCE(s.follow_up->>'due_date','')<>'' AND (s.follow_up->>'due_date')::date <= CURRENT_DATE + 7
          AND NOT EXISTS (SELECT 1 FROM appointments n WHERE n.mother_id=s.mother_id AND n.id<>a.id AND n.requested_date>a.requested_date AND n.status<>'cancelled')
          AND ${scope('s.mother_id')}
     ) g ORDER BY g.due_date NULLS LAST, g.gap_key LIMIT 100`, params)).rows;
  if (!rows.length) return [];
  const latest = (await db.query(
    `SELECT DISTINCT ON (mother_id, gap_key) mother_id, gap_key, action, outcome, emergency_use_reported, created_at
       FROM preventive_followup_events WHERE mother_id = ANY($1::int[]) ORDER BY mother_id, gap_key, created_at DESC`,
    [[...new Set(rows.map((r) => r.mother_id))]])).rows;
  const byKey = new Map(latest.map((e) => [e.mother_id + '|' + e.gap_key, e]));
  return rows.map((r) => ({ ...r, last_event: byKey.get(r.mother_id + '|' + r.gap_key) || null }));
}

function countBy(rows, key) { const o = {}; for (const r of rows) o[r[key]] = Number(r.n); return o; }

module.exports = function registerCareCoordination(app, { pool, authenticateToken, authorizeRole }) {
  const { verifiedDoctor } = require('./clinicalDashboard');
  const mother = [authenticateToken, authorizeRole(['mother'])];
  const doctor = [authenticateToken, authorizeRole(['doctor'])];
  const handle = (label, fn) => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { await fn(req, res); } catch (e) {
      if (e instanceof Bad) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
      console.error('Care coordination ' + label + ':', e.message);
      res.status(500).json({ error: 'Could not complete this care-coordination request' });
    }
  };
  async function gateDoctor(req, motherId, resource) {
    if (!Number.isInteger(motherId) || motherId < 1) throw new Bad(400, 'Invalid patient');
    const ok = (await verifiedDoctor(pool, req.user.id)) && (await access.hasDoctorAccess(pool, req.user.id, motherId));
    await access.logAccess(pool, motherId, req.user.id, resource, ok);
    if (!ok) throw new Bad(403, 'A verified clinician connected to this patient is required');
  }
  async function capabilityMatched(facilityId, careNeed) {
    if (!facilityId) return null;
    const f = (await pool.query('SELECT id FROM facilities WHERE id=$1', [facilityId])).rows[0];
    if (!f) throw new Bad(404, 'Facility not found');
    if (!CAPABILITIES.includes(careNeed)) return null;
    return (await pool.query('SELECT 1 FROM facility_capabilities WHERE facility_id=$1 AND capability=$2 AND available=TRUE', [facilityId, careNeed])).rows.length > 0;
  }
  async function saveJourney(motherId, req, body) {
    const j = validateJourney(body);
    if (j.referral_id && !(await pool.query('SELECT 1 FROM referrals WHERE id=$1 AND patient_id=$2', [j.referral_id, motherId])).rows.length) throw new Bad(404, 'Referral not found');
    const matched = await capabilityMatched(j.facility_id, j.care_need);
    return (await pool.query(
      `INSERT INTO referral_journeys(mother_id,recorded_by,recorder_role,facility_id,referral_id,care_need,capability_matched,prior_searches,outcome,failure_reason,note)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [motherId, req.user.id, req.user.role, j.facility_id, j.referral_id, j.care_need, matched, j.prior_searches, j.outcome, j.failure_reason, j.note])).rows[0];
  }
  async function updateJourney(id, motherId, body) {
    const outcome = pick(body.outcome, JOURNEY_OUTCOMES); if (!outcome) throw new Bad(400, 'Unknown referral outcome');
    const j = validateJourney({ care_need: 'update', outcome, failure_reason: body.failure_reason, note: body.note });
    const row = (await pool.query(
      'UPDATE referral_journeys SET outcome=$1,failure_reason=$2,note=COALESCE($3,note),updated_at=NOW() WHERE id=$4 AND mother_id=$5 RETURNING *',
      [outcome, j.failure_reason, j.note, id, motherId])).rows[0];
    if (!row) throw new Bad(404, 'Referral journey not found');
    return row;
  }

  // ---- Facility match: capability -> location -> availability -------------------------------------
  app.get('/api/care-coordination/facility-match', authenticateToken, authorizeRole(['mother', 'doctor']), handle('match', async (req, res) => {
    const capability = String(req.query.capability || '');
    if (!CAPABILITIES.includes(capability)) throw new Bad(400, 'Choose the clinical capability needed', { capabilities: CAPABILITIES });
    const q = { capability, max_distance_km: req.query.max_distance_km || '25' };
    let location = null;
    if (req.query.user_lat && req.query.user_lon) { q.user_lat = req.query.user_lat; q.user_lon = req.query.user_lon; }
    else if (req.query.locality || req.query.pincode) {
      const r = resolveLocation({ locality: req.query.locality, pincode: req.query.pincode, city: 'Delhi' });
      if (!r.ok) throw new Bad(400, r.message);
      q.user_lat = String(r.latitude); q.user_lon = String(r.longitude); location = r.label;
    }
    let prefs; try { prefs = parsePreferences(q); } catch (e) { throw new Bad(400, e.message); }
    const rows = (await pool.query(FACILITY_ROWS_SQL + ' AND EXISTS (SELECT 1 FROM facility_capabilities c WHERE c.facility_id=f.id AND c.capability=$1 AND c.available=TRUE)', [capability])).rows;
    const facilities = coordinationOrder(rankFacilities(rows, prefs), capability).slice(0, 10);
    res.json({ capability, location, facilities, notice: NOTICES.match });
  }));

  // ---- Patient --------------------------------------------------------------------------------------
  app.get('/api/patient/care-coordination', ...mother, handle('patient view', async (req, res) => {
    const id = req.user.id;
    const [packs, referrals, facilityReferrals, journeys, gaps] = await Promise.all([
      pool.query(`SELECT p.id,p.kind,p.title,p.body,p.in_person_required,p.in_person_reason,p.verified_at,p.patient_seen_at,dp.full_name AS clinician,fb.outcome AS feedback
                    FROM care_instruction_packs p LEFT JOIN doctor_profiles dp ON dp.user_id=p.doctor_id LEFT JOIN care_pack_feedback fb ON fb.pack_id=p.id
                   WHERE p.mother_id=$1 AND p.status='verified' ORDER BY p.verified_at DESC LIMIT 30`, [id]),
      pool.query(`SELECT id,referral_type,priority,status,patient_instructions,appointment_date,created_at FROM referrals WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
      pool.query(`SELECT fr.id,f.name AS facility_name,fr.status,fr.created_at FROM facility_referrals fr LEFT JOIN facilities f ON f.id=fr.to_facility_id WHERE fr.user_id=$1 ORDER BY fr.created_at DESC LIMIT 20`, [id]),
      pool.query(`SELECT j.id,j.care_need,j.outcome,j.failure_reason,j.prior_searches,j.capability_matched,j.created_at,f.name AS facility_name FROM referral_journeys j LEFT JOIN facilities f ON f.id=j.facility_id WHERE j.mother_id=$1 ORDER BY j.created_at DESC LIMIT 20`, [id]),
      careGaps(pool, (col) => `${col}=$1`, [id]),
    ]);
    res.json({
      packs: packs.rows, referrals: referrals.rows, facility_referrals: facilityReferrals.rows, journeys: journeys.rows,
      follow_ups: gaps.map(({ patient_name, ...g }) => g), notice: NOTICES.pack,
    });
  }));
  app.post('/api/patient/care-coordination/packs/:id/seen', ...mother, handle('seen', async (req, res) => {
    const r = await pool.query("UPDATE care_instruction_packs SET patient_seen_at=COALESCE(patient_seen_at,NOW()) WHERE id=$1 AND mother_id=$2 AND status='verified' RETURNING id", [Number(req.params.id) || 0, req.user.id]);
    if (!r.rows.length) throw new Bad(404, 'Instructions not found');
    res.json({ ok: true });
  }));
  app.post('/api/patient/care-coordination/packs/:id/feedback', ...mother, handle('feedback', async (req, res) => {
    const outcome = pick(req.body && req.body.outcome, FEEDBACK); if (!outcome) throw new Bad(400, 'Unknown feedback');
    const pack = (await pool.query("SELECT id FROM care_instruction_packs WHERE id=$1 AND mother_id=$2 AND status='verified'", [Number(req.params.id) || 0, req.user.id])).rows[0];
    if (!pack) throw new Bad(404, 'Instructions not found');
    await pool.query('INSERT INTO care_pack_feedback(pack_id,mother_id,outcome) VALUES($1,$2,$3) ON CONFLICT (pack_id,mother_id) DO UPDATE SET outcome=EXCLUDED.outcome,created_at=NOW()', [pack.id, req.user.id, outcome]);
    res.json({ ok: true, outcome });
  }));
  app.post('/api/patient/care-coordination/journeys', ...mother, handle('journey', async (req, res) => {
    res.status(201).json({ journey: await saveJourney(req.user.id, req, req.body) });
  }));
  app.patch('/api/patient/care-coordination/journeys/:id', ...mother, handle('journey update', async (req, res) => {
    res.json({ journey: await updateJourney(Number(req.params.id) || 0, req.user.id, req.body || {}) });
  }));

  // ---- Doctor: verified instruction packs -----------------------------------------------------------
  app.get('/api/doctor/care-coordination/packs', ...doctor, handle('packs', async (req, res) => {
    const rows = (await pool.query(
      `SELECT p.*,mp.full_name AS patient_name,fb.outcome AS feedback FROM care_instruction_packs p
         LEFT JOIN mother_profiles mp ON mp.user_id=p.mother_id LEFT JOIN care_pack_feedback fb ON fb.pack_id=p.id
        WHERE p.doctor_id=$1 AND NOT ${access.revokedSql('p.mother_id', 'p.doctor_id')} ORDER BY p.created_at DESC LIMIT 50`, [req.user.id])).rows;
    res.json({ packs: rows });
  }));
  app.post('/api/doctor/care-coordination/packs', ...doctor, handle('pack create', async (req, res) => {
    const motherId = Number(req.body && req.body.mother_id);
    const p = validatePack(req.body);
    await gateDoctor(req, motherId, 'care_instruction_pack');
    const appt = intOrNull(req.body.appointment_id);
    if (Number.isNaN(appt) || (appt && !(await pool.query('SELECT 1 FROM appointments WHERE id=$1 AND mother_id=$2 AND doctor_id=$3', [appt, motherId, req.user.id])).rows.length)) throw new Bad(404, 'Appointment not found for this patient');
    const row = (await pool.query(
      `INSERT INTO care_instruction_packs(mother_id,doctor_id,appointment_id,kind,title,body,in_person_required,in_person_reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [motherId, req.user.id, appt, p.kind, p.title, p.body, p.in_person_required, p.in_person_reason])).rows[0];
    res.status(201).json({ pack: row, hints: PlainLanguage.check(p.body) });
  }));
  app.post('/api/doctor/care-coordination/packs/:id/verify', ...doctor, handle('pack verify', async (req, res) => {
    if (!req.body || req.body.confirmed !== true) throw new Bad(400, 'Confirm you have checked these instructions before sharing');
    const pack = (await pool.query("SELECT * FROM care_instruction_packs WHERE id=$1 AND doctor_id=$2 AND status='draft'", [Number(req.params.id) || 0, req.user.id])).rows[0];
    if (!pack) throw new Bad(404, 'Draft not found');
    await gateDoctor(req, pack.mother_id, 'care_instruction_pack_verify');
    const row = (await pool.query("UPDATE care_instruction_packs SET status='verified',verified_by=$1,verified_at=NOW(),updated_at=NOW() WHERE id=$2 AND status='draft' RETURNING *", [req.user.id, pack.id])).rows[0];
    if (!row) throw new Bad(409, 'This draft changed. Refresh and try again.');
    res.json({ pack: row });
  }));
  app.post('/api/doctor/care-coordination/packs/:id/withdraw', ...doctor, handle('pack withdraw', async (req, res) => {
    const row = (await pool.query("UPDATE care_instruction_packs SET status='withdrawn',updated_at=NOW() WHERE id=$1 AND doctor_id=$2 AND status<>'withdrawn' RETURNING *", [Number(req.params.id) || 0, req.user.id])).rows[0];
    if (!row) throw new Bad(404, 'Instructions not found');
    res.json({ pack: row });
  }));

  // ---- Doctor: prior records, referral status and test decisions -------------------------------------
  app.get('/api/doctor/care-coordination/patients/:motherId/prior-records', ...doctor, handle('prior records', async (req, res) => {
    const motherId = Number(req.params.motherId);
    await gateDoctor(req, motherId, 'prior_records');
    const shared = `FROM patient_documents d JOIN patient_document_shares s ON s.document_id=d.id AND s.doctor_id=$2 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>NOW())
       WHERE d.mother_id=$1 AND d.deleted_at IS NULL
         AND COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean FROM patient_preferences WHERE user_id=d.mother_id),TRUE)
         AND NOT ${access.revokedSql('d.mother_id', 's.doctor_id')}`;
    const [docs, unshared, referrals, facilityReferrals, journeys, pendingTests, decisions] = await Promise.all([
      pool.query(`SELECT d.id,d.title,d.doc_type,d.report_date,d.uploaded_at,d.verification_status,d.facility_name ${shared} ORDER BY COALESCE(d.report_date,d.uploaded_at::date) DESC LIMIT 50`, [motherId, req.user.id]),
      pool.query(`SELECT COUNT(*)::int AS n FROM patient_documents d WHERE d.mother_id=$1 AND d.deleted_at IS NULL AND d.id NOT IN (SELECT d.id ${shared})`, [motherId, req.user.id]),
      pool.query(`SELECT id,referral_type,priority,status,reason,decision_at,appointment_date,summary_returned,created_at FROM referrals WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 20`, [motherId]),
      pool.query(`SELECT fr.id,f.name AS facility_name,fr.status,fr.urgency,fr.created_at FROM facility_referrals fr LEFT JOIN facilities f ON f.id=fr.to_facility_id WHERE fr.user_id=$1 ORDER BY fr.created_at DESC LIMIT 20`, [motherId]),
      pool.query(`SELECT j.id,j.care_need,j.outcome,j.failure_reason,j.prior_searches,j.capability_matched,j.recorder_role,j.created_at,f.name AS facility_name FROM referral_journeys j LEFT JOIN facilities f ON f.id=j.facility_id WHERE j.mother_id=$1 ORDER BY j.created_at DESC LIMIT 20`, [motherId]),
      pool.query(`SELECT s.id AS summary_id,a.requested_date AS visit_date,s.pending_tests FROM visit_summaries s JOIN appointments a ON a.id=s.appointment_id WHERE s.mother_id=$1 AND s.status='approved' AND jsonb_array_length(s.pending_tests)>0 ORDER BY a.requested_date DESC LIMIT 10`, [motherId]),
      pool.query(`SELECT t.id,t.test_name,t.decision,t.reason,t.document_id,t.created_at,dp.full_name AS clinician FROM test_reuse_decisions t LEFT JOIN doctor_profiles dp ON dp.user_id=t.doctor_id WHERE t.mother_id=$1 ORDER BY t.created_at DESC LIMIT 20`, [motherId]),
    ]);
    res.json({
      reports: docs.rows, unshared_report_count: unshared.rows[0].n, referrals: referrals.rows, facility_referrals: facilityReferrals.rows,
      journeys: journeys.rows, pending_tests: pendingTests.rows, test_decisions: decisions.rows, notice: NOTICES.test,
    });
  }));
  app.post('/api/doctor/care-coordination/patients/:motherId/test-decisions', ...doctor, handle('test decision', async (req, res) => {
    const motherId = Number(req.params.motherId);
    const t = validateTestDecision(req.body);
    await gateDoctor(req, motherId, 'test_reuse_decision');
    if (t.document_id) {
      const doc = await require('./patientDocuments').canAccessDoc(pool, t.document_id, req.user);
      if (!doc || doc.mother_id !== motherId) throw new Bad(404, 'Report not shared with you');
    }
    const row = (await pool.query('INSERT INTO test_reuse_decisions(mother_id,doctor_id,document_id,test_name,decision,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [motherId, req.user.id, t.document_id, t.test_name, t.decision, t.reason])).rows[0];
    res.status(201).json({ decision: row, notice: NOTICES.test });
  }));
  app.post('/api/doctor/care-coordination/patients/:motherId/journeys', ...doctor, handle('doctor journey', async (req, res) => {
    const motherId = Number(req.params.motherId);
    await gateDoctor(req, motherId, 'referral_journey');
    res.status(201).json({ journey: await saveJourney(motherId, req, req.body) });
  }));
  app.patch('/api/doctor/care-coordination/patients/:motherId/journeys/:id', ...doctor, handle('doctor journey update', async (req, res) => {
    const motherId = Number(req.params.motherId);
    await gateDoctor(req, motherId, 'referral_journey');
    res.json({ journey: await updateJourney(Number(req.params.id) || 0, motherId, req.body || {}) });
  }));

  // ---- Doctor: preventive follow-up queue and evaluation ---------------------------------------------
  app.get('/api/doctor/care-coordination/care-gaps', ...doctor, handle('care gaps', async (req, res) => {
    if (!(await verifiedDoctor(pool, req.user.id))) throw new Bad(403, 'A verified clinician account is required');
    res.json({ gaps: await careGaps(pool, (col) => access.activeRelationshipSql(col, '$1::int'), [req.user.id]) });
  }));
  app.post('/api/doctor/care-coordination/care-gaps/events', ...doctor, handle('follow-up event', async (req, res) => {
    const e = validateFollowup(req.body);
    await gateDoctor(req, e.mother_id, 'preventive_followup');
    const owns = e.gap_type === 'missed'
      ? await pool.query('SELECT 1 FROM missed_care_items WHERE id=$1 AND mother_id=$2', [e.gap_id, e.mother_id])
      : await pool.query("SELECT 1 FROM visit_summaries WHERE id=$1 AND mother_id=$2 AND status='approved'", [e.gap_id, e.mother_id]);
    if (!owns.rows.length) throw new Bad(404, 'Care gap not found for this patient');
    const row = (await pool.query(
      'INSERT INTO preventive_followup_events(mother_id,doctor_id,gap_key,action,outcome,emergency_use_reported,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [e.mother_id, req.user.id, e.gap_key, e.action, e.outcome, e.emergency_use_reported, e.note])).rows[0];
    res.status(201).json({ event: row });
  }));
  app.get('/api/doctor/care-coordination/evaluation', ...doctor, handle('evaluation', async (req, res) => {
    const me = [req.user.id];
    const [packs, feedback, journeys, firstTime, decisions, followups, emergency] = await Promise.all([
      pool.query(`SELECT COUNT(*) FILTER (WHERE status='verified')::int AS verified, COUNT(*) FILTER (WHERE status='verified' AND patient_seen_at IS NOT NULL)::int AS seen, COUNT(*) FILTER (WHERE status='verified' AND in_person_required)::int AS in_person_required FROM care_instruction_packs WHERE doctor_id=$1`, me),
      pool.query(`SELECT fb.outcome, COUNT(*)::int AS n FROM care_pack_feedback fb JOIN care_instruction_packs p ON p.id=fb.pack_id WHERE p.doctor_id=$1 GROUP BY fb.outcome`, me),
      pool.query(`SELECT j.outcome, COUNT(*)::int AS n FROM referral_journeys j WHERE ${access.activeRelationshipSql('j.mother_id', '$1::int')} GROUP BY j.outcome`, me),
      pool.query(`SELECT COUNT(*) FILTER (WHERE outcome='seen_first_visit' AND prior_searches=0)::int AS first_search_first_visit, COUNT(*) FILTER (WHERE prior_searches IS NULL)::int AS searches_unknown, COUNT(*) FILTER (WHERE outcome IN ('redirected','failed_visit') AND failure_reason='capability_unavailable')::int AS capability_failures FROM referral_journeys j WHERE ${access.activeRelationshipSql('j.mother_id', '$1::int')}`, me),
      pool.query(`SELECT decision, COUNT(*)::int AS n FROM test_reuse_decisions WHERE doctor_id=$1 GROUP BY decision`, me),
      pool.query(`SELECT outcome, COUNT(*)::int AS n FROM (SELECT DISTINCT ON (mother_id,gap_key) outcome FROM preventive_followup_events WHERE doctor_id=$1 ORDER BY mother_id,gap_key,created_at DESC) l GROUP BY outcome`, me),
      pool.query(`SELECT COUNT(DISTINCT mother_id)::int AS n FROM preventive_followup_events WHERE doctor_id=$1 AND emergency_use_reported`, me),
    ]);
    res.json({
      instructions: { ...packs.rows[0], patient_feedback: countBy(feedback.rows, 'outcome') },
      referrals: { outcomes: countBy(journeys.rows, 'outcome'), ...firstTime.rows[0] },
      tests: countBy(decisions.rows, 'decision'),
      follow_up: { latest_outcomes: countBy(followups.rows, 'outcome'), patients_with_reported_emergency_use: emergency.rows[0].n },
      prevention_claim: 'not_evaluated',
      notice: NOTICES.evaluation,
    });
  }));
};
Object.assign(module.exports, { CAPABILITIES, validatePack, validateJourney, validateTestDecision, validateFollowup, coordinationOrder, careGaps, NOTICES, KINDS });
