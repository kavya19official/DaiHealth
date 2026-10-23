'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {streak,validDate}=require('./patientHome'),H=require('../frontend/js/patient-home-model'),Ref=require('../shared/child-reference');
test('self-care streaks are calculated from actual completed dates and do not count future entries',()=>{
 const tasks={prescribed:true,water:true,rest:true,care_plan:true};
 assert.equal(streak([{check_date:'2026-10-23',tasks},{check_date:'2026-10-22',tasks},{check_date:'2026-10-21',tasks:{water:true}},{check_date:'2026-10-24',tasks}],'2026-10-23'),2);
 assert.equal(streak([{check_date:'2026-10-22',tasks}],'2026-10-23'),1);assert.equal(validDate('2026-02-30'),false);
});
test('home uses only recorded readings and each child’s own vaccination dates',()=>{
 assert.equal(H.sparkline([{value:80,source:'self_report'}]),null);
 assert.deepEqual(H.sparkline([{value:60,source:'clinician_record'},{value:60,source:'clinician_record'}]),[[4,16],[96,16]]);
 const a={date_of_birth:'2026-10-20',vaccinations:[{vaccine_code:'bcg',given_on:'2026-10-20'}]},b={date_of_birth:'2026-10-20',vaccinations:[]};
 assert.equal(H.vaccination(a,Ref,'2026-10-23').given,1);assert.equal(H.vaccination(b,Ref,'2026-10-23').given,0);assert.equal(H.age('2026-10-11','2026-10-23').label,'12 days');
 assert.equal(H.greeting(20),'Good evening');
});
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
const {createLocalPool}=require('./localPool');const {migrations}=require('../scripts/seed-local.cjs');
test('personal check-ins, journal photos and baby logs persist with strict ownership and no fabricated data',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-home-test-')),pool=createLocalPool(dir);let server;
 try{
  for(const file of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',file),'utf8'));
  const ids=[];for(const [name,role] of [['one','mother'],['two','mother'],['doc','doctor']])ids.push((await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id',[name+'@dai-synthetic.invalid','synthetic-unusable-hash',role])).rows[0].id);
  const [a,b,doctor]=ids;
  const child=(await pool.query("INSERT INTO children(mother_id,name,date_of_birth,sex) VALUES($1,'SYNTHETIC Baby','2026-10-01','female') RETURNING id",[a])).rows[0].id;
  const photo=(await pool.query("INSERT INTO patient_documents(mother_id,title,doc_type,original_filename,mime_type,size_bytes,storage_key) VALUES($1,'Synthetic photo','other','fake.jpg','image/jpeg',10,'home-test-photo') RETURNING id",[a])).rows[0].id;
  const app=express();app.use(express.json());
  const authenticateToken=(req,res,next)=>{const id=Number(req.headers['x-test-user']);if(!ids.includes(id))return res.sendStatus(401);req.user={id,role:id===doctor?'doctor':'mother'};next();};const authorizeRole=roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403);
  require('./patientHome')(app,{pool,authenticateToken,authorizeRole});
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
  async function call(url='',body,user=a,method=body?'POST':'GET'){const r=await fetch(base+'/api/patient/home'+url,{method,headers:{'x-test-user':String(user),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null};}
  let home=await call();const date=home.data.date;assert.deepEqual(home.data.daily.tasks,{});assert.equal(home.data.journal.length,0);assert.equal((await call('',undefined,doctor)).status,403);
  assert.equal((await call('/checkin',{date:'2099-01-01',mood:'good'},a,'PUT')).status,400);
  assert.equal((await call('/checkin',{date,tasks:{water:'true'}},a,'PUT')).status,400);
  assert.equal((await call('/checkin',{date,mood:'diagnosed'},a,'PUT')).status,400);
  const tasks={prescribed:true,water:true,rest:true,care_plan:true};assert.equal((await call('/checkin',{date,tasks,mood:'okay'},a,'PUT')).status,200);
  await call('/checkin',{date,tasks:{water:true}},a,'PUT');home=await call();assert.equal(home.data.streak,1);assert.equal(home.data.daily.mood,'okay');assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM patient_daily_checkins')).rows[0].n,1);
  assert.equal((await call('/journal',{date,note:'A moment',photo_document_id:photo},b)).status,404);
  assert.equal((await call('/journal',{date,note:'<b>My synthetic journal note</b>',photo_document_id:photo})).status,201);assert.equal((await call()).data.journal.length,1);assert.equal((await call('',undefined,b)).data.journal.length,0);
  const log={child_id:child,event_type:'feed',started_at:new Date().toISOString(),duration_min:15};assert.equal((await call('/baby-log',log,b)).status,404);assert.equal((await call('/baby-log',{...log,started_at:'2026-09-01T10:00:00Z'})).status,400);assert.equal((await call('/baby-log',{...log,duration_min:-1})).status,400);assert.equal((await call('/baby-log',log)).status,201);assert.equal((await call()).data.baby_logs[0].child_id,child);assert.equal((await call('',undefined,b)).data.baby_logs.length,0);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
