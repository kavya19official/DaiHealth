'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const GH = require('../shared/golden-hour');
const EM = require('../shared/emergency-triage');
const { register } = require('./goldenHour');

const FIX = require('../synthetic_data/demo/delhi-network.json');
const COORDS = { CENTRAL: [28.6315, 77.2167], SOUTH: [28.533, 77.21], WEST: [28.589, 77.047], NORTH: [28.715, 77.12], EAST: [28.641, 77.295] };
const JSON_COLS = new Set(['symptoms', 'triage', 'requirements', 'candidates', 'origin', 'sbar', 'history', 'actions']);

/* A small stand-in for the database that answers exactly the queries goldenHour.js makes. */
function world(opts = {}) {
  const w = {
    rows: [], events: 0, forwards: [], portalDown: false, portalStatus: 'incoming', portalSeq: 0,
    grants: opts.grants || [], mother: opts.mother || { email: 'asha@dai-synthetic.invalid', full_name: 'SYNTHETIC Asha' },
    facilities: opts.facilities || FIX.facilities.map((f) => ({ id: f.code, facility_code: 'DAI-DELHI-FOCUSED-' + f.code, name: f.name, latitude: COORDS[f.code][0], longitude: COORDS[f.code][1], active: true,
      services: f.services.map(([name, category]) => ({ name, category, available: true })), capabilities: f.capabilities.map((name) => ({ name, available: true })) })),
    inputs: Object.assign({ name: 'SYNTHETIC Asha', age: 27, context: 'pregnant', gestWeeks: 34, edd: '2027-01-10', daysPostpartum: null, deliveryType: null, bloodGroup: 'B+', allergies: 'Penicillin', medications: 'Iron; Folic acid', conditions: null, gravida: 2, parity: 1, previousComplications: null, riskLevel: 'moderate', riskAssessedAt: null, latestBP: null, contact: { name: 'Ravi', phone: '9000000000' } }, opts.inputs || {}),
    bp: opts.bp || [{ data: { systolic: 152, diastolic: 98 }, logged_at: new Date(Date.now() - 3 * 3600e3).toISOString() }]
  };
  const parse = (row) => row;
  w.pool = {
    async query(sql, p = []) {
      sql = sql.replace(/\s+/g, ' ');
      if (/FROM family_access_grants g JOIN users u .* g\.mother_id = \$2/.test(sql)) return { rows: w.grants.some((g) => g.grantee === p[0] && g.mother === p[1]) ? [{}] : [] };
      if (/SELECT g\.mother_id, p\.full_name FROM family_access_grants/.test(sql)) return { rows: w.grants.filter((g) => g.grantee === p[0]).map((g) => ({ mother_id: g.mother, full_name: 'SYNTHETIC Asha' })) };
      if (/SELECT u\.email, m\.full_name FROM users u JOIN mother_profiles/.test(sql)) return { rows: [w.mother] };
      if (/FROM facilities f WHERE f\.facility_code LIKE/.test(sql)) return { rows: w.facilities };
      if (/FROM health_logs/.test(sql)) return { rows: w.bp };
      if (/INSERT INTO emergency_events/.test(sql)) return { rows: [{ id: 900 + (++w.events) }] };
      if (/SELECT id FROM emergency_events/.test(sql)) return { rows: [] };
      if (/INSERT INTO golden_hour_alerts/.test(sql)) {
        const cols = sql.match(/golden_hour_alerts \(([^)]*)\) VALUES/)[1].split(',').map((c) => c.trim());
        const row = { created_at: new Date().toISOString() };
        cols.forEach((c, i) => { row[c] = JSON_COLS.has(c) && typeof p[i] === 'string' ? JSON.parse(p[i]) : p[i]; });
        w.rows.push(row); return { rows: [] };
      }
      if (/UPDATE golden_hour_alerts SET status=\$2/.test(sql)) {
        const row = w.rows.find((r) => r.id === p[0]);
        Object.assign(row, { status: p[1], delivery: p[2], portal_alert_id: p[3], portal_status: p[4], facility_code: p[5], facility_name: p[6], distance_km: p[7], eta_minutes: p[8], history: JSON.parse(p[9]), actions: JSON.parse(p[10]), candidates: JSON.parse(p[11]) });
        return { rows: [] };
      }
      if (/FROM golden_hour_alerts WHERE mother_id = \$1 AND request_key = \$2/.test(sql)) return { rows: w.rows.filter((r) => r.mother_id === p[0] && r.request_key === p[1]) };
      if (/FROM golden_hour_alerts WHERE mother_id = \$1 AND status = ANY/.test(sql)) return { rows: w.rows.filter((r) => r.mother_id === p[0] && p[1].includes(r.status)).slice(-1) };
      if (/SELECT mother_id FROM golden_hour_alerts WHERE id = \$1/.test(sql)) return { rows: w.rows.filter((r) => r.id === p[0]).map((r) => ({ mother_id: r.mother_id })) };
      if (/SELECT \* FROM golden_hour_alerts WHERE id = \$1 AND mother_id = \$2/.test(sql)) return { rows: w.rows.filter((r) => r.id === p[0] && r.mother_id === p[1]) };
      if (/FROM golden_hour_alerts WHERE mother_id = \$1 AND created_at/.test(sql)) return { rows: w.rows.filter((r) => r.mother_id === p[0]).slice(-1) };
      throw new Error('Unexpected query in test: ' + sql.slice(0, 120));
    }
  };
  w.forward = async ({ path: pth, method, body }) => {
    w.forwards.push({ path: pth, method, body });
    if (w.portalDown) throw new Error('portal down');
    if (method === 'POST' && pth.endsWith('/golden-hour')) return { alert: { id: 'portal-' + (++w.portalSeq), status: 'incoming', version: 1 } };
    if (method === 'GET') return { alert: { status: w.portalStatus, public_note: 'note', version: 2, ambulance: { simulated: true, state: 'en_route', progress: 0.4, remaining_minutes: 9 }, accepted_by_name: w.portalStatus === 'accepted' ? 'SYNTHETIC Dr Demo' : null } };
    return { alert: { status: 'cancelled' } };
  };
  const routes = [];
  const app = { locals: { loadEmergencyInputs: async () => w.inputs } };
  for (const m of ['get', 'post']) app[m] = (p, ...h) => routes.push({ m, p, h });
  const env = Object.assign({ DAI_LOCAL: 'true', DAI_DEMO: 'true' }, opts.env || {});
  register(app, { pool: w.pool, authenticateToken: (q, s, n) => n(), authorizeRole: () => (q, s, n) => n(), env, forward: w.forward });
  w.call = async (method, url, { user = { id: 7, role: 'mother' }, body, query = {} } = {}) => {
    const pathOnly = url.split('?')[0];
    const route = routes.find((r) => r.m === method && new RegExp('^' + r.p.replace(/:[a-z]+/g, '([^/]+)') + '$').test(pathOnly));
    assert.ok(route, 'route ' + method + ' ' + url);
    const m = pathOnly.match(new RegExp('^' + route.p.replace(/:[a-z]+/g, '([^/]+)') + '$'));
    const req = { user, body, query, params: { id: m[1] } };
    let status = 200, out;
    const res = { set() { return res; }, status(s) { status = s; return res; }, json(v) { out = v; return res; } };
    await route.h[route.h.length - 1](req, res);
    return { status, body: out };
  };
  return w;
}
const key = () => 'k-' + Math.random().toString(36).slice(2) + '-padpadpad';
const SOUTH_PIN = { source: 'manual_pin', pincode: '110017' };

