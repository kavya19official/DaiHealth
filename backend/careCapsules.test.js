'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { PNG } = require('pngjs');
const scan = require('../frontend/vendor/qr/jsQR');
const { register, signingKeys, signCapsule } = require('./careCapsules');

test('signed capsules verify offline across rotation and reject tampering, expiry and revocation', async () => {
  const { verifyCapsule } = await import('../frontend/care-capsule/verify-data.js');
  const seed = () => randomBytes(32).toString('base64url');
  const oldSeed = seed();
  const [old] = signingKeys({ DAI_CARE_CAPSULE_KEYS: oldSeed });
  const rotated = signingKeys({ DAI_CARE_CAPSULE_KEYS: seed() + ',' + oldSeed });
  const trust = { keys: rotated.map(({ kid, jwk }) => ({ kid, jwk })), revoked: [] };
  const payload = { v: 1, id: '11111111-1111-4111-8111-111111111111', subject: 'mother',
    iat: 100, exp: 200, fields: { blood_group: 'A+', pregnancy_week: 0 } };
  const code = signCapsule(payload, old);
  assert.notEqual(rotated[0].kid, old.kid);
  assert.deepEqual(await verifyCapsule(code, trust, 150), payload);
  assert.deepEqual(await verifyCapsule(signCapsule(payload, rotated[0]), trust, 150), payload);
  const parts = code.split('.');
  parts[2] = (parts[2].startsWith('A') ? 'B' : 'A') + parts[2].slice(1);
  await assert.rejects(verifyCapsule(parts.join('.'), trust, 150), /Signature verification failed/);
  await assert.rejects(verifyCapsule(code, trust, 200), /Expired/);
  await assert.rejects(verifyCapsule(code, { ...trust, revoked: [payload.id] }, 150), /Revoked/);
});

