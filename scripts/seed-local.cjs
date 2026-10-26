'use strict';
// Imports the SAME deterministic cohort used by Hospital/Admin into the existing patient/doctor schema.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createLocalPool } = require('../backend/localPool');
const bcrypt = require('../backend/node_modules/bcrypt');
const ROOT = path.join(__dirname, '..');
const migrations = ['auth_and_wellness.sql', 'care_timeline_and_appointments.sql', 'mother_dashboard.sql', 'antenatal_profile.sql', 'child_dashboard.sql', 'child_dashboard_v2.sql', 'child_health_v3.sql', 'hospital_platform.sql', 'patient_preferences.sql', 'patient_documents.sql', 'care_extensions_v4.sql', 'facility_discovery.sql', 'referral_continuity.sql', 'patient_experience.sql', 'patient_home.sql', 'patient_continuity.sql', 'access_matching.sql', 'patient_support.sql', 'clinical_dashboard.sql', 'document_intake_offline.sql', 'missed_care_outreach.sql', 'green_hospital_dashboard.sql', 'smart_referral_handoff.sql', 'doctor_operations.sql', 'facility_freshness.sql', 'patient_ml.sql', 'patient_access_controls.sql', 'follow_through.sql', 'privacy_analytics.sql', 'visit_summaries.sql', 'clinical_review_requests.sql'];
// Reference data (Delhi facility directory). Kept apart from `migrations` so tests that build a bare schema stay small.
const directories = ['delhi_directory.sql'];