test('heavy bleeding: nearest facility lacks capability, so the nearest CAPABLE one is chosen and the skip is shown', async () => {
  const w = world();
  const r = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['heavy_bleeding'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(r.status, 201);
  assert.equal(r.body.sent, true);
  assert.equal(r.body.alert.facility.code, 'WEST');
  assert.equal(r.body.alert.priority, 'emergency');
  const skipped = r.body.alert.why.skipped_nearer.map((s) => s.name);
  assert.ok(skipped.some((n) => /South Mother Care/.test(n)), 'the nearer centre that lacks transfusion is listed, not hidden');
  assert.ok(r.body.alert.why.skipped_nearer.every((s) => s.missing.length > 0));
  assert.match(r.body.message, /call 112/i);
  assert.ok(r.body.alert.instructions[0].includes('112'));
  assert.match(r.body.alert.label, /PROTOTYPE/);
});

test('what is sent to the hospital: SBAR with BP readings, blood group, allergies, medicines, gestation, ETA, and the facility re-check inputs', async () => {
  const w = world();
  await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['heavy_bleeding'], location: SOUTH_PIN, request_key: key() } });
  const sent = w.forwards.find((f) => f.method === 'POST');
  assert.equal(sent.path, '/api/demo-coordination/patient/golden-hour');
  assert.equal(sent.body.directory_code, 'WEST');
  assert.deepEqual(sent.body.requirements.caps.sort(), ['blood_transfusion', 'emergency_maternity']);
  const text = sent.body.sbar.text;
  for (const bit of ['152/98', 'B+', 'Penicillin', 'Iron; Folic acid', 'about 34 weeks', 'ETA about', 'NOT confirmed', 'not a diagnosis']) assert.ok(text.includes(bit), bit);
  assert.ok(sent.body.sbar.sections.map((s) => s.key).join('') === 'SBAR');
  assert.ok(sent.body.origin.latitude === Math.round(sent.body.origin.latitude * 1000) / 1000, 'location is coarse');
});

