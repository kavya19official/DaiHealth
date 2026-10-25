'use strict';
// N. Privacy rules, tested without a database: the engine is pure, and the HTTP layer runs against a fake pool.
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express');
const A = require('./privacyAnalytics');

const row = (key, people, total, positive, durations) => ({ key, label: 'Facility ' + key, people, total, positive, ...(durations ? { durations } : {}) });
const report = (rows, metric = 'missed_visits') => A.buildReport({ metric, groupBy: 'facility', windowDays: 90, rows });

test('groups with fewer than K people are hidden and carry no numbers at all', () => {
  const r = report([row('a', 9, 40, 10), row('b', 10, 40, 10), row('c', 3, 4, 1)]);
  const a = r.rows.find((x) => x.key === 'a'), c = r.rows.find((x) => x.key === 'c');
  for (const hidden of [a, c]) {
    assert.equal(hidden.suppressed, true);
    assert.deepEqual(Object.keys(hidden).sort(), ['key', 'label', 'reason', 'suppressed']);   // nothing else leaks
  }
  assert.equal(r.rows.find((x) => x.key === 'b').suppressed, false);
  assert.equal(r.hidden_groups, 2); assert.equal(A.K_MIN, 10);
});

test('no overall total or exact count is returned, so hidden groups cannot be recovered by subtraction', () => {
  const r = report([row('a', 4, 4, 1), row('b', 25, 100, 20)]);
  assert.equal('overall' in r, false); assert.equal('total' in r, false);
  const shown = r.rows.find((x) => x.key === 'b');
  assert.equal('people' in shown, false); assert.equal('total' in shown, false); assert.equal('positive' in shown, false);
  assert.equal(shown.people_band, '20\u201349');
  assert.match(JSON.stringify(r), /^(?!.*"people":)/);
});

test('rates are exact only when events and non-events are both numerous enough', () => {
  assert.deepEqual(A.rateCell(20, 100), { rate_pct: 20, rate_text: '20%' });
  assert.equal(A.rateCell(1, 50).rate_text, 'under 30%'); assert.equal(A.rateCell(1, 50).rate_pct, null);
  assert.equal(A.rateCell(0, 50).rate_text, 'under 30%');
  assert.equal(A.rateCell(49, 50).rate_text, 'over 70%');
  assert.equal(A.rateCell(0, 0).rate_text, 'No data');
});

test('a median is shown only with enough completed cases', () => {
  const few = report([row('a', 30, 30, 4, [1, 2, 3, 4])], 'time_to_follow_up').rows[0];
  assert.equal(few.median_days, null); assert.ok(few.median_note);
  const enough = report([row('a', 30, 30, 5, [1, 2, 3, 4, 10])], 'time_to_follow_up').rows[0];
  assert.equal(enough.median_days, 3);
  assert.equal(A.median([1, 3]), 2); assert.equal(A.median([]), null);
});

test('people are banded and the band edges are right', () => {
  assert.deepEqual([10, 19, 20, 49, 50, 99, 100, 500].map(A.peopleBand), ['10\u201319', '10\u201319', '20\u201349', '20\u201349', '50\u201399', '50\u201399', '100+', '100+']);
});

