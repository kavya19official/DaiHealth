'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../frontend/js/patient-model');
const {clinicalSnapshot}=require('./patientExperience');
test('pregnancy and postpartum stages use dates without confusing an older child with the current pregnancy',()=>{
 const s=M.stage({lmp_date:'2026-04-24',pregnancy_status:'pregnant'},{},[{date_of_birth:'2023-01-01'}],'2026-10-23');assert.equal(s.week,26);assert.equal(s.edd,'2027-01-29');assert.equal(s.delivered,false);
 const p=M.stage({},{active:true,delivery:{date:'2026-10-11'}},[],'2026-10-23');assert.equal(p.label,'Postpartum, day 12');assert.equal(p.delivered,true);
});
test('care gap ordering is reproducible; completed wins and old ANC does not become current postpartum care',()=>{
 const rows=[{id:1,title:'ANC',due_date:'2026-01-01',status:'completed'},{id:2,title:'Scan',due_date:'2026-10-24'},{id:3,title:'OGTT',due_date:'2026-10-20'},{id:4,title:'PNC review',due_date:'2026-10-21'}];
 assert.deepEqual(M.gaps(rows,{delivered:false},'2026-10-23').map(x=>x.id),[3,4,2]);assert.deepEqual(M.gaps(rows,{delivered:true},'2026-10-23').map(x=>x.id),[4]);assert.equal(M.status({...rows[2],queued:true}),'queued');
});
test('health snapshot ignores unverified and self-entered readings and does not invent glucose',()=>{
 const r=clinicalSnapshot([{doctor_id:2,doctor_verified:false,visit_date:'2026-10-23',weight_kg:75},{doctor_id:2,doctor_verified:true,visit_date:'2026-10-20',weight_kg:67,hb:10.5},{doctor_verified:true,visit_date:'2026-10-22',weight_kg:80}]);assert.equal(r[0].readings.length,1);assert.equal(r[0].readings[0].value,67);assert.equal(r.at(-1).readings.length,0);
});
test('pending appointments in the past remain history, and patient text is escaped',()=>{assert.equal(M.upcoming({status:'pending',requested_date:'2026-10-22'},'2026-10-23'),false);assert.equal(M.escape('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');});

const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express'),bcrypt=require('bcrypt');
const {createLocalPool}=require('./localPool');const {migrations}=require('../scripts/seed-local.cjs');
test('patient controls enforce ownership, validate scheduling, export only own data and record consent without deleting records',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-patient-ui-')),pool=createLocalPool(dir);let server;
 try{
  for(const file of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',file),'utf8'));
  const hash=await bcrypt.hash('Synthetic-Test-Password!',4);const people=[];
  for(const [email,role] of [['one@dai-synthetic.invalid','mother'],['two@dai-synthetic.invalid','mother'],['doc@dai-synthetic.invalid','doctor']])people.push((await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id',[email,hash,role])).rows[0].id);
  const [a,b,doctor]=people;
  const appt=(await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,reason,status) VALUES($1,$2,'2027-01-01','Synthetic review','confirmed') RETURNING id",[a,doctor])).rows[0].id;
  const doc=(await pool.query("INSERT INTO patient_documents(mother_id,title,doc_type,original_filename,mime_type,size_bytes,storage_key) VALUES($1,'Synthetic report','lab_report','fake.pdf','application/pdf',10,'synthetic-test-key') RETURNING id",[a])).rows[0].id;
  await pool.query('INSERT INTO patient_document_shares(document_id,doctor_id,shared_by) VALUES($1,$2,$3)',[doc,doctor,a]);
  const app=express();app.use(express.json());
  const authenticateToken=(req,res,next)=>{const id=Number(req.headers['x-test-user']);if(!people.includes(id))return res.sendStatus(401);req.user={id,role:id===doctor?'doctor':'mother'};next();};
  const authorizeRole=roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403);
  for(const mod of ['./patientExperience','./patientPreferences','./patientDocuments'])require(mod)(app,{pool,authenticateToken,authorizeRole});
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
  async function call(url,user=a,method='GET',body){const r=await fetch(base+'/api'+url,{method,headers:{'x-test-user':String(user),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null};}
  assert.equal((await call('/patient/appointments/'+appt,b,'PATCH',{action:'cancel'})).status,404);
  assert.equal((await call('/patient/appointments/'+appt,doctor,'PATCH',{action:'cancel'})).status,403);
  assert.equal((await call('/patient/appointments/'+appt,a,'PATCH',{action:'reschedule',requested_date:'2027-02-30'})).status,400);
  assert.equal((await call('/patient/appointments/'+appt,a,'PATCH',{action:'reschedule',requested_date:'2027-01-05',requested_time:'27:00'})).status,400);
  const rescheduled=await call('/patient/appointments/'+appt,a,'PATCH',{action:'reschedule',requested_date:'2027-01-05',requested_time:'09:30'});assert.equal(rescheduled.status,200);assert.equal(rescheduled.data.appointment.status,'pending');
  assert.equal((await call('/doctor/documents',doctor)).data.documents.length,1);
  const prefs=await call('/me/preferences',a,'PATCH',{preferences:{privacy_share_doctors:false,quiet_start:'99:00',lang:'ta',text_size:'large'}});assert.equal(prefs.status,200);assert.equal(prefs.data.preferences.quiet_start,undefined);
  assert.equal((await call('/doctor/documents',doctor)).data.documents.length,0);assert.equal((await call('/documents/'+doc,doctor)).status,404);assert.equal((await call('/documents/'+doc,a)).status,200);
  assert.equal((await call('/patient/sharing')).data.events[0].event_type,'document_sharing_preference');
  const exported=await call('/patient/export');assert.equal(exported.status,200);assert.equal(exported.data.appointments.length,1);assert.equal(JSON.stringify(exported.data).includes(hash),false);assert.equal((await call('/patient/export',b)).data.appointments.length,0);
  assert.equal((await call('/patient/deletion-request',a,'POST',{confirmation:'REQUEST DELETION',password:'wrong'})).status,403);
  assert.equal((await call('/patient/deletion-request',a,'POST',{confirmation:'REQUEST DELETION',password:'Synthetic-Test-Password!'})).data.status,'pending_review');assert.equal((await pool.query('SELECT id FROM users WHERE id=$1',[a])).rows.length,1);
  assert.equal((await call('/patient/appointments/'+appt,a,'PATCH',{action:'cancel'})).data.appointment.status,'cancelled');
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