test('urgent signs (reduced movement) send an urgent-priority alert to the nearest capable centre, which can be the nearest one', async () => {
  const w = world();
  const r = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['reduced_movement'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(r.body.alert.priority, 'urgent');
  assert.equal(r.body.alert.facility.code, 'SOUTH');
  assert.equal(r.body.alert.why.skipped_nearer.length, 0);
});

test('triage is decided on the server by the shared fixed rules; a client cannot supply a level', async () => {
  const w = world();
  const r = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['seizure'], triage_level: 'unsure', level: 'unsure', location: SOUTH_PIN, request_key: key() } });
  assert.equal(r.body.alert.triage.level, EM.triage(['seizure'], { context: 'pregnant', gestWeeks: 34 }).level);
  assert.equal(r.body.alert.triage.level, 'emergency');
});

test('input checks: no signs, unknown signs, bad key, bad location', async () => {
  const w = world();
  assert.equal((await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: [], location: SOUTH_PIN, request_key: key() } })).status, 400);
  assert.equal((await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['pp_calf'], location: SOUTH_PIN, request_key: key() } })).status, 400, 'a postpartum-only sign does not apply while pregnant');
  assert.equal((await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['seizure'], location: SOUTH_PIN, request_key: 'short' } })).status, 400);
  const far = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['seizure'], location: { source: 'device', consent: true, latitude: 19.07, longitude: 72.87, accuracy: 20 }, request_key: key() } });
  assert.equal(far.status, 400);
  assert.match(far.body.call, /112/);
  assert.equal(w.rows.length, 0, 'nothing is stored or sent for rejected input');
  assert.equal(w.forwards.length, 0);
});

test('a double tap or a second person pressing does not send a second alert', async () => {
  const w = world();
  const k = key();
  const a = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['heavy_bleeding'], location: SOUTH_PIN, request_key: k } });
  const b = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['heavy_bleeding'], location: SOUTH_PIN, request_key: k } });
  assert.equal(b.body.duplicate, true);
  assert.equal(b.body.alert.id, a.body.alert.id);
  const c = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['seizure'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(c.body.duplicate, true);
  assert.match(c.body.notice, /already open/);
  assert.equal(w.forwards.filter((f) => f.method === 'POST').length, 1);
});

