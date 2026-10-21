'use strict';

// ============================================================================
// Care extensions: predictive risk trend, postpartum pathway, smart emergency
// response. Tables: db/care_extensions_v4.sql. Registered from server.js.
//
//   Predictive risk monitoring
//     GET   /api/risk/trend?days=90                      mother: trend + signals + "why this level?"
//     GET   /api/doctor/patients/:motherId/risk-trend    doctor (needs an appointment with her)
//
//   Postpartum pathway
//     GET   /api/postpartum                              delivery, phase, contacts, check-ins
//     PUT   /api/postpartum/delivery                     {delivery_date, delivery_type}
//     POST  /api/postpartum/checkins                     daily self check-in (server evaluates red flags)
//     GET   /api/postpartum/checkins
//     PUT   /api/postpartum/contacts/:code               {done, date?} mark a postnatal contact done / undone
//     GET   /api/doctor/patients/:motherId/postpartum
//
//   Smart emergency response
//     GET   /api/emergency/context                       symptom list, numbers, plan, what the summary will contain
//     GET   /api/emergency/plan   PUT /api/emergency/plan
//     POST  /api/emergency/events                        {symptoms[], note?, context?} -> triage + summary, saved
//     POST  /api/emergency/events/:id/actions            {action}   what SHE says she did
//     PATCH /api/emergency/events/:id/resolve            {outcome}
//     GET   /api/emergency/events      GET /api/emergency/events/:id
//     GET   /api/doctor/emergencies                      recent events from her own patients
//
// Deliberately NOT here: hospital bed availability, "hospital accepted" status,
// or any automatic message to a facility. The app has no trustworthy source for
// those, and a wrong "accepted" is worse than saying nothing. Coordination is
// limited to (a) a clear summary she controls sharing, (b) her own pre-set plan,
// (c) her own record of which steps she took.
// ============================================================================

const { analyseTrend } = require('./riskTrend');
const { ageFrom } = require('./riskService');
const PP = require('../shared/postpartum-rules');
const EM = require('../shared/emergency-triage');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[+\d][\d\s\-()]{5,19}$/;
const DELIVERY_TYPES = ['vaginal', 'caesarean', 'assisted', 'unknown'];

