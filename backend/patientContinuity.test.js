'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
const {DatabaseSync}=require('node:sqlite'),{createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs'),continuity=require('./patientContinuity');
test('shared OPD configuration rejects wrong weekdays and taken windows, and mirrors scoped appointment context',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-booking-')),pool=createLocalPool(path.join(dir,'db')),saved={local:process.env.DAI_LOCAL,portal:process.env.DAI_PORTAL_DB,source:process.env.DAI_HOSPITAL_DB};let db;
 try{
  for(const file of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',file),'utf8'));
  for(const [email,role] of [['mother@synthetic.invalid','mother'],['doctor@synthetic.invalid','doctor']])await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,\'fake\',$2)',[email,role]);
  await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number) VALUES(2,'SYNTHETIC Doctor','Obstetrician/Gynaecologist','NMC-FAKE-001')");
  await pool.query('CREATE TABLE dai_local_source_link(entity TEXT,source_id TEXT,portal_uuid TEXT,target_id INTEGER)');await pool.query("INSERT INTO dai_local_source_link VALUES('mother','MOTHER-FAKE-1','mother-uuid',1),('doctor','DOCTOR-FAKE-1','doctor-uuid',2)");
  process.env.DAI_LOCAL='true';process.env.DAI_PORTAL_DB=path.join(dir,'portal.db');process.env.DAI_HOSPITAL_DB=path.join(dir,'source.db');
  db=new DatabaseSync(process.env.DAI_PORTAL_DB);db.exec("CREATE TABLE facility(id TEXT,name TEXT,tier TEXT,ownership TEXT,address TEXT,lat REAL,lng REAL,capabilities TEXT);INSERT INTO facility VALUES('facility-uuid','SYNTHETIC Facility','MEDICAL_COLLEGE','govt','Synthetic address',28,77,'{}');CREATE TABLE mother(id TEXT,registered_facility_id TEXT,assigned_doctor_id TEXT);INSERT INTO mother VALUES('mother-uuid','facility-uuid','doctor-uuid');CREATE TABLE unit(id TEXT,code TEXT,anc_day INTEGER,gynae_day INTEGER,opd_day INTEGER,room TEXT);INSERT INTO unit VALUES('unit-uuid','I',0,3,NULL,'ANC-01');CREATE TABLE portal_user(id TEXT,source_id TEXT,verified INTEGER,unit_id TEXT,facility_id TEXT);INSERT INTO portal_user VALUES('doctor-uuid','DOCTOR-FAKE-1',1,'unit-uuid','facility-uuid');");db.close();db=null;
  const src=new DatabaseSync(process.env.DAI_HOSPITAL_DB);src.exec("CREATE TABLE doctor_schedules(doctor_id TEXT,day INTEGER,start_time TEXT,end_time TEXT,is_on_call INTEGER);INSERT INTO doctor_schedules VALUES('DOCTOR-FAKE-1',0,'09:00','12:00',0);CREATE TABLE doctors(doctor_id TEXT,languages_spoken TEXT,max_daily_patients INTEGER);INSERT INTO doctors VALUES('DOCTOR-FAKE-1','[\"Hindi\",\"English\"]',2)");src.close();
  const cat=await continuity.catalogue(pool,1);assert.equal(cat.doctors[0].assigned,true);assert.equal(cat.doctors[0].sessions[0].start,'09:00');assert.equal(cat.facilities[0].registered,true);
  let d=new Date();d.setUTCDate(d.getUTCDate()+10);while(d.getUTCDay()!==1)d.setUTCDate(d.getUTCDate()+1);const monday=d.toISOString().slice(0,10),tuesday=new Date(d.getTime()+86400000).toISOString().slice(0,10);
  await assert.rejects(()=>continuity.validateBooking(pool,1,{doctor_id:2,requested_date:tuesday,requested_time:'09:00',visit_type:'antenatal'}),/OPD day/);
  await assert.rejects(()=>continuity.validateBooking(pool,1,{doctor_id:2,requested_date:monday,requested_time:'08:00',visit_type:'antenatal'}),/OPD day/);
  const ctx=await continuity.validateBooking(pool,1,{doctor_id:2,requested_date:monday,requested_time:'09:00',visit_type:'antenatal'});assert.equal(ctx.unit_label,'I');assert.equal(ctx.slot_end,'09:30');
  const a=(await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,requested_time,facility_uuid,unit_uuid,unit_label,slot_end) VALUES(1,2,$1,'09:00','facility-uuid','unit-uuid','I','09:30') RETURNING id",[monday])).rows[0];await assert.rejects(()=>continuity.validateBooking(pool,1,{doctor_id:2,requested_date:monday,requested_time:'09:00'}),/already taken/);
  await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,requested_time) VALUES(1,2,$1,'09:30')",[monday]);await assert.rejects(()=>continuity.validateBooking(pool,1,{doctor_id:2,requested_date:monday,requested_time:'10:00'}),/capacity is full/);
  await continuity.queueBridge(pool,a.id);await continuity.syncBridge(pool);db=new DatabaseSync(process.env.DAI_PORTAL_DB);const mirror=db.prepare('SELECT * FROM patient_appointment_bridge').get();assert.equal(mirror.mother_id,'MOTHER-FAKE-1');assert.equal(mirror.unit_uuid,'unit-uuid');assert.equal(mirror.status,'pending');assert.ok((await pool.query('SELECT synced_at FROM patient_hospital_outbox')).rows[0].synced_at);
 }finally{db?.close();for(const [key,value] of [['DAI_LOCAL',saved.local],['DAI_PORTAL_DB',saved.portal],['DAI_HOSPITAL_DB',saved.source]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
test('original reports enforce ownership, private reveal, explicit expiring consent, linked verification and file audit',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-reports-')),pool=createLocalPool(path.join(dir,'db'));let server;
 const saved=process.env.PATIENT_DOCS_DIR;process.env.PATIENT_DOCS_DIR=path.join(dir,'files');delete require.cache[require.resolve('./patientDocuments')];const register=require('./patientDocuments');
 try{
  for(const file of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',file),'utf8'));
  for(const [email,role] of [['one@synthetic.invalid','mother'],['two@synthetic.invalid','mother'],['doctor@synthetic.invalid','doctor']])await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,\'fake\',$2)',[email,role]);
  await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,facility_name) VALUES(3,'SYNTHETIC Doctor','Obstetrician','NMC-FAKE-001','SYNTHETIC Care Centre')");
  await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES(1,3,'2030-01-01','confirmed')");
  const milestone=(await pool.query("INSERT INTO care_milestones(mother_id,stage,category,title,due_date,sort_order) VALUES(1,'T2','pregnancy','Screening','2026-10-01',1) RETURNING id")).rows[0].id;
  const app=express();app.use(express.json());const authenticateToken=(req,res,next)=>{const id=Number(req.headers['x-user']);if(![1,2,3].includes(id))return res.sendStatus(401);req.user={id,role:id===3?'doctor':'mother'};next();},authorizeRole=roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403);register(app,{pool,authenticateToken,authorizeRole});
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
  async function call(url,user=1,method='GET',body){const r=await fetch(base+'/api'+url,{method,headers:{'x-user':String(user),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null,response:r};}
  const file={title:'HIV synthetic screening',doc_type:'lab_report',mime_type:'application/pdf',filename:'synthetic.pdf',content_base64:Buffer.from('%PDF-1.4\n% Synthetic test file\n%%EOF').toString('base64'),milestone_id:milestone,is_sensitive:true,report_category:'screening'};
  assert.equal((await call('/documents',2,'POST',file)).status,400);
  const uploaded=await call('/documents',1,'POST',file);assert.equal(uploaded.status,201);assert.equal(uploaded.data.document.title,'Private screening report');const id=uploaded.data.document.id;
  assert.equal((await call('/documents/'+id,2)).status,404);assert.equal((await call('/documents/'+id+'/download')).status,403);assert.equal((await call('/documents/'+id+'?reveal=1')).data.document.title,file.title);
  assert.equal((await call('/documents/'+id+'/share',1,'POST',{doctor_id:3})).status,400);
  assert.equal((await call('/documents/'+id+'/share',1,'POST',{doctor_id:3,sensitive_consent:true,expires_at:new Date(Date.now()+3600000).toISOString()})).status,200);
  assert.equal((await call('/documents/'+id+'/download?reveal=1',3)).status,200);
  const pending=(await pool.query('SELECT result_id,completion_verification FROM care_milestones WHERE id=$1',[milestone])).rows[0];assert.equal(pending.result_id,id);assert.equal(pending.completion_verification,'awaiting_verification');
  assert.equal((await call('/documents/'+id+'/review',3,'PATCH',{doctor_note:'Synthetic clinician review only; discuss at follow-up.'})).status,200);
  const checked=(await pool.query('SELECT completion_verification,verified_facility_name FROM care_milestones WHERE id=$1',[milestone])).rows[0];assert.equal(checked.completion_verification,'verified');assert.equal(checked.verified_facility_name,'SYNTHETIC Care Centre');
  assert.equal((await call('/documents/'+id,1,'DELETE')).status,403);
  await pool.query("UPDATE patient_document_shares SET expires_at=NOW()-INTERVAL '1 minute' WHERE document_id=$1",[id]);assert.equal((await call('/documents/'+id,3)).status,404);
  assert.equal((await call('/documents/'+id+'/problem',2,'POST',{reason:'Wrong person'})).status,404);assert.equal((await call('/documents/'+id+'/problem',1,'POST',{reason:'Please check this synthetic record'})).status,201);
  const history=(await call('/documents/'+id+'/history')).data.history;assert.ok(history.some(x=>x.event_type==='download'));assert.ok(history.some(x=>x.event_type==='verify'));
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});if(saved===undefined)delete process.env.PATIENT_DOCS_DIR;else process.env.PATIENT_DOCS_DIR=saved;}
});