test('only mother-selected fields are carried by the QR and revocation sync is public', async () => {
  const { capsuleCode, verifyCapsule } = await import('../frontend/care-capsule/verify-data.js');
  const pool = new PGlite();
  let server;
  try {
    await pool.exec(`
      CREATE TABLE users (id int PRIMARY KEY, closed_at timestamp);
      CREATE TABLE mother_profiles (user_id int, full_name text, date_of_birth date, blood_group text, allergies text, pregnancy_status text,
        lmp_date date, care_start_date date, edd_date date, risk_level text, risk_factors jsonb, medical_conditions text, current_medications text, previous_complications text);
      CREATE TABLE appointments (id int, mother_id int, child_id int, reason text, requested_date date, status text);
      CREATE TABLE clinical_dashboard_entries (id int, mother_id int, recorded_on date, values_json jsonb);
      CREATE TABLE child_health_events (id int, child_id int, title text, event_date date, event_type text);
      CREATE TABLE children (id int, mother_id int, name text, blood_group text, allergies text, date_of_birth date);
      CREATE TABLE child_vaccinations (child_id int, vaccine_code text, given_on date);
      INSERT INTO users VALUES (1,NULL),(2,NULL);
      INSERT INTO mother_profiles VALUES (1,'Demo mother','2000-11-16','A+','Synthetic allergy','pregnant',CURRENT_DATE-70,NULL,CURRENT_DATE+210,
        'Synthetic risk','[{"label":"Synthetic factor"}]','Synthetic condition','Synthetic medicine','Past complication');
      INSERT INTO children VALUES (11,1,'Demo infant','B+','  Latex / लेटेक्स  ',CURRENT_DATE),(12,2,'Other child',NULL,NULL,CURRENT_DATE);
      INSERT INTO child_vaccinations VALUES (11,'BCG',CURRENT_DATE);
      INSERT INTO appointments VALUES (1,1,NULL,'Maternal checkup',CURRENT_DATE,'completed'),
        (2,1,11,'Child checkup',CURRENT_DATE,'completed'),(3,1,NULL,'Pending visit',CURRENT_DATE,'pending');
      INSERT INTO clinical_dashboard_entries VALUES (1,1,CURRENT_DATE,'{"bp_systolic":118,"bp_diastolic":76,"hb":11.2}'),
        (2,2,CURRENT_DATE,'{"weight_kg":70}');
      INSERT INTO child_health_events VALUES (1,11,'Recorded checkup',CURRENT_DATE,'checkup');
    `);
    await pool.exec(await fs.readFile(path.join(__dirname, 'db/care_capsules.sql'), 'utf8'));
    const app = express();
    app.use(express.json());
    register(app, {
      pool, env: { DAI_CARE_CAPSULE_KEYS: randomBytes(32).toString('base64url') },
      authenticateToken(req, res, next) {
        if (!req.headers['x-fixture-user']) return res.sendStatus(401);
        req.user = { id: Number(req.headers['x-fixture-user']), role: req.get('x-fixture-role') || 'mother' };
        next();
      },
      authorizeRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403)
    });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = 'http://127.0.0.1:' + server.address().port;
    const issue = '/api/patient/care-capsules';
    async function call(url, { actor = 1, role = 'mother', method = 'GET', body } = {}) {
      const headers = { Origin: base, 'Content-Type': 'application/json' };
      if (actor) headers['x-fixture-user'] = String(actor);
      headers['x-fixture-role'] = role;
      const response = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
      return { status: response.status, data: await response.json().catch(() => null) };
    }
    const mint = body => call(issue, { method: 'POST', body: { confirmed: true, days: 7, ...body } });
    assert.equal((await call(issue, { actor: null })).status, 401);
    assert.equal((await call(issue, { role: 'doctor' })).status, 403);
    assert.equal((await call(issue + '/fields', { role: 'doctor' })).status, 403);
    assert.equal((await call(issue, { role: 'doctor', method: 'POST',
      body: { confirmed: true, days: 7, fields: { blood_group: 'A+' } } })).status, 403);
    assert.equal((await call(issue)).status, 200);
    assert.equal((await call(issue + '/fields?child_id=12')).status, 404);
    assert.equal((await mint({ fields: { allergies: 'stale' } })).status, 409);
    assert.equal((await mint({ fields: { name: 'Patient' } })).status, 400);
    const created = await mint({ fields: { blood_group: 'A+' } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const png = PNG.sync.read(Buffer.from(created.data.qr.split(',')[1], 'base64'));
    const qr = scan(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.equal(new URL(qr.data).pathname, '/care-capsule/index.html');
    const code = capsuleCode(qr.data);
    const trust = () => call('/api/care-capsule/trust', { actor: null });
    const snapshot = (await trust()).data;
    assert.deepEqual((await verifyCapsule(code, snapshot)).fields, { blood_group: 'A+' });
    assert.equal((await call(issue + '/' + created.data.id, { actor: 2, method: 'DELETE' })).status, 404);
    assert.equal((await call(issue + '/' + created.data.id, { method: 'DELETE' })).status, 200);
    assert.deepEqual((await verifyCapsule(code, snapshot)).fields, { blood_group: 'A+' });
    await assert.rejects(verifyCapsule(code, (await trust()).data), /Revoked/);
    const motherFields = (await call(issue + '/fields')).data.fields;
    assert.equal(motherFields.patient_name, 'Demo mother');
    assert.equal(motherFields.medical_conditions, 'Synthetic condition');
    assert.equal(motherFields.current_medications, 'Synthetic medicine');
    assert.equal(motherFields.previous_complications, 'Past complication');
    assert.equal(motherFields.date_of_birth, '2000-11-16');
    assert.deepEqual(motherFields.recent_visits.map(visit => visit.title), ['Maternal checkup']);
    assert.deepEqual(motherFields.latest_measurements.map(entry => [entry.metric,entry.value]), [['bp',[118,76]],['hb',11.2]]);
    const expanded = await mint({ fields: { latest_measurements: motherFields.latest_measurements,
      recent_visits: motherFields.recent_visits, previous_complications: motherFields.previous_complications } });
    assert.equal(expanded.status, 201, JSON.stringify(expanded.data));
    const expandedPng = PNG.sync.read(Buffer.from(expanded.data.qr.split(',')[1], 'base64'));
    const expandedCode = capsuleCode(scan(new Uint8ClampedArray(expandedPng.data), expandedPng.width, expandedPng.height).data);
    const expandedFields = (await verifyCapsule(expandedCode, snapshot)).fields;
    assert.deepEqual(expandedFields.latest_measurements, motherFields.latest_measurements);
    assert.equal(expandedFields.patient_name, undefined);
    assert.match(motherFields.expected_delivery, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await mint({ fields: { recent_child_history: [] } })).status, 400);
    const childFields = (await call(issue + '/fields?child_id=11')).data.fields;
    assert.deepEqual(childFields.recent_visits.map(visit => visit.title), ['Child checkup']);
    assert.equal(childFields.latest_measurements, undefined);
    const child = await mint({ child_id: 11, fields: { vaccines: childFields.vaccines, allergies: childFields.allergies,
      patient_name: childFields.patient_name, recent_child_history: childFields.recent_child_history } });
    assert.equal(child.status, 201, JSON.stringify(child.data));
    const childPng = PNG.sync.read(Buffer.from(child.data.qr.split(',')[1], 'base64'));
    const childCode = capsuleCode(scan(new Uint8ClampedArray(childPng.data), childPng.width, childPng.height).data);
    const childCapsule = await verifyCapsule(childCode, snapshot);
    assert.equal(childCapsule.fields.allergies, '  Latex / लेटेक्स  ');
    assert.equal(childCapsule.fields.vaccines[0].code, 'BCG');
    assert.equal(childCapsule.fields.patient_name, 'Demo infant');
    assert.equal(childCapsule.fields.recent_child_history[0].title, 'Recorded checkup');
    assert.equal(childCapsule.fields.blood_group, undefined);

  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.close();
  }
});
