'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs'),{seedHostedNivara}=require('../scripts/seed-hosted-nivara.cjs');
test('hosted fictional persona is consistent across portals and never resets later edits or revoked sharing',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-hosted-persona-')),db=createLocalPool(path.join(dir,'db')),portal=new DatabaseSync(':memory:');
 try{
  for(const file of migrations)await db.query(await fs.readFile(path.join(__dirname,'db',file),'utf8'));
  await db.query('CREATE TABLE dai_local_seed(version TEXT PRIMARY KEY,source_sha256 TEXT,counts JSONB)');
  await db.query('CREATE TABLE dai_local_source_link(entity TEXT,source_id TEXT,portal_uuid TEXT,target_id INTEGER)');
  const add=async(email,role)=>(await db.query("INSERT INTO users(email,password_hash,role) VALUES($1,'fictional',$2) RETURNING id",[email,role])).rows[0].id;
  const mother=await add('mother@dai-synthetic.invalid','mother'),doctor=await add('doctor@dai-synthetic.invalid','doctor');
  await db.query("INSERT INTO mother_profiles(user_id,full_name,pregnancy_status) VALUES($1,'SYNTHETIC Nivara Sethi','pregnant')",[mother]);
  await db.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number) VALUES($1,'SYNTHETIC Hemangini Batra','OBG','SYNTHETIC')",[doctor]);
  await db.query("INSERT INTO dai_local_source_link VALUES('mother','MOTHER-SYN-0000001','mother-link',$1),('doctor','DOCTOR-SYN','doctor-link',$2)",[mother,doctor]);
  await db.query("INSERT INTO children(mother_id,name,date_of_birth,sex,notes) VALUES($1,'CHILD-SYN-0000001','2026-06-29','female','Synthetic source CHILD-SYN-0000001'),($1,'CHILD-SYN-0000002','2026-06-29','male','Synthetic source CHILD-SYN-0000002')",[mother]);
  portal.exec(`CREATE TABLE patient(id TEXT,name TEXT);INSERT INTO patient VALUES('patient-link','Old mother'),('child1','Old child 1'),('child2','Old child 2');
   CREATE TABLE mother(id TEXT,source_id TEXT,patient_id TEXT,assigned_doctor_id TEXT,registered_facility_id TEXT,uhid TEXT,abha_id TEXT,edd TEXT,gestation_weeks INTEGER,blood_group TEXT,high_risk_reason_by_clinician TEXT,validated_by TEXT,details TEXT,updated_at TEXT);
   INSERT INTO mother VALUES('mother-link','MOTHER-SYN-0000001','patient-link','doctor-link','facility-link','old',NULL,'2026-07-20',32,NULL,'[]',NULL,'{}',NULL);
   CREATE TABLE child(id TEXT,source_id TEXT,mother_id TEXT,patient_id TEXT,date_of_birth TEXT,birth_weight_g INTEGER,birth_order INTEGER,details TEXT,updated_at TEXT);
   INSERT INTO child VALUES('c1','CHILD-SYN-0000001','mother-link','child1','2026-06-29',2100,1,'{}',NULL),('c2','CHILD-SYN-0000002','mother-link','child2','2026-06-29',2100,2,'{}',NULL);`);
  const opts={backupDir:path.join(dir,'backups'),manifestPath:path.join(dir,'manifest.json')};const seeded=await seedHostedNivara(db,portal,opts);
  assert.equal(seeded.children,1);assert.equal((await db.query('SELECT name FROM children WHERE mother_id=$1',[mother])).rows[0].name,'Aarav Sethi');
  assert.equal(portal.prepare('SELECT COUNT(*) AS n FROM child').get().n,1);
  const manifest=JSON.parse(await fs.readFile(opts.manifestPath,'utf8'));assert.equal(manifest.patient.email,'nivara@dai-synthetic.invalid');assert.equal(manifest.doctor.id,doctor);assert.equal(manifest.facility,'facility-link');
  assert.equal((await db.query('SELECT include_history FROM clinical_dashboard_consent')).rows[0].include_history,true);
  await db.query("UPDATE mother_profiles SET allergies='Edited after deployment' WHERE user_id=$1",[mother]);await db.query('UPDATE clinical_dashboard_consent SET revoked_at=NOW()');
  assert.equal((await seedHostedNivara(db,portal,opts)).alreadySeeded,true);
  assert.equal((await db.query('SELECT allergies FROM mother_profiles WHERE user_id=$1',[mother])).rows[0].allergies,'Edited after deployment');assert.ok((await db.query('SELECT revoked_at FROM clinical_dashboard_consent')).rows[0].revoked_at);
 }finally{portal.close();await db.end();await fs.rm(dir,{recursive:true,force:true});}
});