async function seedLocal() {
  if (process.env.DAI_LOCAL !== 'true' || path.resolve(process.env.DAI_LOCAL_DB_DIR || '') !== path.join(ROOT,'.local/patient-db')) throw new Error('Local seed is restricted to the launcher-managed local database.');
  const pool = createLocalPool(process.env.DAI_LOCAL_DB_DIR);
  const client = await pool.connect();
  let source;
  try {
    await client.query('CREATE TABLE IF NOT EXISTS dai_local_migrations(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ DEFAULT now())');
    for (const name of [...migrations, ...directories]) {
      const sql = fs.readFileSync(path.join(ROOT, 'backend/db', name), 'utf8');
      const sha = crypto.createHash('sha256').update(sql).digest('hex');
      const old = await client.query('SELECT sha256 FROM dai_local_migrations WHERE name=$1', [name]);
      if (old.rows[0]?.sha256 === sha) continue;
      try {
        await client.query(sql);
        await client.query('INSERT INTO dai_local_migrations(name,sha256) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET sha256=EXCLUDED.sha256, applied_at=now()', [name, sha]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name}: ${error.message}`);
      }
    }
    await require('./seed-matching-demo.cjs').seedMatchingDemo(client);
    await require('./seed-delhi-demo.cjs').seedDelhiDemo(client);
    source = new DatabaseSync(path.join(ROOT, '.local/portal.db'), { readOnly: true });
    const manifest = source.prepare('SELECT source_sha256 FROM seed_manifest LIMIT 1').get();
    if (!manifest) throw new Error('Hospital cohort has not been imported. Run npm start from the root.');
    await client.query('CREATE TABLE IF NOT EXISTS dai_local_seed(version TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL, counts JSONB NOT NULL)');
    const previous = await client.query("SELECT * FROM dai_local_seed WHERE version='cohort-v1'");
    if (previous.rows.length) {
      if (previous.rows[0].source_sha256 !== manifest.source_sha256) throw new Error('Synthetic source changed. Existing local edits were preserved; use a separate checkout for a different dataset.');
      console.log('Patient/doctor cohort already imported:', previous.rows[0].counts);
      return;
    }
    const mothers = source.prepare('SELECT m.*,p.name FROM mother m JOIN patient p ON p.id=m.patient_id ORDER BY m.source_id').all();
    const doctors = source.prepare("SELECT u.*, f.name AS facility_name FROM portal_user u JOIN facility f ON f.id=u.facility_id WHERE u.source_id NOT LIKE 'demo:%' ORDER BY u.source_id").all();
    const children = source.prepare('SELECT c.*,p.name FROM child c JOIN patient p ON p.id=c.patient_id ORDER BY c.source_id').all();
    const defaultDoctor = mothers[0].assigned_doctor_id;
    const hash = await bcrypt.hash(process.env.DAI_DEMO_PASSWORD, 10);
    const doctorIds = new Map(), motherIds = new Map();
    await client.query('BEGIN');
    await client.query('CREATE TABLE IF NOT EXISTS dai_local_source_link(entity TEXT NOT NULL, source_id TEXT NOT NULL, portal_uuid TEXT NOT NULL, target_id INTEGER NOT NULL, PRIMARY KEY(entity,source_id))');
    async function account(email, role) {
      const existing = await client.query('SELECT id FROM users WHERE email=$1', [email]);
      if (existing.rows.length) throw new Error(`Reserved synthetic account ${email} already exists outside the seed. No account was overwritten.`);
      return (await client.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id', [email, hash, role])).rows[0].id;
    }
    async function link(entity, row, target) {
      await client.query('INSERT INTO dai_local_source_link VALUES($1,$2,$3,$4)', [entity, row.source_id, row.id, target]);
    }
    for (const d of doctors) {
      const id = await account(d.id === defaultDoctor ? 'doctor@dai-synthetic.invalid' : d.email, 'doctor');
      doctorIds.set(d.id, id);
      const details = JSON.parse(d.details);
      await client.query('INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,facility_name) VALUES($1,$2,$3,$4,$5)', [id,d.name,details.specialty || 'Medical Officer',d.registration_no,d.facility_name]);
      await link('doctor',d,id);
    }
    let appointments = 0, milestones = 0;
    for (const [index,m] of mothers.entries()) {
      const id = await account(index === 0 ? 'mother@dai-synthetic.invalid' : m.source_id.toLowerCase()+'@dai-synthetic.invalid','mother');
      motherIds.set(m.id,id);
      const details = JSON.parse(m.details);
      const lmp = new Date(m.edd+'T00:00:00Z'); lmp.setUTCDate(lmp.getUTCDate()-280);
      const status = /Postpartum|Child-care|Delivered/.test(details.stage) ? 'delivered' : details.stage === 'Preconception' ? 'planning' : 'pregnant';
      await client.query('INSERT INTO mother_profiles(user_id,full_name,care_start_date,address,pregnancy_status,lmp_date,edd_date) VALUES($1,$2,$3,$4,$5,$6,$7)', [id,details.name || m.name,lmp,[details.district,details.state].join(', '),status,lmp,m.edd]);
      await link('mother',m,id);
      const doctor = doctorIds.get(m.assigned_doctor_id);
      if (!doctor) throw new Error('Missing linked doctor: '+m.source_id);
      const date = new Date(lmp); date.setUTCDate(date.getUTCDate()+56);
      await client.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,reason,status) VALUES($1,$2,$3,$4,'confirmed')", [id,doctor,date,'Synthetic cohort: assigned unit follow-up']);
      appointments++;
      // Expected care schedule only; no invented completion or clinical finding.
      for (const [week,title] of [[8,'First antenatal visit'],[20,'Anomaly scan'],[26,'Glucose tolerance test'],[36,'Birth plan & facility readiness']]) {
        const due = new Date(lmp); due.setUTCDate(due.getUTCDate()+7*week);
        await client.query("INSERT INTO care_milestones(mother_id,stage,category,title,due_date,sort_order) VALUES($1,$2,'pregnancy',$3,$4,$5)", [id,week<13?'Trimester 1':week<28?'Trimester 2':'Trimester 3',title,due,week]);
        milestones++;
      }
    }
    for (const c of children) {
      const d = JSON.parse(c.details);
      const result = await client.query('INSERT INTO children(mother_id,name,date_of_birth,sex,born_at_weeks,birth_weight_kg,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [motherIds.get(c.mother_id),c.name,c.date_of_birth,d.sex,Math.round(d.gestational_age),c.birth_weight_g/1000,`Synthetic birth order ${c.birth_order}; source ${c.source_id}`]);
      await link('child',c,result.rows[0].id);
    }
    const counts = {mothers:mothers.length,doctors:doctors.length,children:children.length,appointments,milestones};
    await client.query("INSERT INTO dai_local_seed VALUES('cohort-v1',$1,$2)",[manifest.source_sha256,JSON.stringify(counts)]);
    await client.query('COMMIT');
    console.log('Imported shared synthetic patient/doctor cohort:',counts);
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {
    source?.close();
    client.release();
    await pool.end();
  }
}
if (require.main === module) seedLocal().catch(error=>{ console.error(error.message); process.exitCode=1; });
module.exports = { seedLocal, migrations, directories };
