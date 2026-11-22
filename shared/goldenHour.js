'use strict';
/* Golden Hour — emergency pre-alert (PROTOTYPE, synthetic demo accounts only).
 *
 *   GET  /api/golden-hour/config                  checklist, numbers, and (for family) whom they may alert for
 *   POST /api/golden-hour/alerts                  run the danger-sign check; if it trips, pick the nearest CAPABLE
 *                                                 facility, build the SBAR and send it to that hospital's portal
 *   GET  /api/golden-hour/alerts/active           the most recent open alert (so a page refresh does not lose it)
 *   GET  /api/golden-hour/alerts/:id              live status (hospital received / accepted / declined, simulated ambulance)
 *   POST /api/golden-hour/alerts/:id/retry        re-send an alert the hospital never received
 *   POST /api/golden-hour/alerts/:id/cancel       false alarm / going elsewhere
 *   POST /api/golden-hour/alerts/:id/actions      "I called 108" style self-reported ticks
 *
 * Triage is the shared fixed-rule table (shared/emergency-triage.js). Facility choice is the shared
 * capability table (shared/golden-hour.js). No language model decides anything here. Every response says
 * to call 112 / 108 and that nothing is a confirmed bed or ambulance.
 */
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const EM = require('../shared/emergency-triage');
const GH = require('../shared/golden-hour');
const { resolveLocation, inDelhiBox } = require('./demoLocationGazetteer');

const PREFIX = 'DAI-DELHI-FOCUSED-';
const OPEN = ['sent', 'received', 'accepted', 'rerouted'];
const ACTIONS = ['called_ambulance', 'called_facility', 'left_for_facility', 'reached_facility'];
const TERMINAL_PORTAL = ['declined', 'cancelled', 'arrived'];
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);

class Fail extends Error { constructor(status, message) { super(message); this.status = status; } }

function validateLocation(l) {
  if (!l || !['manual_pin', 'device'].includes(l.source)) throw new Fail(400, 'Enter a Delhi PIN code or allow device location.');
  if (l.source === 'manual_pin') {
    if (typeof l.pincode !== 'string' || !/^\d{6}$/.test(l.pincode)) throw new Fail(400, 'Enter a six-digit Delhi PIN code.');
    const p = resolveLocation({ pincode: l.pincode });
    if (!p.ok || p.precision !== 'pincode') throw new Fail(400, 'This PIN is outside the supported Delhi locality list. Try another Delhi PIN.');
    return { source: 'manual_pin', precision: 'pincode', latitude: p.latitude, longitude: p.longitude, label: p.label || ('PIN ' + l.pincode) };
  }
  if (l.consent !== true) throw new Fail(400, 'Device location needs your permission.');
  const { latitude, longitude, accuracy } = l;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !inDelhiBox(latitude, longitude)) throw new Fail(400, 'Device location is outside the supported Delhi area. Enter a Delhi PIN instead.');
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0) throw new Fail(400, 'Device location accuracy is missing. Enter a Delhi PIN instead.');
  return { source: 'device', precision: 'device', latitude, longitude, label: 'Permission-based device location' };
}
// Stored and sent location is deliberately coarse (about 110 m) — enough for distance, not a street address.
const coarse = (n) => Math.round(n * 1000) / 1000;

