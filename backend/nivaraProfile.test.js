'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createLocalPool}=require('./localPool');
const {migrations}=require('../scripts/seed-local.cjs');
const {seedNivaraProfile}=require('../scripts/seed-nivara-profile.cjs');
const F=require('../scripts/fixtures/nivara-profile.cjs'),M=require('../frontend/js/patient-model');

test('a prior delivery stays historical during a new pregnancy; a new delivery still opens recovery',()=>{
 const user={pregnancy_status:'pregnant',lmp_date:F.lmp,edd_date:F.edd};
 const stage=M.stage(user,{active:true,delivery:{date:F.previousBirth}},[],'2026-11-25');
 assert.equal(stage.delivered,false);assert.equal(stage.week,28);assert.equal(stage.edd,F.edd);
 assert.equal(M.days('2026-11-25',F.lmp)%7,2);
 assert.equal(M.stage(user,{active:true,delivery:{date:'2027-02-15'}},[],'2027-02-20').delivered,true);
});

test('explicit fictional profile edit connects both portals and preserves other patients and permissions',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-nivara-')),db=createLocalPool(path.join(dir,'db'));
 const portal=new DatabaseSync(':memory:');
 try {
  for(const file of migrations)await db.query(await fs.readFile(path.join(__dirname,'db',file),'utf8'));
  const add=async(email,role)=>(await db.query('INSERT INTO users(email,password_hash,role) VALUES($1,\'fake\',$2) RETURNING id',[email,role])).rows[0].id;
  const mother=await add('mother@dai-synthetic.invalid','mother'),other=await add('other@dai-synthetic.invalid','mother'),doctor=await add('doctor@dai-synthetic.invalid','doctor');
  await db.query("INSERT INTO mother_profiles(user_id,full_name,pregnancy_status) VALUES($1,'SYNTHETIC Nivara Sethi','delivered'),($2,'Other patient','planning')",[mother,other]);
  await db.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number) VALUES($1,'SYNTHETIC Hemangini Batra','OBG','SYNTHETIC-ONLY')",[doctor]);
  await db.query('CREATE TABLE dai_local_source_link(entity TEXT,source_id TEXT,portal_uuid TEXT,target_id INTEGER)');
  await db.query("INSERT INTO dai_local_source_link VALUES('mother',$1,'mother-link',$2),('doctor','DOCTOR-FAKE','doctor-link',$3)",[F.sourceId,mother,doctor]);
  portal.exec(`CREATE TABLE mother(id TEXT,source_id TEXT,patient_id TEXT,assigned_doctor_id TEXT,uhid TEXT,abha_id TEXT,edd TEXT,gestation_weeks INTEGER,blood_group TEXT,high_risk_reason_by_clinician TEXT,validated_by TEXT,details TEXT,updated_at TEXT);
    CREATE TABLE patient(id TEXT,name TEXT);
    INSERT INTO patient VALUES('patient-link','Old name');
    INSERT INTO mother VALUES('mother-link','MOTHER-SYN-0000001','patient-link','doctor-link','old-id',NULL,'2026-07-20',37,NULL,'["twins"]',NULL,'{}',NULL);`);
  await assert.rejects(()=>seedNivaraProfile(db,portal),/restricted/);
  const result=await seedNivaraProfile(db,portal,{local:true});assert.equal(result.motherId,mother);
  const p=(await db.query('SELECT * FROM mother_profiles WHERE user_id=$1',[mother])).rows[0];
  assert.equal(p.pregnancy_status,'pregnant');assert.equal(p.full_name,F.name);assert.equal(p.gravida,2);assert.equal(p.parity,1);assert.equal(p.blood_group,'B+');
  assert.equal(new Date(p.lmp_date).toISOString().slice(0,10),F.lmp);assert.equal(new Date(p.edd_date).toISOString().slice(0,10),F.edd);
  const context=(await db.query('SELECT * FROM pregnancy_care_context WHERE mother_id=$1',[mother])).rows[0];
  assert.equal(context.updated_by,doctor);assert.equal(context.record.plurality,'single');assert.equal(context.record.conditions.anaemia,'yes');assert.equal(context.record.conditions.hypertension,'no');assert.equal(context.record.plan_approved,false);assert.deepEqual(context.record.thresholds,[]);
  const mirror=portal.prepare('SELECT * FROM mother').get();assert.equal(mirror.uhid,F.recordId);assert.equal(mirror.abha_id,null);assert.equal(mirror.edd,F.edd);assert.ok(!mirror.high_risk_reason_by_clinician.includes('twins'));
  assert.equal((await db.query('SELECT email FROM users WHERE id=$1',[mother])).rows[0].email,F.email);
  assert.equal((await db.query('SELECT full_name FROM mother_profiles WHERE user_id=$1',[other])).rows[0].full_name,'Other patient');
  assert.equal((await db.query('SELECT * FROM clinical_dashboard_consent')).rows.length,0);
  await seedNivaraProfile(db,portal,{local:true});assert.equal((await db.query('SELECT * FROM pregnancy_care_context')).rows.length,1);
 }finally{portal.close();await db.end();await fs.rm(dir,{recursive:true,force:true});}
});
