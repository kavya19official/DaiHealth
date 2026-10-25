'use strict';
// O. Clinician-approved visit summary: input rules and the HTTP authorisation rules, without a database.
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express');
const V = require('./visitSummary'), PL = require('../shared/plain-language');

test('only text the clinician typed is stored, trimmed, limited and free of control characters', () => {
  const s = V.sanitize({ summary_text: '  Baby is growing well.\u0007 ', next_steps: ['  Drink water ', '', 'Rest'], follow_up: { text: 'Come back', due_date: '2030-02-01' },
    pending_tests: [{ name: 'Blood test', note: 'fasting' }, { name: '   ' }] });
  assert.deepEqual(s.content, { summary_text: 'Baby is growing well.', next_steps: ['Drink water', 'Rest'], follow_up: { text: 'Come back', due_date: '2030-02-01' }, pending_tests: [{ name: 'Blood test', note: 'fasting' }] });
  assert.ok(V.sanitize({ next_steps: new Array(9).fill('x') }).error);
  assert.ok(V.sanitize({ follow_up: { due_date: '2030-02-31' } }).error);
  assert.ok(V.sanitize({ pending_tests: [{ name: 'T', due_date: 'tomorrow' }] }).error);
  assert.equal(V.sanitize({ summary_text: 'x'.repeat(5000) }).content.summary_text.length, V.LIMITS.summary);
});

test('an empty summary cannot be approved, and there is no medicine or prescription field to fill', () => {
  assert.equal(V.isEmpty(V.sanitize({}).content), true);
  assert.equal(V.isEmpty(V.sanitize({ pending_tests: [{ name: 'Scan' }] }).content), false);
  const keys = Object.keys(V.sanitize({ summary_text: 'a', medicines: [{ name: 'X', dose: '5 mg' }], prescription: 'X' }).content);
  assert.deepEqual(keys.sort(), ['follow_up', 'next_steps', 'pending_tests', 'summary_text']);   // unknown fields are dropped
});

test('the plain-language checker flags jargon, long sentences and doses but never rewrites', () => {
  const text = 'Your BP shows hypertension. Take 500 mg twice a day. Please come back to the clinic next month and bring every single report you have so we can compare them carefully.';
  const flags = PL.check(text);
  assert.ok(flags.some((f) => f.type === 'jargon' && f.term === 'hypertension' && f.suggestion === 'high blood pressure'));
  assert.ok(flags.some((f) => f.type === 'long_sentence'));
  assert.ok(flags.some((f) => f.type === 'dose'));
  assert.equal(PL.check('Come back in two weeks. Drink plenty of water.').length, 0);
  assert.equal(PL.check('The word handbook is fine').some((f) => f.type === 'jargon'), false);   // no false match inside words (hb, bp, od)
});