const isRealDate = (s) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = function registerCareExtensions(app, { pool, authenticateToken, authorizeRole }) {
  const motherOnly = [authenticateToken, authorizeRole(['mother'])];
  const doctorOnly = [authenticateToken, authorizeRole(['doctor'])];

  const fail = (res, label, error, msg = 'Something went wrong') => {
    console.error(label + ':', error);
    // 42P01 = undefined_table: the v4 migration has not been applied on this database.
    if (error && error.code === '42P01') {
      return res.status(503).json({ error: 'This feature needs a database update (apply backend/db/care_extensions_v4.sql).' });
    }
    res.status(500).json({ error: msg });
  };

  const todayISO = async () => (await pool.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d")).rows[0].d;

  // A mother logs against HER local calendar date (same convention as /api/wellness);
  // accept it only within a day of the server's date so a wrong clock can't back-fill history.
  const resolveDate = async (clientDate) => {
    const server = await todayISO();
    if (clientDate == null || clientDate === '') return server;
    if (!isRealDate(clientDate)) return null;
    const diff = Math.abs(PP.daysBetween(server, clientDate));
    return diff <= 1 ? clientDate : null;
  };

  const hasAccess = async (doctorId, motherId) => {
    const r = await pool.query('SELECT 1 FROM appointments WHERE doctor_id = $1 AND mother_id = $2 LIMIT 1', [doctorId, motherId]);
    return r.rows.length > 0;
  };
  const doctorGate = async (req, res) => {
    const motherId = parseInt(req.params.motherId, 10);
    if (Number.isNaN(motherId)) { res.status(400).json({ error: 'Invalid patient id' }); return null; }
    if (!(await hasAccess(req.user.id, motherId))) { res.status(403).json({ error: 'You do not have access to this patient' }); return null; }
    return motherId;
  };

  // ==========================================================================
  // Predictive risk monitoring
  // ==========================================================================
  async function buildTrend(motherId, days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const [logs, ass, latest] = await Promise.all([
      pool.query(
        `SELECT log_type, data, logged_at FROM health_logs
          WHERE mother_id = $1 AND log_type IN ('blood_pressure', 'blood_glucose', 'weight') AND logged_at >= $2
          ORDER BY logged_at ASC`, [motherId, since]),
      pool.query(
        `SELECT risk_level, trigger, assessed_at FROM risk_assessments
          WHERE mother_id = $1 AND assessed_at >= $2 ORDER BY assessed_at ASC`, [motherId, since]),
      pool.query(
        `SELECT risk_level, knn_level, factors, explanation, trigger, assessed_at FROM risk_assessments
          WHERE mother_id = $1 ORDER BY assessed_at DESC, id DESC LIMIT 1`, [motherId]),
    ]);
    const data = { bp: [], glucose: [], weight: [], assessments: [] };
    logs.rows.forEach((r) => {
      const d = r.data || {};
      if (r.log_type === 'blood_pressure') data.bp.push({ at: r.logged_at, systolic: Number(d.systolic), diastolic: Number(d.diastolic) });
      else if (r.log_type === 'blood_glucose') data.glucose.push({ at: r.logged_at, mg_dl: Number(d.mg_dl), context: d.context });
      else data.weight.push({ at: r.logged_at, kg: Number(d.kg) });
    });
    ass.rows.forEach((r) => data.assessments.push({ at: r.assessed_at, risk_level: r.risk_level, trigger: r.trigger }));
    const trend = analyseTrend(data);
    const l = latest.rows[0] || null;
    return {
      window_days: days,
      ...trend,
      latest_assessment: l ? {
        risk_level: l.risk_level, knn_level: l.knn_level, factors: l.factors || [], explanation: l.explanation || null,
        trigger: l.trigger, assessed_at: l.assessed_at
      } : null
    };
  }
  const clampDays = (v) => Math.min(365, Math.max(14, parseInt(v, 10) || 90));

  app.get('/api/risk/trend', ...motherOnly, async (req, res) => {
    try { res.json(await buildTrend(req.user.id, clampDays(req.query.days))); }
    catch (e) { fail(res, 'Risk trend', e, 'Failed to load risk trend'); }
  });

  app.get('/api/doctor/patients/:motherId/risk-trend', ...doctorOnly, async (req, res) => {
    try {
      const motherId = await doctorGate(req, res); if (motherId == null) return;
      res.json(await buildTrend(motherId, clampDays(req.query.days)));
    } catch (e) { fail(res, 'Doctor risk trend', e, 'Failed to load risk trend'); }
  });

  // ==========================================================================
  // Postpartum pathway
  // ==========================================================================
  // Delivery date: her own entry wins; else the ticked "Delivery" milestone; else
  // the DOB of her newest child when she registered as already delivered.
  async function readDelivery(motherId) {
    const own = await pool.query(
      "SELECT to_char(delivery_date, 'YYYY-MM-DD') AS d, delivery_type FROM postpartum_profile WHERE mother_id = $1", [motherId]);
    if (own.rows.length) return { date: own.rows[0].d, type: own.rows[0].delivery_type, source: 'entered' };
    const ms = await pool.query(
      `SELECT to_char(completed_at::date, 'YYYY-MM-DD') AS d FROM care_milestones
        WHERE mother_id = $1 AND stage = 'Delivery' AND category = 'pregnancy' AND completed_at IS NOT NULL
        ORDER BY sort_order LIMIT 1`, [motherId]);
    if (ms.rows.length) return { date: ms.rows[0].d, type: 'unknown', source: 'timeline' };
    const kid = await pool.query(
      `SELECT to_char(c.date_of_birth, 'YYYY-MM-DD') AS d FROM children c
         JOIN mother_profiles mp ON mp.user_id = c.mother_id AND mp.pregnancy_status = 'delivered'
        WHERE c.mother_id = $1 ORDER BY c.date_of_birth DESC LIMIT 1`, [motherId]);
    if (kid.rows.length) return { date: kid.rows[0].d, type: 'unknown', source: 'child' };
    return null;
  }

  async function readContactsDone(motherId) {
    const r = await pool.query("SELECT contact_code, to_char(completed_on, 'YYYY-MM-DD') AS d FROM postpartum_contacts WHERE mother_id = $1", [motherId]);
    const map = {};
    r.rows.forEach((x) => { map[x.contact_code] = x.d; });
    return map;
  }

  async function readCheckins(motherId, limit) {
    const r = await pool.query(
      `SELECT id, to_char(checkin_date, 'YYYY-MM-DD') AS checkin_date, answers, level, flags, created_at
         FROM postpartum_checkins WHERE mother_id = $1 ORDER BY checkin_date DESC, id DESC LIMIT $2`, [motherId, limit]);
    return r.rows;
  }

  async function buildPostpartum(motherId) {
    const [delivery, today] = [await readDelivery(motherId), await todayISO()];
    if (!delivery) return { active: false, reason: 'no_delivery_recorded' };
    const daysPP = PP.daysBetween(delivery.date, today);
    if (daysPP < 0) return { active: false, reason: 'delivery_in_future', delivery };
    const [done, checkins] = await Promise.all([readContactsDone(motherId), readCheckins(motherId, 14)]);
    const todays = checkins.find((c) => c.checkin_date === today) || null;
    return {
      active: true,
      delivery,
      today,
      days_postpartum: daysPP,
      week: Math.floor(daysPP / 7),
      phase: PP.phaseFor(daysPP),
      schedule: PP.schedule(delivery.date, today, done),
      checkins_open: daysPP <= PP.CHECKIN_MAX_DAYS,
      today_checkin: todays,
      recent_checkins: checkins,
      baby_danger_signs: PP.BABY_DANGER_SIGNS,
      numbers: EM.NUMBERS
    };
  }

  app.get('/api/postpartum', ...motherOnly, async (req, res) => {
    try { res.json(await buildPostpartum(req.user.id)); }
    catch (e) { fail(res, 'Postpartum', e, 'Failed to load postpartum pathway'); }
  });

  app.put('/api/postpartum/delivery', ...motherOnly, async (req, res) => {
    try {
      const { delivery_date, delivery_type } = req.body || {};
      if (!isRealDate(delivery_date)) return res.status(400).json({ error: 'Enter the delivery date (YYYY-MM-DD)' });
      const type = delivery_type == null ? 'unknown' : delivery_type;
      if (!DELIVERY_TYPES.includes(type)) return res.status(400).json({ error: 'Choose vaginal, caesarean, assisted or not sure' });
      const days = PP.daysBetween(delivery_date, await todayISO());
      if (days < 0) return res.status(400).json({ error: 'The delivery date cannot be in the future' });
      if (days > 365) return res.status(400).json({ error: 'That date is more than a year ago — please check it' });
      await pool.query(
        `INSERT INTO postpartum_profile (mother_id, delivery_date, delivery_type) VALUES ($1, $2, $3)
         ON CONFLICT (mother_id) DO UPDATE SET delivery_date = EXCLUDED.delivery_date, delivery_type = EXCLUDED.delivery_type, updated_at = CURRENT_TIMESTAMP`,
        [req.user.id, delivery_date, type]);
      res.json({ message: 'Delivery details saved', postpartum: await buildPostpartum(req.user.id) });
    } catch (e) { fail(res, 'Save delivery', e, 'Failed to save delivery details'); }
  });

  app.post('/api/postpartum/checkins', ...motherOnly, async (req, res) => {
    try {
      const body = req.body || {};
      const delivery = await readDelivery(req.user.id);
      if (!delivery) return res.status(409).json({ error: 'Add your delivery date first' });
      const date = await resolveDate(body.date);
      if (!date) return res.status(400).json({ error: 'Check-in date must be today' });
      const daysPP = PP.daysBetween(delivery.date, date);
      if (daysPP < 0) return res.status(400).json({ error: 'That date is before your delivery' });
      if (daysPP > PP.CHECKIN_MAX_DAYS) return res.status(409).json({ error: 'Daily check-ins are for the first 14 weeks after birth' });

      const s = PP.sanitizeCheckin(body);
      if (s.error) return res.status(400).json({ error: s.error });
      const evaluation = PP.evaluateCheckin(s.answers, { daysPP, deliveryType: delivery.type });

      const ins = await pool.query(
        `INSERT INTO postpartum_checkins (mother_id, checkin_date, answers, level, flags)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, to_char(checkin_date, 'YYYY-MM-DD') AS checkin_date, created_at`,
        [req.user.id, date, JSON.stringify(s.answers), evaluation.level, JSON.stringify(evaluation.flags)]);

      // A blood pressure given here is also a health log, so her doctor's view and
      // the trend chart see it. Inserted directly (not via the risk hook): the
      // risk model was built on pregnancy data and is not run for postpartum readings.
      if (s.answers.bp_systolic != null) {
        await pool.query(
          `INSERT INTO health_logs (mother_id, log_type, data) VALUES ($1, 'blood_pressure', $2)`,
          [req.user.id, JSON.stringify({ systolic: s.answers.bp_systolic, diastolic: s.answers.bp_diastolic })]);
      }

      const wantMental = evaluation.flags.some((f) => f.code === 'self_harm' || f.code === 'mood');
      res.status(201).json({
        message: 'Check-in saved',
        checkin: ins.rows[0],
        evaluation,
        numbers: evaluation.level === 'emergency' || wantMental
          ? EM.triage([], { context: 'postpartum' }).numbers.concat(wantMental ? [{ key: 'mental_health', number: EM.NUMBERS.mental_health.number, label: EM.NUMBERS.mental_health.label }] : [])
          : []
      });
    } catch (e) { fail(res, 'Postpartum check-in', e, 'Failed to save check-in'); }
  });

  app.get('/api/postpartum/checkins', ...motherOnly, async (req, res) => {
    try {
      const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 30));
      res.json({ checkins: await readCheckins(req.user.id, limit) });
    } catch (e) { fail(res, 'List check-ins', e, 'Failed to load check-ins'); }
  });

  app.put('/api/postpartum/contacts/:code', ...motherOnly, async (req, res) => {
    try {
      const code = req.params.code;
      if (!PP.CONTACTS.some((c) => c.code === code)) return res.status(404).json({ error: 'Unknown postnatal contact' });
      const { done, date } = req.body || {};
      if (done === false) {
        await pool.query('DELETE FROM postpartum_contacts WHERE mother_id = $1 AND contact_code = $2', [req.user.id, code]);
        return res.json({ message: 'Unmarked' });
      }
      const delivery = await readDelivery(req.user.id);
      if (!delivery) return res.status(409).json({ error: 'Add your delivery date first' });
      const today = await todayISO();
      const when = date == null ? today : date;
      if (!isRealDate(when)) return res.status(400).json({ error: 'Enter a valid date' });
      if (PP.daysBetween(delivery.date, when) < 0) return res.status(400).json({ error: 'That date is before your delivery' });
      if (PP.daysBetween(when, today) < -1) return res.status(400).json({ error: 'That date is in the future' });
      await pool.query(
        `INSERT INTO postpartum_contacts (mother_id, contact_code, completed_on) VALUES ($1, $2, $3)
         ON CONFLICT (mother_id, contact_code) DO UPDATE SET completed_on = EXCLUDED.completed_on`,
        [req.user.id, code, when]);
      res.json({ message: 'Marked done' });
    } catch (e) { fail(res, 'Mark contact', e, 'Failed to update'); }
  });

  app.get('/api/doctor/patients/:motherId/postpartum', ...doctorOnly, async (req, res) => {
    try {
      const motherId = await doctorGate(req, res); if (motherId == null) return;
      res.json(await buildPostpartum(motherId));
    } catch (e) { fail(res, 'Doctor postpartum', e, 'Failed to load postpartum details'); }
  });

  // ==========================================================================
  // Smart emergency response
  // ==========================================================================
  // Everything the summary can say comes from HER profile and logs, each with its
  // own timestamp. Gestation/EDD are shown only if she confirmed her dates:
  // care_start_date silently defaults to the registration day, and presenting
  // that as "week N" in an emergency would be a guess shown as fact.
  async function loadEmergencyInputs(motherId) {
    const p = await pool.query(
      `SELECT full_name, date_of_birth, blood_group, allergies, medical_conditions, current_medications,
              gravida, parity, previous_complications, risk_level, risk_assessed_at,
              emergency_contact_name, emergency_contact_phone, phone,
              (pregnancy_confirmed_at IS NOT NULL) AS confirmed,
              to_char(care_start_date::date + 280, 'YYYY-MM-DD') AS edd,
              (CURRENT_DATE - care_start_date::date) AS gest_days
         FROM mother_profiles WHERE user_id = $1`, [motherId]);
    if (!p.rows.length) return null;
    const m = p.rows[0];
    const [delivery, today, bp, gl, plan] = await Promise.all([
      readDelivery(motherId), todayISO(),
      pool.query("SELECT data, logged_at FROM health_logs WHERE mother_id = $1 AND log_type = 'blood_pressure' ORDER BY logged_at DESC LIMIT 1", [motherId]),
      pool.query("SELECT data, logged_at FROM health_logs WHERE mother_id = $1 AND log_type = 'blood_glucose' ORDER BY logged_at DESC LIMIT 1", [motherId]),
      pool.query('SELECT * FROM emergency_plans WHERE mother_id = $1', [motherId]),
    ]);
    const daysPP = delivery ? PP.daysBetween(delivery.date, today) : NaN;
    const context = delivery && daysPP >= 0 && daysPP <= PP.CHECKIN_MAX_DAYS ? 'postpartum' : 'pregnant';
    const gestWeeks = context === 'pregnant' && m.confirmed && Number.isFinite(Number(m.gest_days)) && m.gest_days >= 0 && m.gest_days <= 300
      ? Math.floor(Number(m.gest_days) / 7) : null;
    return {
      name: m.full_name,
      age: m.date_of_birth ? ageFrom(m.date_of_birth) : null,
      context,
      gestWeeks,
      edd: context === 'pregnant' && m.confirmed ? m.edd : null,
      daysPostpartum: context === 'postpartum' ? daysPP : null,
      deliveryType: delivery ? delivery.type : null,
      bloodGroup: m.blood_group, allergies: m.allergies, conditions: m.medical_conditions, medications: m.current_medications,
      gravida: m.gravida, parity: m.parity, previousComplications: m.previous_complications,
      riskLevel: m.risk_level, riskAssessedAt: m.risk_assessed_at ? new Date(m.risk_assessed_at).toISOString() : null,
      latestBP: bp.rows.length ? { systolic: Number(bp.rows[0].data.systolic), diastolic: Number(bp.rows[0].data.diastolic), at: new Date(bp.rows[0].logged_at).toISOString() } : null,
      latestGlucose: gl.rows.length ? { mg_dl: Number(gl.rows[0].data.mg_dl), context: gl.rows[0].data.context, at: new Date(gl.rows[0].logged_at).toISOString() } : null,
      contact: { name: m.emergency_contact_name, phone: m.emergency_contact_phone },
      plan: plan.rows[0] || null,
    };
  }

  app.get('/api/emergency/context', ...motherOnly, async (req, res) => {
    try {
      const inputs = await loadEmergencyInputs(req.user.id);
      if (!inputs) return res.status(404).json({ error: 'Profile not found' });
      const active = await pool.query(
        "SELECT id FROM emergency_events WHERE mother_id = $1 AND status = 'active' AND created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 1", [req.user.id]);
      res.json({
        context: inputs.context,
        symptoms: { pregnant: EM.symptomsFor('pregnant'), postpartum: EM.symptomsFor('postpartum') },
        numbers: EM.NUMBERS,
        contact: inputs.contact,
        plan: inputs.plan,
        gest_weeks: inputs.gestWeeks,
        active_event_id: active.rows[0] ? active.rows[0].id : null
      });
    } catch (e) { fail(res, 'Emergency context', e, 'Failed to load emergency details'); }
  });

  const PLAN_FIELDS = [
    ['facility_name', 160, false], ['facility_phone', 20, true],
    ['backup_facility_name', 160, false], ['backup_facility_phone', 20, true],
    ['transport_note', 300, false], ['blood_donor_name', 120, false], ['blood_donor_phone', 20, true],
  ];

  app.get('/api/emergency/plan', ...motherOnly, async (req, res) => {
    try {
      const r = await pool.query('SELECT * FROM emergency_plans WHERE mother_id = $1', [req.user.id]);
      res.json({ plan: r.rows[0] || null });
    } catch (e) { fail(res, 'Read plan', e, 'Failed to load your emergency plan'); }
  });

  app.put('/api/emergency/plan', ...motherOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const vals = [];
      for (const [field, max, isPhone] of PLAN_FIELDS) {
        if (b[field] != null && typeof b[field] !== 'string') return res.status(400).json({ error: `Invalid ${field}` });
        const v = clean(b[field], max + 1);
        if (v.length > max) return res.status(400).json({ error: `${field} is too long` });
        if (isPhone && v && !PHONE_RE.test(v)) return res.status(400).json({ error: 'Enter a valid phone number' });
        vals.push(v || null);
      }
      const cols = PLAN_FIELDS.map((f) => f[0]);
      const r = await pool.query(
        `INSERT INTO emergency_plans (mother_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => '$' + (i + 2)).join(', ')})
         ON CONFLICT (mother_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = CURRENT_TIMESTAMP
         RETURNING *`, [req.user.id, ...vals]);
      res.json({ message: 'Emergency plan saved', plan: r.rows[0] });
    } catch (e) { fail(res, 'Save plan', e, 'Failed to save your emergency plan'); }
  });

  app.post('/api/emergency/events', ...motherOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const inputs = await loadEmergencyInputs(req.user.id);
      if (!inputs) return res.status(404).json({ error: 'Profile not found' });
      const context = b.context === 'pregnant' || b.context === 'postpartum' ? b.context : inputs.context;
      const codes = Array.isArray(b.symptoms) ? b.symptoms.filter((c) => typeof c === 'string').slice(0, 20) : [];
      const note = clean(b.note, 500);

      // Re-run the shared triage and summary here: what is saved never depends on what the browser computed.
      const merged = { ...inputs, context, symptoms: codes, note, ...(context !== inputs.context ? { gestWeeks: null, edd: null, daysPostpartum: null } : {}) };
      const summary = EM.buildSummary(merged);
      const triage = EM.triage(codes, { context, gestWeeks: merged.gestWeeks, latestBP: EM.bpWithHours(inputs.latestBP, Date.now()) });
      const saved = triage.matched.map((m) => m.code);

      const r = await pool.query(
        `INSERT INTO emergency_events (mother_id, context, symptoms, triage_level, note, summary)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [req.user.id, context, JSON.stringify(saved), triage.level, note || null, JSON.stringify(summary)]);
      res.status(201).json({ event: { id: r.rows[0].id, created_at: r.rows[0].created_at, context, status: 'active' }, triage, summary });
    } catch (e) { fail(res, 'Create emergency event', e, 'Could not save the emergency record — call 112 now if this is an emergency'); }
  });

  app.post('/api/emergency/events/:id/actions', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const action = (req.body || {}).action;
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      if (!EM.EVENT_ACTIONS.includes(action)) return res.status(400).json({ error: 'Unknown action' });
      const r = await pool.query(
        `UPDATE emergency_events SET actions = actions || $3::jsonb WHERE id = $1 AND mother_id = $2 RETURNING actions`,
        [id, req.user.id, JSON.stringify([{ action, at: new Date().toISOString() }])]);
      if (!r.rows.length) return res.status(404).json({ error: 'Event not found' });
      res.json({ actions: r.rows[0].actions });
    } catch (e) { fail(res, 'Emergency action', e, 'Failed to record that step'); }
  });

  app.patch('/api/emergency/events/:id/resolve', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const outcome = (req.body || {}).outcome;
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      if (!EM.EVENT_OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'Choose an outcome' });
      const r = await pool.query(
        `UPDATE emergency_events SET status = 'resolved', outcome = $3, resolved_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND mother_id = $2 RETURNING id, status, outcome, resolved_at`, [id, req.user.id, outcome]);
      if (!r.rows.length) return res.status(404).json({ error: 'Event not found' });
      res.json({ event: r.rows[0] });
    } catch (e) { fail(res, 'Resolve emergency', e, 'Failed to update'); }
  });

  app.get('/api/emergency/events', ...motherOnly, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, context, symptoms, triage_level, note, actions, status, outcome, created_at, resolved_at
           FROM emergency_events WHERE mother_id = $1 ORDER BY created_at DESC LIMIT 20`, [req.user.id]);
      res.json({ events: r.rows });
    } catch (e) { fail(res, 'List emergencies', e, 'Failed to load emergency history'); }
  });

  app.get('/api/emergency/events/:id', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const r = await pool.query('SELECT * FROM emergency_events WHERE id = $1 AND mother_id = $2', [id, req.user.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Event not found' });
      res.json({ event: r.rows[0] });
    } catch (e) { fail(res, 'Read emergency', e, 'Failed to load'); }
  });

  // Doctors see events only from patients they already have an appointment with —
  // the same access rule as the rest of the continuity views. This is a read-only
  // heads-up, not a dispatch channel: nothing here tells a doctor to act, and the
  // mother is always told to call 112 / the facility directly.
  app.get('/api/doctor/emergencies', ...doctorOnly, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT e.id, e.mother_id, mp.full_name, mp.phone, e.context, e.symptoms, e.triage_level, e.note,
                e.actions, e.status, e.outcome, e.created_at, e.resolved_at, e.summary
           FROM emergency_events e
           JOIN mother_profiles mp ON mp.user_id = e.mother_id
          WHERE e.created_at > NOW() - INTERVAL '72 hours'
            AND EXISTS (SELECT 1 FROM appointments a WHERE a.doctor_id = $1 AND a.mother_id = e.mother_id)
          ORDER BY (e.status = 'active') DESC, e.created_at DESC LIMIT 50`, [req.user.id]);
      res.json({ events: r.rows });
    } catch (e) { fail(res, 'Doctor emergencies', e, 'Failed to load emergencies'); }
  });
};