test('if the hospital portal is unreachable, she is told plainly that the hospital was NOT told, and can retry', async () => {
  const w = world(); w.portalDown = true;
  const r = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['heavy_bleeding'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(r.body.sent, false);
  assert.equal(r.body.alert.delivery, 'not_delivered');
  assert.match(r.body.message, /NOT been told/);
  assert.match(r.body.message, /112/);
  w.portalDown = false;
  const retry = await w.call('post', '/api/golden-hour/alerts/' + r.body.alert.id + '/retry');
  assert.equal(retry.body.sent, true);
  assert.equal(retry.body.alert.delivery, 'delivered');
  assert.equal((await w.call('post', '/api/golden-hour/alerts/' + r.body.alert.id + '/retry')).status, 409);
});

test('no capable facility: nobody is alerted and she is told to call 112 / 108', async () => {
  const w = world({ facilities: FIX.facilities.filter((f) => f.code !== 'WEST').map((f) => ({ id: f.code, facility_code: 'DAI-DELHI-FOCUSED-' + f.code, name: f.name, latitude: COORDS[f.code][0], longitude: COORDS[f.code][1], active: true, services: f.services.map(([name, category]) => ({ name, category, available: true })), capabilities: f.capabilities.map((name) => ({ name, available: true })) })) });
  const r = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['heavy_bleeding'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(r.body.sent, false);
  assert.equal(r.body.alert.status, 'no_capable_facility');
  assert.match(r.body.alert.message, /Call 112/);
  assert.equal(w.forwards.length, 0);
});

test('live status follows the hospital: seen, accepted (with simulated ambulance), and a decline is re-routed to the next capable facility', async () => {
  const w = world({ facilities: FIX.facilities.map((f) => ({ id: f.code, facility_code: 'DAI-DELHI-FOCUSED-' + f.code, name: f.name, latitude: COORDS[f.code][0], longitude: COORDS[f.code][1], active: true, services: f.services.map(([name, category]) => ({ name, category, available: true })), capabilities: f.capabilities.map((name) => ({ name, available: true })) })) });
  const a = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['reduced_movement'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(a.body.alert.facility.code, 'SOUTH');
  w.portalStatus = 'seen';
  let s = await w.call('get', '/api/golden-hour/alerts/' + a.body.alert.id);
  assert.equal(s.body.alert.status, 'received');
  w.portalStatus = 'accepted';
  s = await w.call('get', '/api/golden-hour/alerts/' + a.body.alert.id);
  assert.equal(s.body.alert.status, 'accepted');
  assert.equal(s.body.alert.hospital.accepted_by, 'SYNTHETIC Dr Demo');
  assert.equal(s.body.alert.hospital.ambulance.simulated, true);
  // A second alert whose hospital declines. Fever needs only obstetric cover, so three centres are eligible.
  const w2 = world();
  const b = await w2.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['fever'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(b.body.alert.facility.code, 'SOUTH');
  w2.portalStatus = 'declined';
  const d = await w2.call('get', '/api/golden-hour/alerts/' + b.body.alert.id);
  assert.equal(d.body.rerouted, true);
  assert.equal(d.body.alert.facility.code, 'CENTRAL', 'next nearest eligible, never one already tried');
  assert.equal(w2.forwards.filter((f) => f.method === 'POST').length, 2, 'a second pre-alert went to the new facility');
  const d2 = await w2.call('get', '/api/golden-hour/alerts/' + b.body.alert.id);
  assert.equal(d2.body.alert.facility.code, 'WEST');
  const d3 = await w2.call('get', '/api/golden-hour/alerts/' + b.body.alert.id);
  assert.equal(d3.body.rerouted, false);
  assert.equal(d3.body.alert.status, 'no_capable_facility');
  // Reduced movement needs ultrasound, which only SOUTH lists: a decline there leaves nowhere to go and she is told so.
  const w3 = world();
  const e = await w3.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['reduced_movement'], location: SOUTH_PIN, request_key: key() } });
  w3.portalStatus = 'declined';
  const f = await w3.call('get', '/api/golden-hour/alerts/' + e.body.alert.id);
  assert.equal(f.body.rerouted, false);
  assert.equal(f.body.alert.status, 'no_capable_facility');
});

test('family: only with an unexpired grant that includes emergency_alert, and the alert says a family member raised it', async () => {
  const w = world({ grants: [{ grantee: 50, mother: 7 }] });
  const fam = { id: 50, role: 'caregiver' }, other = { id: 51, role: 'caregiver' };
  assert.equal((await w.call('post', '/api/golden-hour/alerts', { user: other, body: { mother_id: 7, symptoms: ['seizure'], location: SOUTH_PIN, request_key: key() } })).status, 403);
  assert.equal((await w.call('post', '/api/golden-hour/alerts', { user: fam, body: { symptoms: ['seizure'], location: SOUTH_PIN, request_key: key() } })).status, 400, 'must say whom');
  const cfg = await w.call('get', '/api/golden-hour/config', { user: fam });
  assert.deepEqual(cfg.body.mothers.map((m) => m.mother_id), [7]);
  const r = await w.call('post', '/api/golden-hour/alerts', { user: fam, body: { mother_id: 7, symptoms: ['seizure'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(r.status, 201);
  assert.equal(r.body.alert.triggered_by, 'family');
  assert.match(w.forwards[0].body.sbar.text, /a family member/);
  assert.equal(w.forwards[0].body.triggered_by, 'family');
  // The family member can follow it, a stranger cannot.
  assert.equal((await w.call('get', '/api/golden-hour/alerts/' + r.body.alert.id, { user: fam })).status, 200);
  assert.equal((await w.call('get', '/api/golden-hour/alerts/' + r.body.alert.id, { user: other })).status, 403);
});

test('self-harm wording is never shared in a hospital pre-alert', async () => {
  const w = world({ inputs: { context: 'postpartum', gestWeeks: null, edd: null, daysPostpartum: 5, deliveryType: 'normal' } });
  const r = await w.call('post', '/api/golden-hour/alerts', { body: { context: 'postpartum', symptoms: ['heavy_bleeding', 'pp_self_harm'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(r.status, 201);
  const sent = w.forwards[0].body;
  assert.ok(!JSON.stringify(sent).includes('pp_self_harm'));
  assert.ok(!/harming myself/i.test(JSON.stringify(sent)));
  assert.ok(!/harming myself|pp_self_harm/i.test(JSON.stringify(r.body.alert)), 'not in what the app shows either');
  assert.ok(!/harming myself|pp_self_harm/i.test(JSON.stringify(w.rows)), 'not stored in the alert');
  const fam = world({ grants: [{ grantee: 50, mother: 7 }], inputs: { context: 'postpartum', gestWeeks: null, daysPostpartum: 5 } });
  const fr = await fam.call('post', '/api/golden-hour/alerts', { user: { id: 50, role: 'caregiver' }, body: { mother_id: 7, context: 'postpartum', symptoms: ['pp_self_harm'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(fr.status, 400, 'family cannot raise or see this sign');
});

test('synthetic-only and local-demo-only gates', async () => {
  const real = world({ mother: { email: 'real.person@example.com', full_name: 'Real Person' } });
  const r = await real.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['seizure'], location: SOUTH_PIN, request_key: key() } });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /call 112/i);
  const off = world({ env: { DAI_DEMO: 'false' } });
  assert.equal((await off.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['seizure'], location: SOUTH_PIN, request_key: key() } })).status, 404);
  assert.equal(off.forwards.length, 0);
});

test('cancel and self-reported actions', async () => {
  const w = world();
  const a = await w.call('post', '/api/golden-hour/alerts', { body: { symptoms: ['heavy_bleeding'], location: SOUTH_PIN, request_key: key() } });
  const act = await w.call('post', '/api/golden-hour/alerts/' + a.body.alert.id + '/actions', { body: { action: 'called_ambulance' } });
  assert.equal(act.body.actions[0].action, 'called_ambulance');
  assert.equal((await w.call('post', '/api/golden-hour/alerts/' + a.body.alert.id + '/actions', { body: { action: 'drop table' } })).status, 400);
  const c = await w.call('post', '/api/golden-hour/alerts/' + a.body.alert.id + '/cancel', { body: {} });
  assert.equal(c.body.alert.status, 'cancelled');
  assert.ok(w.forwards.some((f) => f.path.endsWith('/cancel')), 'the hospital is told');
  assert.equal((await w.call('post', '/api/golden-hour/alerts/' + a.body.alert.id + '/cancel', { body: {} })).status, 409);
});

test('shared engine: requirements, ETA, SBAR are deterministic and cover every danger sign', () => {
  const codes = ['heavy_bleeding', 'seizure', 'severe_headache_vision', 'chest_breath', 'fainting', 'severe_abdominal_pain', 'reduced_movement', 'bleeding_any', 'waters_break', 'contractions', 'swelling_sudden', 'fever', 'vomiting_cannot_drink', 'pp_calf', 'pp_wound', 'pp_foul_discharge', 'pp_breast'];
  for (const c of codes) { const r = GH.requirementsFor([c]); assert.ok(r.caps.length + r.capsAny.length + r.svcs.length > 0, c + ' has a requirement'); assert.ok(r.reasons[0].why, c); }
  assert.deepEqual(GH.requirementsFor(['heavy_bleeding', 'seizure']).caps.sort(), ['blood_transfusion', 'emergency_maternity', 'high_risk_pregnancy']);
  assert.deepEqual(GH.requirementsFor(['pp_self_harm']).caps, [], 'self-harm adds no facility requirement');
  assert.ok(GH.requirementsFor(['waters_break'], { gestWeeks: 30 }).preferSvc.includes('nicu'));
  assert.equal(JSON.stringify(GH.requirementsFor(['heavy_bleeding'])), JSON.stringify(GH.requirementsFor(['heavy_bleeding'])));
  assert.ok(GH.estimateEta(0).minutes >= GH.ETA.minMinutes);
  assert.equal(GH.alertPriority('unsure'), null);
});

test('front-end and portal files are wired in', () => {
  const root = path.join(__dirname, '..');
  const need = {
    'frontend/dashboard.html': [/js\/golden-hour\.js/, /js\/golden-hour\.css/],
    'frontend/js/care-extensions.js': [/sosGolden/, /GoldenHourUI\.open/],
    'frontend/js/platform-rights.js': [/emergency_alert/],
    'frontend/caregiver.html': [/golden-hour\.js/],
    'frontend/patient-sw.js': [/golden-hour\.js/],
    'hospital_portal/api/main.py': [/register_golden_hour/],
    'hospital_portal/web/app/page.tsx': [/GoldenHour/]
  };
  for (const [f, res] of Object.entries(need)) { const s = fs.readFileSync(path.join(root, f), 'utf8'); for (const re of res) assert.match(s, re, f + ' ' + re); }
  for (const f of ['frontend/js/golden-hour.js', 'shared/golden-hour.js', 'frontend/js/care-extensions.js', 'frontend/js/caregiver.js']) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(root, f), 'utf8')), f);
});
