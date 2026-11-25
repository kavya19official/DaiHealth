'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createLocalPool } = require('./localPool');

const root = path.join(__dirname, '..');
const { migrations, directories } = require('../scripts/seed-local.cjs');
const checker = require('../scripts/check-local.cjs');

test('local setup and validation share one migration list', () => {
  assert.deepStrictEqual(checker.migrations, migrations);
  assert.deepStrictEqual(checker.directories, directories);
});

test('seed-local.cjs applies every SQL file in backend/db', () => {
  const applied = new Set([...migrations, ...directories]);
  const onDisk = fs.readdirSync(path.join(root, 'backend/db')).filter((f) => f.endsWith('.sql'));
  const missing = onDisk.filter((f) => !applied.has(f));
  assert.deepStrictEqual(missing, [], `Not applied by scripts/seed-local.cjs: ${missing.join(', ')}`);
});

test('clinical foundation is additive, linked, idempotent and enforces result states', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dai-clinical-foundation-'));
  const pool = createLocalPool(directory);
  const sql = (name) => fs.readFileSync(path.join(root, 'backend/db', name), 'utf8');
  try {
    for (const name of ['auth_and_wellness.sql', 'care_timeline_and_appointments.sql', 'clinical_dashboard.sql']) {
      await pool.query(sql(name));
    }
    await pool.query(sql('clinical_data_foundation.sql'));
    await pool.query(sql('clinical_data_foundation.sql'));
    const mother = (await pool.query("INSERT INTO users(email,password_hash,role) VALUES('mother@example.invalid','x','mother') RETURNING id")).rows[0].id;
    const doctor = (await pool.query("INSERT INTO users(email,password_hash,role) VALUES('doctor@example.invalid','x','doctor') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO mother_profiles(user_id,full_name,obstetric_history,data_label) VALUES($1,'Example','G1 P0','Synthetic')", [mother]);
    await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,qualifications,data_label) VALUES($1,'Example','Obstetrics','DEMO','MBBS, MD','Synthetic')", [doctor]);
    const appointment = (await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,'2026-11-20','completed') RETURNING id", [mother, doctor])).rows[0].id;
    await pool.query("INSERT INTO clinical_dashboard_entries(mother_id,doctor_id,recorded_on,source_kind,values_json,appointment_id,observed_at,source_record_id,measurement_status,record_key) VALUES($1,$2,'2026-11-20','clinic_visit','{\"bp_systolic\":120,\"bp_diastolic\":80}',$3,'2026-11-20T10:00:00Z','synthetic:obs:1','recorded','synthetic:obs:1')", [mother, doctor, appointment]);
    await pool.query("INSERT INTO anc_visits(mother_id,appointment_id,doctor_id,visit_date,gestational_week,status,source_record_id,record_key,data_label) VALUES($1,$2,$3,'2026-11-20',28,'completed','synthetic:visit:1','synthetic:visit:1','Synthetic')", [mother, appointment, doctor]);
    await pool.query("INSERT INTO clinical_investigations(mother_id,appointment_id,panel_code,test_code,test_name,value_numeric,unit,reference_low,reference_high,collected_on,resulted_on,source_type,source_record_id,record_key,data_label) VALUES($1,$2,'cbc','haemoglobin','Haemoglobin',11.2,'g/dL',11,16,'2026-11-20','2026-11-20','synthetic_lab','synthetic:lab:1','synthetic:lab:1','Synthetic')", [mother, appointment]);
    await assert.rejects(pool.query("INSERT INTO clinical_investigations(mother_id,panel_code,test_code,test_name,status,source_type,source_record_id,record_key) VALUES($1,'cbc','platelets','Platelets','recorded','synthetic_lab','synthetic:lab:2','synthetic:lab:2')", [mother]), /clinical_investigations_check/);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM anc_visits')).rows[0].count, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM clinical_investigations')).rows[0].count, 1);
    assert.equal((await pool.query("SELECT data_label FROM mother_profiles WHERE user_id=$1", [mother])).rows[0].data_label, 'Synthetic');
  } finally {
    await pool.end();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
