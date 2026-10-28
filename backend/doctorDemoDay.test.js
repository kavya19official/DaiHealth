'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs'),{seedDoctorDemoDay}=require('../scripts/seed-doctor-demo-day.cjs'),M=require('../frontend/js/doctor-workspace-model');
test('daily synthetic schedule links children and postpartum cases without duplicating visits, restoring access or changing outcomes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doctor-demo-day-')),pool=createLocalPool(dir);let c;
 try{
  for(const f of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',f),'utf8'));
  await pool.query('CREATE TABLE dai_local_seed(version TEXT PRIMARY KEY,source_sha256 TEXT,counts JSONB); CREATE TABLE dai_local_source_link(entity TEXT,source_id TEXT,portal_uuid TEXT,target_id INTEGER)');
  const doc=(await pool.query("INSERT INTO users(email,password_hash,role) VALUES('doctor@dai-synthetic.invalid','unused','doctor') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number) VALUES($1,'Synthetic doctor','OBG','Fixture')",[doc]);await pool.query("INSERT INTO dai_local_source_link VALUES('doctor','doc','doc-uuid',$1)",[doc]);
  const mothers=[];for(let i=0;i<5;i++){
   const id=(await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'unused','mother') RETURNING id",['mother'+i+'@dai-synthetic.invalid'])).rows[0].id;mothers.push(id);
   await pool.query("INSERT INTO mother_profiles(user_id,full_name,care_start_date,pregnancy_status) VALUES($1,$2,'2026-04-01',$3)",[id,'Synthetic mother '+i,i<3?'delivered':'pregnant']);
   await pool.query("INSERT INTO dai_local_source_link VALUES('mother',$1,$1,$2)",['mother-'+i,id]);
   await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,'2026-09-01','completed')",[id,doc]);
   if(i<2)await pool.query("INSERT INTO children(mother_id,name,date_of_birth,sex) VALUES($1,$2,'2026-09-01','female')",[id,'Synthetic child '+i]);
  }
  await pool.query("INSERT INTO patient_access_controls(mother_id,grantee_type,grantee_ref,state) VALUES($1,'doctor',$2,'revoked')",[mothers[4],String(doc)]);
  const source={prepare(sql){return {get(){return sql.includes('seed_manifest')?{source_sha256:'fixture-source'}:sql.includes('portal_user')?{role:'consultant',facility_id:'fixture-facility',unit_id:'fixture-unit'}:{code:'I',room:'Room1'};}};}};
  c=await pool.connect();assert.deepEqual(await seedDoctorDemoDay(c,source,{date:'2026-10-28',local:false}),{disabled:true});
  const counts=await seedDoctorDemoDay(c,source,{date:'2026-10-28',local:true});assert.equal(counts.child_appointments,2);assert.equal(counts.postpartum_appointments,1);assert.equal(counts.appointments,4);
  const first=(await c.query("SELECT * FROM appointments WHERE requested_date='2026-10-28' ORDER BY id")).rows;assert.equal(first.filter(a=>a.child_id).length,2);assert.equal(first.filter(a=>a.mother_id===mothers[4]).length,0);assert.ok(first.every(a=>a.facility_uuid==='fixture-facility'));
  await c.query("UPDATE appointments SET status='cancelled' WHERE id=$1",[first[0].id]);
  assert.deepEqual(await seedDoctorDemoDay(c,source,{date:'2026-10-28',local:true}),{alreadySeeded:true});assert.equal((await c.query('SELECT status FROM appointments WHERE id=$1',[first[0].id])).rows[0].status,'cancelled');
  assert.equal(Number((await c.query('SELECT COUNT(*) n FROM clinical_dashboard_entries')).rows[0].n),0);
  assert.equal(Number((await c.query('SELECT COUNT(*) n FROM clinical_dashboard_consent')).rows[0].n),0);
  const tomorrow=await seedDoctorDemoDay(c,source,{date:'2026-10-29',local:true});assert.equal(tomorrow.child_appointments,2);
  assert.equal(Number((await c.query('SELECT COUNT(*) n FROM doctor_queue_state')).rows[0].n),8);
 }finally{c?.release();await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
test('child date filtering requires an actual non-cancelled child visit in the selected period',()=>{
 const p={id:1,name:'Synthetic mother',has_child_visit:true,stage:{delivered:true},edd:'2026-10-28'};
 const d={date:'2026-10-28',patients:[p],worklist:[],appointments:[{mother_id:1,requested_date:'2026-10-28',status:'confirmed',child_id:null},{mother_id:1,requested_date:'2026-10-27',status:'confirmed',child_id:3}]};
 assert.equal(M.roster(d,{filter:'newborn',period:'day'}).length,0);assert.equal(M.roster(d,{filter:'newborn',period:'all'}).length,1);
 d.appointments.push({mother_id:1,requested_date:'2026-10-28',status:'cancelled',child_id:3});assert.equal(M.roster(d,{filter:'newborn',period:'day'}).length,0);
 d.appointments.push({mother_id:1,requested_date:'2026-10-28',status:'confirmed',child_id:3});assert.equal(M.roster(d,{filter:'newborn',period:'day'}).length,1);
});
