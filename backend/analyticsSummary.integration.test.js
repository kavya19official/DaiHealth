'use strict';
// N + O against the real SQL (embedded PGlite). Needs dependencies installed by `npm start` or `npm run setup`.
// The database-free tests in privacyAnalytics.test.js and visitSummary.test.js cover the rules; this covers the queries.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), express = require('express');
const { createLocalPool } = require('./localPool'), { migrations } = require('../scripts/seed-local.cjs');

test('N and O: analytics suppress small groups and visit summaries follow the approval flow in real SQL', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dai-no-')), pool = createLocalPool(path.join(dir, 'db'));
  let server;
  try {
    for (const file of migrations) await pool.query(await fs.readFile(path.join(__dirname, 'db', file), 'utf8'));
    // users 1..15 mothers, 16 doctor (verified), 17 other doctor
    for (let i = 1; i <= 15; i++) await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'x','mother')", ['m' + i + '@synthetic.invalid']);
    for (const e of ['d1', 'd2']) await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'x','doctor')", [e + '@synthetic.invalid']);
    for (let i = 1; i <= 15; i++) await pool.query("INSERT INTO mother_profiles(user_id,full_name) VALUES($1,$2)", [i, 'SYNTHETIC Mother ' + i]);
    await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,facility_name,credential_verified) VALUES(16,'SYNTHETIC D1','Obstetrics','L1','Alpha Clinic',TRUE),(17,'SYNTHETIC D2','Obstetrics','L2','Beta Clinic',TRUE)");
    // 12 mothers at fac-a (3 missed), 3 mothers at fac-b (small group)
    for (let i = 1; i <= 12; i++) await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status,facility_uuid) VALUES($1,16,CURRENT_DATE - 10,$2,'fac-a')", [i, i <= 3 ? 'confirmed' : 'completed']);
    for (let i = 13; i <= 15; i++) await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status,facility_uuid) VALUES($1,17,CURRENT_DATE - 10,'confirmed','fac-b')", [i]);
    await pool.query("INSERT INTO facilities(facility_code,name,facility_type,address,city,district,state,pincode) VALUES('F1','SYNTHETIC District Hospital','hospital','x','Delhi','Central','Delhi','110001')");
    const fid = (await pool.query("SELECT id FROM facilities WHERE facility_code='F1'")).rows[0].id;
    for (let i = 1; i <= 12; i++) await pool.query("INSERT INTO facility_referrals(user_id,to_facility_id,referral_reason,status,created_at,completed_at) VALUES($1,$2,'x',$3,NOW() - INTERVAL '30 days',NOW() - INTERVAL '27 days')", [i, fid, i <= 9 ? 'completed' : 'pending']);
    for (let i = 1; i <= 12; i++) {
      const id = (await pool.query("INSERT INTO missed_care_items(mother_id,item_type,title,due_date,created_at) VALUES($1,'appointment','x',CURRENT_DATE - 20, NOW() - INTERVAL '20 days') RETURNING id", [i])).rows[0].id;
      if (i <= 10) await pool.query("INSERT INTO outreach_attempts(missed_care_id,attempt_type,outcome,attempt_date) VALUES($1,'call','reached',NOW() - INTERVAL '17 days')", [id]);
    }
    const app = express(); app.use(express.json());
    const authenticateToken = (req, res, next) => { const id = Number(req.headers['x-user']); if (!id) return res.sendStatus(401); req.user = { id, role: id >= 16 ? 'doctor' : 'mother' }; next(); };
    const authorizeRole = (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
    require('./privacyAnalytics')(app, { pool, authenticateToken, authorizeRole });
    require('./visitSummary')(app, { pool, authenticateToken, authorizeRole });
    server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = 'http://127.0.0.1:' + server.address().port;
    const call = async (url, user, method = 'GET', body) => { const r = await fetch(base + url, { method, headers: { 'x-user': String(user), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };

    const missed = await call('/api/analytics/report?metric=missed_visits&window=90', 16);
    assert.equal(missed.status, 200);
    assert.equal(missed.data.rows.find((r) => r.label === 'Alpha Clinic').rate_text, '25%');
    assert.equal(missed.data.rows.filter((r) => r.suppressed).length, 1);                              // fac-b has 3 people
    const ref = await call('/api/analytics/report?metric=referral_completion&group_by=area&window=90', 16);
    assert.equal(ref.data.rows[0].rate_text, '75%'); assert.equal(ref.data.rows[0].median_days, 3);
    const fu = await call('/api/analytics/report?metric=time_to_follow_up&window=90', 16);
    assert.ok(fu.data.rows.some((r) => !r.suppressed && r.median_days === 3));
    assert.equal((await call('/api/analytics/report', 1)).status, 403);
    assert.ok(Number((await pool.query("SELECT COUNT(*) AS n FROM analytics_access_log")).rows[0].n) >= 3);

    // O: summary flow against real SQL
    const apptId = (await pool.query("SELECT id FROM appointments WHERE mother_id=1")).rows[0].id;
    const content = { summary_text: 'All is well.', next_steps: ['Drink water'], follow_up: { text: 'Return', due_date: '2099-01-01' }, pending_tests: [{ name: 'Blood test' }] };
    assert.equal((await call('/api/doctor/visit-summaries/' + apptId, 16, 'PUT', content)).status, 200);
    assert.equal((await call('/api/doctor/visit-summaries/' + apptId, 16, 'PUT', { ...content, summary_text: 'Edited draft.' })).status, 200);   // updates the same draft
    assert.equal((await call('/api/patient/visit-summaries', 1)).data.summaries.length, 0);
    assert.equal((await call('/api/doctor/visit-summaries/' + apptId + '/approve', 16, 'POST')).status, 200);
    assert.equal((await call('/api/patient/visit-summaries', 1)).data.summaries[0].summary_text, 'Edited draft.');
    await call('/api/doctor/visit-summaries/' + apptId, 16, 'PUT', { ...content, summary_text: 'Second version.' });
    assert.equal((await call('/api/doctor/visit-summaries/' + apptId + '/approve', 16, 'POST')).status, 200);
    const rows = (await pool.query("SELECT version,status FROM visit_summaries WHERE appointment_id=$1 ORDER BY version", [apptId])).rows;
    assert.deepEqual(rows.map((r) => r.status), ['superseded', 'approved']);
  } finally { server?.close(); await pool.end(); await fs.rm(dir, { recursive: true, force: true }); }
});