function register(app, { pool, authenticateToken, authorizeRole, env = process.env, now = () => Date.now(), forward: injectedForward } = {}) {
  const who = [authenticateToken, authorizeRole(['mother', 'caregiver'])];
  const attempts = new Map();

  /* ---------- gating ---------- */
  function demoOnly() {
    if (env.DAI_LOCAL !== 'true' || env.DAI_DEMO !== 'true') throw new Fail(404, 'Golden Hour is a local synthetic prototype and is not available here.');
  }
  async function resolveActor(req, motherIdFromBody) {
    if (req.user.role === 'mother') return { motherId: req.user.id, by: 'mother' };
    const id = Number(motherIdFromBody);
    if (!Number.isSafeInteger(id) || id < 1) throw new Fail(400, 'Choose whom you are alerting for.');
    const g = await pool.query(
      `SELECT 1 FROM family_access_grants g JOIN users u ON u.id = g.mother_id
        WHERE g.grantee_id = $1 AND g.mother_id = $2 AND g.revoked_at IS NULL AND g.expires_at > NOW() AND g.scopes @> '"emergency_alert"'::jsonb AND u.closed_at IS NULL`, [req.user.id, id]);
    if (!g.rows.length) throw new Fail(403, 'She has not allowed you to start an emergency alert for her, or the access has ended.');
    return { motherId: id, by: 'family' };
  }
  async function syntheticMother(motherId) {
    const r = await pool.query('SELECT u.email, m.full_name FROM users u JOIN mother_profiles m ON m.user_id = u.id WHERE u.id = $1', [motherId]);
    const row = r.rows[0];
    if (!row) throw new Fail(404, 'Patient profile not found.');
    if (!String(row.email).endsWith('@dai-synthetic.invalid')) throw new Fail(403, 'Golden Hour is for synthetic demonstration accounts only. In a real emergency call 112.');
    return { name: String(row.full_name || 'Synthetic patient').slice(0, 150) };
  }
  const handle = (fn) => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { demoOnly(); await fn(req, res); } catch (e) {
      if (e instanceof Fail) return res.status(e.status).json({ error: e.message, call: 'If this is an emergency, call 112 (or 108) now.' });
      console.error('Golden Hour error:', e && e.message);
      res.status(503).json({ error: 'Golden Hour is unavailable right now. If this is an emergency, call 112 (or 108) now.', call: 'Call 112 or 108 now.' });
    }
  };
  function limit(userId) {
    const t = now(), a = (attempts.get(userId) || []).filter((x) => t - x < 3600000);
    if (a.length >= 12) throw new Fail(429, 'Too many alerts in the last hour. Call 112 (or 108) directly.');
    a.push(t); attempts.set(userId, a); if (attempts.size > 2000) attempts.delete(attempts.keys().next().value);
  }

  /* ---------- bridge to the hospital portal (same signed-token pattern as the request bridge) ---------- */
  async function forward(motherId, patientName, path, method, body) {
    if (injectedForward) return injectedForward({ motherId, patientName, path, method, body });
    const origin = new URL(env.DAI_PORTAL_API_ORIGIN || 'http://127.0.0.1:8100');
    if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || origin.protocol !== 'http:') throw new Error('Local portal origin required');
    const raw = body === undefined ? '' : JSON.stringify(body), secret = env.JWT_SECRET;
    if (!secret || secret.length < 32) throw new Error('Shared local authentication secret missing');
    const token = jwt.sign({ sub: 'node-mother:' + motherId, patient_name: patientName, method, path, body_sha256: crypto.createHash('sha256').update(raw).digest('hex') }, secret, { algorithm: 'HS256', issuer: 'dai-patient-coordination', audience: 'dai-hospital-coordination', expiresIn: '60s' });
    const r = await fetch(new URL(path, origin), { method, headers: { 'Content-Type': 'application/json', 'x-dai-coordination': token }, body: method === 'GET' ? undefined : raw, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!(r.headers.get('content-type') || '').includes('application/json')) throw new Error('Portal returned an unexpected page');
    const value = await r.json();
    if (!r.ok) throw Object.assign(new Error(typeof value.detail === 'string' ? value.detail : 'Portal refused the alert'), { portalStatus: r.status });
    return value;
  }

  /* ---------- data ---------- */
  async function loadFacilities() {
    const rows = (await pool.query(
      `SELECT f.id, f.facility_code, f.name, f.latitude, f.longitude, f.active,
              COALESCE((SELECT json_agg(json_build_object('name', s.service_name, 'category', s.service_category, 'available', s.available)) FROM facility_services s WHERE s.facility_id = f.id), '[]'::json) AS services,
              COALESCE((SELECT json_agg(json_build_object('name', c.capability, 'available', c.available)) FROM facility_capabilities c WHERE c.facility_id = f.id), '[]'::json) AS capabilities
         FROM facilities f WHERE f.facility_code LIKE $1 AND f.verification_source = 'synthetic_delhi_focused_v1' AND f.active = TRUE`, [PREFIX + '%'])).rows;
    return rows.map((f) => ({ id: f.id, code: String(f.facility_code).slice(PREFIX.length), name: f.name, latitude: f.latitude == null ? null : Number(f.latitude), longitude: f.longitude == null ? null : Number(f.longitude), active: f.active, services: f.services || [], capabilities: f.capabilities || [] }));
  }
  async function loadPatient(motherId) {
    const inputs = await app.locals.loadEmergencyInputs(motherId);
    if (!inputs) throw new Fail(404, 'Patient profile not found.');
    const bp = await pool.query("SELECT data, logged_at FROM health_logs WHERE mother_id = $1 AND log_type = 'blood_pressure' ORDER BY logged_at DESC LIMIT 3", [motherId]);
    inputs.bpReadings = bp.rows.map((r) => ({ systolic: Number(r.data.systolic), diastolic: Number(r.data.diastolic), at: new Date(r.logged_at).toISOString() })).filter((b) => Number.isFinite(b.systolic) && Number.isFinite(b.diastolic));
    return inputs;
  }

  function present(row, portal) {
    const sbar = row.sbar || null;
    const hospital = portal && portal.alert ? portal.alert : null;
    return {
      id: row.id, status: row.status, priority: row.priority, delivery: row.delivery, triggered_by: row.triggered_by,
      created_at: row.created_at, label: GH.PROTOTYPE_LABEL, rule_version: GH.VERSION,
      triage: { level: row.triage.level, headline: row.triage.headline, matched: row.triage.matched, steps: row.triage.steps, firstAid: row.triage.firstAid, numbers: row.triage.numbers, disclaimer: row.triage.disclaimer },
      facility: row.facility_code ? { code: row.facility_code, name: row.facility_name, distance_km: row.distance_km == null ? null : Number(row.distance_km), eta_minutes: row.eta_minutes } : null,
      why: { reasons: row.requirements.reasons, needs: { capabilities: row.requirements.caps.map((c) => GH.CAP_PLAIN[c] || c), any_of: row.requirements.capsAny.map((g) => g.map((c) => GH.CAP_PLAIN[c] || c)), services: row.requirements.svcs.map((s) => GH.SVC_PLAIN[s] || s) }, skipped_nearer: (row.candidates || []).filter((c) => !c.eligible && row.facility_code && c.distance_km < Number(row.distance_km)).map((c) => ({ name: c.name, distance_km: c.distance_km, missing: c.missing })), eta_assumptions: GH.ETA && GH.estimateEta(0).assumptions },
      sbar: sbar ? { sections: sbar.sections, text: sbar.text, readiness_checklist: sbar.readiness_checklist } : null,
      hospital: hospital ? { status: hospital.status, public_note: hospital.public_note, seen_at: hospital.seen_at, decided_at: hospital.decided_at, accepted_by: hospital.accepted_by_name || null, ambulance: hospital.ambulance || null, version: hospital.version } : null,
      history: row.history, actions: row.actions,
      numbers: EM.NUMBERS,
      instructions: ['Call 112 (or 108) now. Do not wait for the hospital to reply.', 'Do not travel alone and do not drive yourself.', 'This alert is not a confirmed bed, doctor or ambulance. Only the services you call can confirm those.']
    };
  }
  const note = (row, text) => { row.history = [...(row.history || []), { at: new Date(now()).toISOString(), text }]; };

  async function saveRow(row) {
    await pool.query(
      `UPDATE golden_hour_alerts SET status=$2, delivery=$3, portal_alert_id=$4, portal_status=$5, facility_code=$6, facility_name=$7, distance_km=$8, eta_minutes=$9, history=$10, actions=$11, candidates=$12, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [row.id, row.status, row.delivery, row.portal_alert_id, row.portal_status, row.facility_code, row.facility_name, row.distance_km, row.eta_minutes, JSON.stringify(row.history || []), JSON.stringify(row.actions || []), JSON.stringify(row.candidates || [])]);
  }
  async function readRow(id, motherId) {
    const r = await pool.query('SELECT * FROM golden_hour_alerts WHERE id = $1 AND mother_id = $2', [id, motherId]);
    return r.rows[0] || null;
  }
  async function access(req, id) {
    if (!/^[\da-f-]{36}$/i.test(id)) throw new Fail(400, 'Invalid alert.');
    const r = await pool.query('SELECT mother_id FROM golden_hour_alerts WHERE id = $1', [id]);
    if (!r.rows.length) throw new Fail(404, 'Alert not found.');
    const a = await resolveActor(req, r.rows[0].mother_id);
    const row = await readRow(id, a.motherId);
    if (!row) throw new Fail(404, 'Alert not found.');
    return { row, actor: a };
  }

  function portalPayload(row, patient, triggeredBy) {
    return {
      alert_ref: row.id, directory_code: row.facility_code, priority: row.priority, triage_level: row.triage.level, triggered_by: triggeredBy,
      request_key: row.request_key, eta_minutes: row.eta_minutes, distance_km: Number(row.distance_km),
      origin: row.origin, symptoms: row.symptoms, requirements: row.requirements, sbar: row.sbar,
      patient: patient, skipped_nearer: (row.candidates || []).filter((c) => !c.eligible && c.distance_km < Number(row.distance_km)).map((c) => ({ name: c.name, distance_km: c.distance_km, missing: c.missing }))
    };
  }

  async function deliver(row, patientName) {
    try {
      const body = portalPayload(row, row.sbar && row.sbar.patient_snapshot, row.triggered_by);
      const out = await forward(row.mother_id, patientName, '/api/demo-coordination/patient/golden-hour', 'POST', body);
      row.portal_alert_id = out.alert.id; row.portal_status = out.alert.status; row.delivery = 'delivered';
      if (row.status === 'sent' || row.status === 'rerouted') row.status = 'sent';
      note(row, 'Pre-alert delivered to ' + row.facility_name + '.');
      return { ok: true, portal: out };
    } catch (e) {
      row.delivery = 'not_delivered';
      note(row, 'The hospital portal could not be reached. The hospital has NOT been told.');
      console.error('Golden Hour delivery failed:', e && e.message);
      return { ok: false };
    }
  }

  /* ---------- routes ---------- */
  app.get('/api/golden-hour/config', ...who, handle(async (req, res) => {
    let context = 'pregnant', mothers = [];
    if (req.user.role === 'mother') {
      await syntheticMother(req.user.id);
      context = (await loadPatient(req.user.id)).context;
    } else if (req.query && req.query.mother_id) {
      // Family member choosing whom to alert for: use HER situation for the list of signs.
      const a = await resolveActor(req, req.query.mother_id);
      await syntheticMother(a.motherId);
      context = (await loadPatient(a.motherId)).context;
    } else {
      const g = await pool.query(
        `SELECT g.mother_id, p.full_name FROM family_access_grants g JOIN mother_profiles p ON p.user_id = g.mother_id JOIN users u ON u.id = g.mother_id
          WHERE g.grantee_id = $1 AND g.revoked_at IS NULL AND g.expires_at > NOW() AND g.scopes @> '"emergency_alert"'::jsonb AND u.closed_at IS NULL AND u.email LIKE '%@dai-synthetic.invalid'`, [req.user.id]);
      mothers = g.rows.map((r) => ({ mother_id: r.mother_id, name: r.full_name }));
    }
    const list = EM.symptomsFor(context).filter((s) => GH.NOT_SHARED_CODES.indexOf(s.code) < 0);
    res.json({
      available: true, label: GH.PROTOTYPE_LABEL, rule_version: GH.VERSION, context, mothers, numbers: EM.NUMBERS,
      hero: GH.HERO_CODES.map((c) => ({ code: c, label: GH.HERO_PLAIN[c], official: (list.find((s) => s.code === c) || {}).label })).filter((h) => h.official),
      other: list.filter((s) => GH.HERO_CODES.indexOf(s.code) < 0).map((s) => ({ code: s.code, label: s.label, level: s.level })),
      eta_assumptions: GH.estimateEta(0).assumptions
    });
  }));

  app.post('/api/golden-hour/alerts', ...who, handle(async (req, res) => {
    const b = req.body || {};
    const actor = await resolveActor(req, b.mother_id);
    const patient = await syntheticMother(actor.motherId);
    if (typeof b.request_key !== 'string' || b.request_key.length < 16 || b.request_key.length > 80) throw new Fail(400, 'Missing request key.');
    const codes = Array.isArray(b.symptoms) ? [...new Set(b.symptoms.filter((c) => typeof c === 'string'))].slice(0, 20) : [];
    if (!codes.length) throw new Fail(400, 'Choose at least one danger sign. If you are unsure and worried, call 112 (or 108).');
    limit(req.user.id);

    // Same request again (a double tap, or a retry after a dropped connection) returns the same alert.
    const dup = (await pool.query('SELECT * FROM golden_hour_alerts WHERE mother_id = $1 AND request_key = $2', [actor.motherId, b.request_key])).rows[0];
    if (dup) return res.json({ alert: present(dup), duplicate: true });
    // One open alert at a time: mother and family pressing at once must not send two.
    const open = (await pool.query(`SELECT * FROM golden_hour_alerts WHERE mother_id = $1 AND status = ANY($2::text[]) AND created_at > NOW() - INTERVAL '2 hours' ORDER BY created_at DESC LIMIT 1`, [actor.motherId, OPEN])).rows[0];
    if (open) return res.json({ alert: present(open), duplicate: true, notice: 'An alert is already open for her, so a second one was not sent.' });

    const inputs = await loadPatient(actor.motherId);
    const context = b.context === 'pregnant' || b.context === 'postpartum' ? b.context : inputs.context;
    const valid = new Set(EM.symptomsFor(context).map((s) => s.code));
    if (codes.some((c) => !valid.has(c))) throw new Fail(400, 'One of the selected signs does not apply. Please check again.');
    if (actor.by === 'family' && codes.some((c) => GH.NOT_SHARED_CODES.indexOf(c) >= 0)) throw new Fail(400, 'One of the selected signs does not apply. Please check again.');
    const location = validateLocation(b.location);
    const gest = context === inputs.context ? inputs.gestWeeks : null;
    const latest = inputs.bpReadings[0];

    // 1) Fixed-rule triage, re-run here. A browser can never lower or raise it.
    const triage = EM.triage(codes, { context, gestWeeks: gest, latestBP: EM.bpWithHours(latest ? { systolic: latest.systolic, diastolic: latest.diastolic, at: latest.at } : null, now()) });
    const priority = GH.alertPriority(triage.level);
    // Self-harm wording is never stored in the alert, never sent to a hospital and never shown to family; the patient's own emergency flow handles it.
    const shareable = { ...triage, matched: triage.matched.filter((m) => GH.NOT_SHARED_CODES.indexOf(m.code) < 0) };
    if (!priority) {
      return res.json({ alert: null, sent: false, triage, numbers: EM.NUMBERS, message: 'These signs do not trip an emergency pre-alert. If you are worried, speak to a doctor or go to a facility today, and call 112 (or 108) if anything gets worse.' });
    }

    // 2) The existing emergency record, so it shows in her emergency history too.
    const note500 = clean(b.note, 500);
    const merged = { ...inputs, context, symptoms: codes, note: note500, ...(context !== inputs.context ? { gestWeeks: null, edd: null, daysPostpartum: null } : {}) };
    const summary = EM.buildSummary(merged, now());
    let eventId = Number.isSafeInteger(b.emergency_event_id) && actor.by === 'mother' ? b.emergency_event_id : null;
    if (eventId) { const ev = await pool.query('SELECT id FROM emergency_events WHERE id = $1 AND mother_id = $2', [eventId, actor.motherId]); if (!ev.rows.length) eventId = null; }
    if (!eventId) {
      const er = await pool.query(`INSERT INTO emergency_events (mother_id, context, symptoms, triage_level, note, summary) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [actor.motherId, context, JSON.stringify(triage.matched.map((m) => m.code)), triage.level, note500 || null, JSON.stringify(summary)]);
      eventId = er.rows[0].id;
    }

    // 3) Nearest facility that actually has what is needed.
    const requirements = GH.requirementsFor(codes, { gestWeeks: gest });
    const facilities = await loadFacilities();
    const pick = GH.pickFacility(facilities, location, requirements);
    const candidates = pick.ranked.map((r) => ({ code: r.facility.code, name: r.facility.name, distance_km: r.distance_km, eta_minutes: r.eta.minutes, eligible: r.eligible, missing: r.missing, preferred_met: r.preferred_met }));
    const origin = { source: location.source, precision: location.precision, label: location.label, latitude: coarse(location.latitude), longitude: coarse(location.longitude) };
    const id = crypto.randomUUID();

    const sharedLabels = shareable.matched.map((m) => m.label);
    const sbarInput = (facName, etaMin) => ({
      patient: { name: inputs.name, age: inputs.age }, context, gestWeeks: gest, edd: context === 'pregnant' ? inputs.edd : null, daysPostpartum: inputs.daysPostpartum, deliveryType: inputs.deliveryType,
      triage: shareable, symptomLabels: sharedLabels, note: note500, bpReadings: inputs.bpReadings, bloodGroup: inputs.bloodGroup, allergies: inputs.allergies, medications: inputs.medications,
      conditions: inputs.conditions, gravida: inputs.gravida, parity: inputs.parity, previousComplications: inputs.previousComplications, riskLevel: inputs.riskLevel,
      contact: inputs.contact, requirements, facility: { name: facName }, eta: { minutes: etaMin }, triggeredBy: actor.by,
      preeclampsiaWarning: codes.includes('severe_headache_vision') || (latest && (latest.systolic >= 160 || latest.diastolic >= 110)) || false
    });

    if (!pick.chosen) {
      const row = { id, mother_id: actor.motherId, triggered_by_user_id: req.user.id, triggered_by: actor.by, emergency_event_id: eventId, request_key: b.request_key, priority, symptoms: shareable.matched.map((m) => ({ code: m.code, label: m.label, level: m.level })), triage: shareable, requirements, candidates, facility_code: null, facility_name: null, distance_km: null, eta_minutes: null, origin, sbar: null, status: 'no_capable_facility', delivery: 'none', portal_alert_id: null, portal_status: null, history: [], actions: [] };
      note(row, 'No facility in the demonstration network has everything this situation needs. Nobody was alerted.');
      await pool.query(`INSERT INTO golden_hour_alerts (id,mother_id,triggered_by_user_id,triggered_by,emergency_event_id,request_key,priority,symptoms,triage,requirements,candidates,origin,status,delivery,history,actions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [row.id, row.mother_id, row.triggered_by_user_id, row.triggered_by, row.emergency_event_id, row.request_key, row.priority, JSON.stringify(row.symptoms), JSON.stringify(shareable), JSON.stringify(requirements), JSON.stringify(candidates), JSON.stringify(origin), row.status, row.delivery, JSON.stringify(row.history), '[]']);
      return res.status(201).json({ alert: { ...present({ ...row, created_at: new Date(now()).toISOString() }), message: 'No capable facility was found in the demonstration network, so no hospital was alerted. Call 112 (or 108) now and tell them the main problem.' }, sent: false });
    }

    const c = pick.chosen;
    const sbar = GH.buildSBAR(sbarInput(c.facility.name, c.eta.minutes), now());
    sbar.patient_snapshot = { age: inputs.age, context, gest_weeks: gest, blood_group: inputs.bloodGroup || null, allergies: inputs.allergies || null, medications: inputs.medications || null, conditions: inputs.conditions || null, bp_readings: inputs.bpReadings, contact: inputs.contact, edd: context === 'pregnant' ? inputs.edd : null };
    const row = {
      id, mother_id: actor.motherId, triggered_by_user_id: req.user.id, triggered_by: actor.by, emergency_event_id: eventId, request_key: b.request_key, priority,
      symptoms: shareable.matched.map((m) => ({ code: m.code, label: m.label, level: m.level })), triage: shareable, requirements, candidates,
      facility_code: c.facility.code, facility_name: c.facility.name, distance_km: c.distance_km, eta_minutes: c.eta.minutes, origin, sbar,
      status: 'sent', delivery: 'pending', portal_alert_id: null, portal_status: null, history: [], actions: [], created_at: new Date(now()).toISOString()
    };
    note(row, 'Danger-sign check tripped (' + triage.level + '). Chosen by fixed capability rules: ' + c.facility.name + '.');
    await pool.query(`INSERT INTO golden_hour_alerts (id,mother_id,triggered_by_user_id,triggered_by,emergency_event_id,request_key,priority,symptoms,triage,requirements,candidates,facility_code,facility_name,distance_km,eta_minutes,origin,sbar,status,delivery,history,actions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [row.id, row.mother_id, row.triggered_by_user_id, row.triggered_by, row.emergency_event_id, row.request_key, row.priority, JSON.stringify(row.symptoms), JSON.stringify(shareable), JSON.stringify(requirements), JSON.stringify(candidates), row.facility_code, row.facility_name, row.distance_km, row.eta_minutes, JSON.stringify(origin), JSON.stringify(sbar), row.status, row.delivery, '[]', '[]']);
    const sent = await deliver(row, patient.name);
    await saveRow(row);
    res.status(201).json({ alert: present(row, sent.ok ? sent.portal : null), sent: sent.ok, message: sent.ok ? 'Pre-alert sent. Now call 112 (or 108). Do not wait for the hospital to reply.' : 'The hospital portal could not be reached, so the hospital has NOT been told. Call 112 (or 108) and the facility now. You can retry sending.' });
  }));

  app.get('/api/golden-hour/alerts/active', ...who, handle(async (req, res) => {
    const motherId = req.user.role === 'mother' ? req.user.id : (await resolveActor(req, req.query.mother_id)).motherId;
    const row = (await pool.query(`SELECT * FROM golden_hour_alerts WHERE mother_id = $1 AND created_at > NOW() - INTERVAL '6 hours' ORDER BY created_at DESC LIMIT 1`, [motherId])).rows[0];
    if (!row) return res.json({ alert: null });
    res.json({ alert: present(row) });
  }));

  // Re-route after a decline: next eligible facility, never one already tried.
  async function reroute(row, patientName) {
    const tried = new Set([row.facility_code, ...(row.history || []).filter((h) => h.tried).map((h) => h.tried)]);
    const next = (row.candidates || []).filter((c) => c.eligible && !tried.has(c.code)).sort((a, b) => a.distance_km - b.distance_km)[0];
    note(row, row.facility_name + ' could not accept.');
    row.history.push({ at: new Date(now()).toISOString(), tried: row.facility_code, text: 'Tried ' + row.facility_name });
    if (!next) { row.status = 'no_capable_facility'; note(row, 'No other capable facility is available. Call 112 (or 108).'); return false; }
    row.facility_code = next.code; row.facility_name = next.name; row.distance_km = next.distance_km; row.eta_minutes = next.eta_minutes;
    row.request_key = row.request_key.slice(0, 60) + '-r' + (tried.size);
    const inp = row.sbar && row.sbar.patient_snapshot;
    row.sbar = { ...row.sbar, text: row.sbar.text.replace(/for [^\n]*/, 'for ' + next.name), patient_snapshot: inp };
    row.status = 'rerouted'; row.delivery = 'pending'; row.portal_alert_id = null;
    note(row, 'Alert re-sent to the next capable facility: ' + next.name + '.');
    return (await deliver(row, patientName)).ok;
  }

  app.get('/api/golden-hour/alerts/:id', ...who, handle(async (req, res) => {
    const { row } = await access(req, req.params.id);
    let portal = null;
    if (row.delivery === 'delivered' && row.portal_alert_id) {
      const before = row.portal_status;
      try {
        portal = await forward(row.mother_id, 'Patient', '/api/demo-coordination/patient/golden-hour/' + row.portal_alert_id, 'GET');
        const st = portal.alert.status;
        if (st !== before) {
          row.portal_status = st;
          const map = { seen: 'received', accepted: 'accepted', arrived: 'arrived', cancelled: 'cancelled' };
          if (map[st]) row.status = map[st];
          if (st === 'seen') note(row, row.facility_name + ' has seen the alert.');
          if (st === 'accepted') note(row, row.facility_name + ' accepted.');
          if (st === 'arrived') note(row, 'Marked as arrived at ' + row.facility_name + '.');
          if (st === 'declined') {
            const p = await syntheticMother(row.mother_id);
            const ok = await reroute(row, p.name);
            await saveRow(row);
            return res.json({ alert: present(row), rerouted: ok });
          }
          await saveRow(row);
        }
      } catch (e) { /* keep last known state; the hospital portal may be restarting */ }
    }
    res.json({ alert: present(row, portal) });
  }));

  app.post('/api/golden-hour/alerts/:id/retry', ...who, handle(async (req, res) => {
    const { row } = await access(req, req.params.id);
    if (row.delivery !== 'not_delivered') throw new Fail(409, 'This alert does not need to be re-sent.');
    const p = await syntheticMother(row.mother_id);
    const sent = await deliver(row, p.name);
    await saveRow(row);
    res.json({ alert: present(row, sent.ok ? sent.portal : null), sent: sent.ok });
  }));

  app.post('/api/golden-hour/alerts/:id/cancel', ...who, handle(async (req, res) => {
    const { row } = await access(req, req.params.id);
    if (!OPEN.includes(row.status) && row.status !== 'no_capable_facility') throw new Fail(409, 'This alert is already closed.');
    if (row.delivery === 'delivered' && row.portal_alert_id) {
      try { await forward(row.mother_id, 'Patient', '/api/demo-coordination/patient/golden-hour/' + row.portal_alert_id + '/cancel', 'POST', { note: clean(req.body && req.body.note, 200) || 'Cancelled by the patient or family.' }); } catch (e) { note(row, 'The hospital could not be told about the cancellation. Please phone them.'); }
    }
    row.status = 'cancelled'; note(row, 'Cancelled by ' + (row.triggered_by === 'family' ? 'family' : 'the patient') + '.');
    await saveRow(row);
    res.json({ alert: present(row) });
  }));

  app.post('/api/golden-hour/alerts/:id/actions', ...who, handle(async (req, res) => {
    const { row } = await access(req, req.params.id);
    const action = req.body && req.body.action;
    if (!ACTIONS.includes(action)) throw new Fail(400, 'Unknown action.');
    row.actions = [...(row.actions || []), { action, at: new Date(now()).toISOString() }];
    await saveRow(row);
    res.json({ actions: row.actions });
  }));

  return { reroute, validateLocation };
}

module.exports = { register, validateLocation, Fail, TERMINAL_PORTAL };