function makeApp(db) {
  const approvedFor = (mother) => db.summaries.filter((s) => s.mother_id === mother && s.status === 'approved');
  const client = { async query(sql, params) {
    if (/^BEGIN|^COMMIT|^ROLLBACK/.test(sql)) return { rows: [] };
    if (/FROM visit_summaries WHERE appointment_id=\$1 AND status='draft' FOR UPDATE/.test(sql)) return { rows: db.summaries.filter((s) => s.appointment_id === params[0] && s.status === 'draft') };
    if (/COALESCE\(MAX\(version\),0\)/.test(sql)) return { rows: [{ v: Math.max(0, ...db.summaries.filter((s) => s.appointment_id === params[0]).map((s) => s.version)) + 1 }] };
    if (/SET status='superseded'/.test(sql)) { db.summaries.filter((s) => s.appointment_id === params[0] && s.status === 'approved').forEach((s) => { s.status = 'superseded'; }); return { rows: [] }; }
    if (/SET status='approved'/.test(sql)) { const s = db.summaries.find((x) => x.id === params[0]); Object.assign(s, { status: 'approved', version: params[1], approved_at: new Date().toISOString(), patient_seen_at: null }); return { rows: [s] }; }
    throw new Error('client query: ' + sql.slice(0, 60));
  }, release() {} };
  const pool = { connect: async () => client, async query(sql, params) {
    if (/FROM doctor_profiles WHERE user_id=\$1/.test(sql)) return { rows: [{ medical_license_number: 'X', credential_verified: db.verified.has(params[0]) }] };
    if (/FROM appointments a LEFT JOIN mother_profiles/.test(sql)) { const a = db.appointments.find((x) => x.id === params[0]); return { rows: a ? [a] : [] }; }
    if (/SELECT 1 WHERE EXISTS \(SELECT 1 FROM appointments ra/.test(sql)) return { rows: db.access(params[0], params[1]) ? [{}] : [] };
    if (/INSERT INTO patient_record_access_log/.test(sql)) return { rows: [] };
    if (/INSERT INTO visit_summaries/.test(sql)) {
      let d = db.summaries.find((s) => s.appointment_id === params[0] && s.status === 'draft');
      const next = { summary_text: params[3], next_steps: JSON.parse(params[4]), follow_up: JSON.parse(params[5]), pending_tests: JSON.parse(params[6]) };
      if (d) Object.assign(d, next); else { d = { id: db.summaries.length + 1, appointment_id: params[0], mother_id: params[1], doctor_id: params[2], version: 0, status: 'draft', ...next }; db.summaries.push(d); }
      return { rows: [d] };
    }
    if (/FROM visit_summaries s JOIN appointments a/.test(sql)) return { rows: approvedFor(params[0]).map((s) => ({ ...s, visit_date: '2030-01-01', clinician: 'Dr A' })) };
    if (/FROM appointments a LEFT JOIN doctor_profiles dp ON dp.user_id = a.doctor_id/.test(sql)) return { rows: [] };
    if (/UPDATE visit_summaries SET patient_seen_at/.test(sql)) { const s = db.summaries.find((x) => x.id === params[0] && x.mother_id === params[1] && x.status === 'approved'); if (s) s.patient_seen_at = 'now'; return { rows: s ? [{ id: s.id }] : [] }; }
    throw new Error('pool query: ' + sql.slice(0, 70));
  } };
  const app = express(); app.use(express.json());
  const authenticateToken = (req, res, next) => { const id = Number(req.headers['x-user']); if (!id) return res.sendStatus(401); req.user = { id, role: id >= 10 ? 'doctor' : 'mother' }; next(); };
  const authorizeRole = (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
  require('./visitSummary')(app, { pool, authenticateToken, authorizeRole });
  return app;
}

test('HTTP: a draft is invisible to the patient until the owning clinician approves it, and edits never leak', async () => {
  const db = { verified: new Set([10, 11]), summaries: [], access: (doc) => doc === 10,
    appointments: [{ id: 1, mother_id: 1, doctor_id: 10, status: 'completed', reason: 'ANC', visit_date: '2030-01-01', happened: true, patient_name: 'P' },
                   { id: 2, mother_id: 1, doctor_id: 10, status: 'confirmed', reason: 'Later', visit_date: '2099-01-01', happened: false, patient_name: 'P' }] };
  const app = makeApp(db), server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, user, method = 'GET', body) => { const r = await fetch(base + url, { method, headers: { 'x-user': String(user), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
  try {
    const content = { summary_text: 'Baby is well.', next_steps: ['Drink water'], follow_up: { text: 'Return', due_date: '2030-02-01' }, pending_tests: [{ name: 'Blood test' }] };
    assert.equal((await call('/api/doctor/visit-summaries/1', 1, 'PUT', content)).status, 403);        // a mother cannot write
    assert.equal((await call('/api/doctor/visit-summaries/1', 12, 'PUT', content)).status, 403);       // unverified doctor
    assert.equal((await call('/api/doctor/visit-summaries/1', 11, 'PUT', content)).status, 404);       // not the clinician who saw her
    assert.equal((await call('/api/doctor/visit-summaries/2', 10, 'PUT', content)).status, 409);       // visit has not happened
    assert.equal((await call('/api/doctor/visit-summaries/1/approve', 10, 'POST')).status, 409);       // nothing drafted yet
    const saved = await call('/api/doctor/visit-summaries/1', 10, 'PUT', content);
    assert.equal(saved.status, 200); assert.equal(saved.data.draft.status, 'draft');
    assert.deepEqual((await call('/api/patient/visit-summaries', 1)).data.summaries, []);               // draft is invisible
    db.access = () => false;                                                                             // the mother turns this doctor off
    assert.equal((await call('/api/doctor/visit-summaries/1/approve', 10, 'POST')).status, 403);
    assert.deepEqual((await call('/api/patient/visit-summaries', 1)).data.summaries, []);
    db.access = (doc) => doc === 10;
    assert.equal((await call('/api/doctor/visit-summaries/1/approve', 10, 'POST')).status, 200);
    const seen = (await call('/api/patient/visit-summaries', 1)).data.summaries;
    assert.equal(seen.length, 1); assert.equal(seen[0].version, 1); assert.equal(seen[0].summary_text, 'Baby is well.');
    assert.deepEqual((await call('/api/patient/visit-summaries', 2)).data.summaries, []);               // another mother sees nothing
    // editing creates a new draft; the patient keeps seeing the confirmed version until the new one is approved
    await call('/api/doctor/visit-summaries/1', 10, 'PUT', { ...content, summary_text: 'Changed text.' });
    assert.equal((await call('/api/patient/visit-summaries', 1)).data.summaries[0].summary_text, 'Baby is well.');
    assert.equal((await call('/api/doctor/visit-summaries/1/approve', 10, 'POST')).status, 200);
    const after = (await call('/api/patient/visit-summaries', 1)).data.summaries;
    assert.equal(after.length, 1); assert.equal(after[0].version, 2); assert.equal(after[0].summary_text, 'Changed text.');
    assert.equal((await call('/api/patient/visit-summaries/' + after[0].id + '/seen', 2, 'POST')).status, 404);   // not hers
    assert.equal((await call('/api/patient/visit-summaries/' + after[0].id + '/seen', 1, 'POST')).status, 200);
  } finally { server.close(); }
});