test('CSV contains exactly the published rows, hides suppressed ones and blocks spreadsheet formulas', () => {
  const r = report([{ ...row('a', 30, 100, 20), label: '=HYPERLINK("http://x")' }, row('b', 2, 2, 1)]);
  const csv = A.reportToCsv(r);
  assert.match(csv, /^# DaiHealth aggregate analytics/);
  assert.match(csv, /minimum_group_size=10/);
  assert.ok(csv.includes("'=HYPERLINK"));                          // neutralised
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
  const body = csv.split('\r\n').filter((l) => l && !l.startsWith('#')).slice(1);
  assert.equal(body.length, 2);
  assert.match(body[1], /hidden,hidden/);                          // suppressed row has no values
  assert.equal(/"?20%"?/.test(body[1]), false);
});

function makeApp(state) {
  const pool = { async query(sql, params) {
    if (/FROM doctor_profiles WHERE user_id=\$1/.test(sql)) return { rows: state.verified.has(params[0]) ? [{ medical_license_number: 'X', credential_verified: true }] : [{ medical_license_number: 'X', credential_verified: false }] };
    if (/FROM appointments x JOIN doctor_profiles/.test(sql)) return { rows: [{ uuid: 'fac-a', name: 'Alpha Clinic' }] };
    if (/FROM analytics_access_log/.test(sql) && /COUNT/.test(sql)) return { rows: [{ n: String(state.log.filter((l) => l.user === params[0] && l.kind === 'export').length) }] };
    if (/INSERT INTO analytics_access_log/.test(sql)) { state.log.push({ user: params[0], kind: params[1], shown: params[5], hidden: params[6] }); return { rows: [] }; }
    if (/FROM appointments a/.test(sql)) return { rows: state.missed };
    if (/FROM facility_referrals/.test(sql)) return { rows: state.referrals };
    if (/FROM missed_care_items/.test(sql)) return { rows: state.followups };
    throw new Error('Unexpected query: ' + sql.slice(0, 70));
  } };
  const app = express();
  const authenticateToken = (req, res, next) => { const id = Number(req.headers['x-user']); if (!id) return res.sendStatus(401); req.user = { id, role: id >= 3 ? 'doctor' : 'mother' }; next(); };
  const authorizeRole = (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
  require('./privacyAnalytics')(app, { pool, authenticateToken, authorizeRole });
  return app;
}

test('HTTP: only verified doctors can read; small groups are hidden; views and exports are audited and limited', async () => {
  const state = { verified: new Set([3]), log: [],
    missed: [{ k: 'fac-a', people: '40', total: '120', positive: '30' }, { k: 'fac-b', people: '4', total: '6', positive: '2' }],
    referrals: [{ k: '7', label: 'District Hospital', people: '12', total: '15', positive: '9', durations: [1, 2, 3, 4, 5, 6, 7, 8, 9] }],
    followups: [] };
  const app = makeApp(state), server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = async (url, user) => { const r = await fetch(base + url, { headers: { 'x-user': String(user) } }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* csv */ } return { status: r.status, json, text, type: r.headers.get('content-type') }; };
  try {
    assert.equal((await get('/api/analytics/report', 1)).status, 403);                      // a mother
    assert.equal((await get('/api/analytics/report', 4)).status, 403);                      // doctor who is not verified
    assert.equal((await get('/api/analytics/report?metric=nope', 3)).status, 400);
    assert.equal((await get('/api/analytics/report?window=7', 3)).status, 400);             // only fixed windows
    assert.equal((await get('/api/analytics/report?metric=missed_visits&group_by=area', 3)).status, 400); // area not offered for this measure

    const r = await get('/api/analytics/report?metric=missed_visits&group_by=facility&window=90', 3);
    assert.equal(r.status, 200);
    const a = r.json.rows.find((x) => x.label === 'Alpha Clinic'), b = r.json.rows.find((x) => x.suppressed);
    assert.equal(a.rate_text, '25%'); assert.ok(b && !('rate_text' in b));
    assert.equal(JSON.stringify(r.json).includes('"total"'), false);

    const ref = await get('/api/analytics/report?metric=referral_completion&group_by=area&window=180', 3);
    assert.equal(ref.status, 200); assert.equal(ref.json.rows[0].median_days, 5);

    for (let i = 0; i < A.EXPORT_LIMIT_PER_DAY; i++) {
      const e = await get('/api/analytics/export.csv?metric=missed_visits&group_by=facility&window=90', 3);
      assert.equal(e.status, 200); assert.match(e.type, /text\/csv/);
    }
    assert.equal((await get('/api/analytics/export.csv?metric=missed_visits&group_by=facility&window=90', 3)).status, 429);
    assert.ok(state.log.filter((l) => l.kind === 'view').length >= 2);
    assert.equal(state.log.filter((l) => l.kind === 'export').length, A.EXPORT_LIMIT_PER_DAY);
    assert.ok(state.log.every((l) => l.user === 3));
  } finally { server.close(); }
});
