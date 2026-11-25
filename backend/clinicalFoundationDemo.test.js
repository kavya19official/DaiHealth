'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const bcrypt = require('./node_modules/bcrypt');
const { createLocalPool } = require('./localPool');
const { migrations } = require('../scripts/seed-local.cjs');
const { seedClinicalFoundationDemo, DOCTORS, PATIENTS, VERSION } = require('../scripts/seed-clinical-foundation-demo.cjs');

const root = path.join(__dirname, '..');

test('clinical demo cohort is connected, consent-scoped, persistent and idempotent', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dai-clinical-demo-'));
  const manifestFile = path.join(directory, 'ultrasound-manifest.json');
  const pool = createLocalPool(directory);
  const previousLocal = process.env.DAI_LOCAL;
  const previousPortal = process.env.DAI_PORTAL_DB;
  process.env.DAI_LOCAL = 'true';
  process.env.DAI_PORTAL_DB = path.join(directory, 'missing-portal.db');
  let server;
  try {
    for (const name of migrations) await pool.query(fs.readFileSync(path.join(root, 'backend/db', name), 'utf8'));
    await pool.query("SET TIME ZONE 'Asia/Kolkata'");
    await pool.query('CREATE TABLE IF NOT EXISTS dai_local_seed(version TEXT PRIMARY KEY,source_sha256 TEXT NOT NULL,counts JSONB NOT NULL)');
    const result = await seedClinicalFoundationDemo(pool, { date: '2026-11-25', password: 'Synthetic-test-password!', manifestFile });
    assert.equal(result.alreadySeeded, false);
    assert.equal(result.counts.patients, 12);
    assert.equal(result.counts.doctors, 4);
    assert.equal(result.counts.anc_visits, 60);
    assert.ok(result.counts.observations >= 48);
    assert.ok(result.counts.investigations >= 60);
    assert.ok(!JSON.stringify(result.manifest).includes('Synthetic-test-password'));

    const users = (await pool.query("SELECT id,email,password_hash,role FROM users WHERE email LIKE 'synthetic.%@dai-synthetic.invalid'")).rows;
    assert.equal(users.length, 16);
    for (const user of users) assert.equal(await bcrypt.compare('Synthetic-test-password!', user.password_hash), true);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM mother_profiles WHERE data_label='Synthetic'")).rows[0].n, 12);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM doctor_profiles WHERE data_label='Synthetic' AND credential_verified")).rows[0].n, 4);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM anc_visits')).rows[0].n, 60);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM visit_summaries WHERE status=\'approved\'')).rows[0].n, result.counts.consultations);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM clinical_investigations WHERE status='awaiting_result' AND value_numeric IS NULL AND value_text IS NULL AND resulted_on IS NULL")).rows[0].n, 3);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM clinical_investigations WHERE status='recorded' AND value_numeric IS NOT NULL AND unit IS NULL")).rows[0].n, 0);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM clinical_dashboard_consent WHERE include_history AND revoked_at IS NULL')).rows[0].n, 12);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM clinical_dashboard_entries e JOIN anc_visits v ON v.appointment_id=e.appointment_id WHERE v.status=\'completed\'')).rows[0].n, result.counts.consultations);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM health_logs WHERE log_type='kick_session' AND data->>'data_label'='Synthetic'")).rows[0].n, 1);

    for (const doctor of DOCTORS) {
      const row = (await pool.query('SELECT id FROM users WHERE email=$1', [doctor.email])).rows[0];
      const assigned = (await pool.query('SELECT COUNT(DISTINCT mother_id)::int AS n FROM appointments WHERE doctor_id=$1', [row.id])).rows[0].n;
      assert.equal(assigned, 3, doctor.name);
    }
    for (const patient of PATIENTS) {
      const row = (await pool.query('SELECT id FROM users WHERE email=$1', [patient.email])).rows[0];
      const visits = (await pool.query('SELECT COUNT(*)::int AS n FROM anc_visits WHERE mother_id=$1', [row.id])).rows[0].n;
      assert.equal(visits, 5, patient.name);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM clinical_investigations WHERE mother_id=$1', [row.id])).rows[0].n >= 5, true, patient.name);
    }

    const ritu = (await pool.query("SELECT id FROM users WHERE email='synthetic.ritu.sen@dai-synthetic.invalid'")).rows[0].id;
    const sana = (await pool.query("SELECT id FROM users WHERE email='synthetic.sana.qureshi@dai-synthetic.invalid'")).rows[0].id;
    const aditi = (await pool.query("SELECT id FROM users WHERE email=$1", [DOCTORS[0].email])).rows[0].id;
    const rohan = (await pool.query('SELECT id FROM users WHERE email=$1', [DOCTORS[1].email])).rows[0].id;
    const { readClinicalRecords } = require('./clinicalRecords');
    const rituRecords = await readClinicalRecords(pool, ritu);
    assert.equal(rituRecords.investigations.filter(lab => lab.status === 'awaiting_result').length, 3);
    assert.ok(rituRecords.investigations.every(lab => lab.status !== 'awaiting_result' || lab.value_numeric === null));
    assert.equal((await readClinicalRecords(pool, sana)).data_label, 'Synthetic');

    const { catalogue } = require('./patientContinuity');
    const options = await catalogue(pool, sana);
    assert.equal(options.doctors.length, 4);
    assert.ok(options.doctors.every(doctor => doctor.qualifications && doctor.availability_status && doctor.data_label === 'Synthetic'));
    assert.equal(options.doctors.find(doctor => doctor.id === aditi).assigned, true);
    assert.equal(options.doctors.find(doctor => doctor.id === aditi).booking_supported, true);

    const app = express();
    app.use(express.json());
    const dependencies = {
      pool,
      authenticateToken: (req, res, next) => {
        const id = Number(req.headers['x-user']);
        if (!id) return res.sendStatus(401);
        req.user = { id };
        next();
      },
      authorizeRole: roles => (req, res, next) => {
        const role = req.headers['x-role'];
        return roles.includes(role) ? next() : res.sendStatus(403);
      },
    };
    require('./clinicalDashboard')(app, dependencies);
    require('./patientContinuity')(app, dependencies);
    require('./doctorWorkspace')(app, dependencies);
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const get = route => fetch(origin + route, { headers: { 'x-user': String(aditi), 'x-role': 'doctor' } });
    const workspace = await get('/api/doctor/workspace');
    assert.equal(workspace.status, 200);
    const workspaceData = await workspace.json();
    assert.equal(workspaceData.patients.length, 3);
    assert.equal(workspaceData.label, 'Synthetic');
    assert.equal(workspaceData.doctor.qualifications, DOCTORS[0].qualifications);
    assert.ok(workspaceData.patients.every(patient => patient.age !== null && patient.data_label === 'Synthetic'));
    const shared = await get(`/api/doctor/patients/${sana}/dashboard`);
    assert.equal(shared.status, 200);
    const sharedData = await shared.json();
    assert.equal(sharedData.sharing.include_history, true);
    assert.ok(sharedData.history.anc_visits.length >= 5);
    assert.ok(sharedData.history.investigations.length >= 5);
    assert.ok(sharedData.metrics.find(metric => metric.key === 'haemoglobin').readings.length >= 2);
    const denied = await fetch(origin + `/api/doctor/patients/${sana}/dashboard`, { headers: { 'x-user': String(rohan), 'x-role': 'doctor' } });
    assert.equal(denied.status, 403);
    const patientDashboard = await fetch(origin + '/api/patient/dashboard', { headers: { 'x-user': String(ritu), 'x-role': 'mother' } });
    assert.equal(patientDashboard.status, 200);
    assert.equal((await patientDashboard.json()).label, 'Synthetic');

    const rerun = await seedClinicalFoundationDemo(pool, { date: '2026-11-26', password: 'Different-password!', manifestFile });
    assert.equal(rerun.alreadySeeded, true);
    assert.deepEqual(rerun.counts, result.counts);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n, 16);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM anc_visits')).rows[0].n, 60);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assert.equal(manifest.as_of_date, '2026-11-25');
    assert.equal(manifest.patients.length, 12);
    assert.equal(manifest.patients.flatMap(patient => patient.scans).length, 3);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM dai_local_seed WHERE version=$1', [VERSION])).rows[0].n, 1);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    if (previousLocal === undefined) delete process.env.DAI_LOCAL; else process.env.DAI_LOCAL = previousLocal;
    if (previousPortal === undefined) delete process.env.DAI_PORTAL_DB; else process.env.DAI_PORTAL_DB = previousPortal;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
