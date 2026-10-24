'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs'),{seedDoctorActivity}=require('../scripts/seed-doctor-activity.cjs');
test('clinic seed creates linked appointments, real report files and completed events once without restoring revoked consent',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-clinic-seed-')),pool=createLocalPool(path.join(dir,'db'));let client;
 try{
  for(const f of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',f),'utf8'));
  await pool.query('CREATE TABLE dai_local_seed(version TEXT PRIMARY KEY,source_sha256 TEXT,counts JSONB); CREATE TABLE dai_local_source_link(entity TEXT,source_id TEXT,portal_uuid TEXT,target_id INTEGER)');
  const doctor=(await pool.query("INSERT INTO users(email,password_hash,role) VALUES('doctor@test.invalid','fake','doctor') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,facility_name) VALUES($1,'SYNTHETIC Meera','OBG','NMC-FAKE-0001','DAI Test Centre')",[doctor]);
  await pool.query("INSERT INTO dai_local_source_link VALUES('doctor','doc-1','doc-uuid',$1)",[doctor]);
  const mothers=[];
  for(let i=0;i<4;i++){
   const id=(await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'fake','mother') RETURNING id",['mother'+i+'@test.invalid'])).rows[0].id;mothers.push(id);
   await pool.query("INSERT INTO mother_profiles(user_id,full_name,lmp_date,edd_date,pregnancy_status) VALUES($1,$2,'2026-06-01','2027-03-08','pregnant')",[id,'SYNTHETIC Priya '+i]);
   await pool.query("INSERT INTO dai_local_source_link VALUES('mother',$1,$1,$2)",['mother-'+i,id]);
   await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,reason,status) VALUES($1,$2,'2026-07-01','Existing visit','confirmed')",[id,doctor]);
  }
  await pool.query("INSERT INTO clinical_dashboard_consent VALUES($1,$2,'2026-12-01','2026-10-01')",[mothers[0],doctor]);
  const source={prepare(sql){return {get(){if(sql.includes('seed_manifest'))return {source_sha256:'test-source'};if(sql.includes('portal_user'))return {role:'consultant',unit_id:'unit-1'};return {code:'I',room:'ANC-1'};}};}};
  client=await pool.connect();const options={date:'2026-10-24',uploadDir:path.join(dir,'uploads')};
  const counts=await seedDoctorActivity(client,source,options);assert.equal(counts.appointments,16);assert.equal(counts.reports,4);assert.equal(counts.entries,10);
  assert.equal((await client.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n,20);
  assert.ok((await client.query('SELECT revoked_at FROM clinical_dashboard_consent WHERE mother_id=$1',[mothers[0]])).rows[0].revoked_at);
  const docs=(await client.query('SELECT * FROM patient_documents')).rows;
  for(const doc of docs){const bytes=await fs.readFile(path.join(options.uploadDir,doc.storage_key));assert.equal(bytes.length,doc.size_bytes);assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(doc.facility_name,'DAI Test Centre');}
  assert.equal((await client.query('SELECT COUNT(*)::int n FROM care_milestones WHERE completed_at IS NOT NULL AND appointment_id IS NOT NULL')).rows[0].n,10);
  assert.equal((await client.query("SELECT COUNT(*)::int n FROM doctor_queue_state WHERE state='waiting'")).rows[0].n,2);
  assert.deepEqual(await seedDoctorActivity(client,source,options),{alreadySeeded:true});
  assert.equal((await client.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n,20);
 }finally{client?.release();await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
