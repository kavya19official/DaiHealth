'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const {createLocalPool}=require('./localPool'),register=require('./patientHospitalStay');
test('hospital stay API exposes only own released updates; corrections, babies, expiry and questions are scoped',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dai-stay-')),pool=createLocalPool(path.join(dir,'db'));let server;
 try{
 await pool.query('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2); CREATE TABLE children(id INTEGER PRIMARY KEY,mother_id INTEGER,name TEXT); INSERT INTO children VALUES(1,1,\'Baby A\'),(2,1,\'Baby B\'),(3,2,\'Other baby\');');
 await pool.query(fs.readFileSync(path.join(__dirname,'db/hospital_stay.sql'),'utf8'));
 await pool.query("INSERT INTO patient_hospital_stays(mother_id,facility_name,ward_name,admitted_at) VALUES(1,'Fake facility','Ward 6',now()-INTERVAL '2 days')");
 await pool.query("INSERT INTO patient_hospital_stays(mother_id,facility_name,ward_name,admitted_at,discharged_at) VALUES(1,'Old facility','Ward 1',now()-INTERVAL '20 days',now()-INTERVAL '10 days'),(2,'Other facility','Ward 2',now()-INTERVAL '1 day',NULL)");
 async function entry(child,text,release=true,extra={},supersedes=null){return(await pool.query(`INSERT INTO patient_stay_updates(stay_id,child_id,kind,recorded_at,recorded_by,patient_text,values_json,verified_at,verified_by,released_at,released_by,supersedes_id) VALUES(1,$1,'vitals',now()-INTERVAL '3 hours','Fake Nurse',$2,$3::jsonb,now()-INTERVAL '2 hours','Fake Reviewer',CASE WHEN $4 THEN now()-INTERVAL '1 hour' ELSE NULL END,CASE WHEN $4 THEN 'Fake Clinician' ELSE NULL END,$5) RETURNING id`,[child,text,JSON.stringify(extra),release,supersedes])).rows[0].id;}
 const old=await entry(null,'First reading',true,{pulse:80,internal_alert:'must not leave server',early_warning_score:8});await entry(null,'Corrected reading',true,{pulse:78},old);
 await entry(1,'Baby A reading',true,{temperature_c:36.8});await entry(2,'Baby B reading',true,{temperature_c:36.7});await entry(3,'Foreign baby');await entry(null,'Not released',false);
 const app=express();app.use(express.json());const auth=(req,res,next)=>{const id=Number(req.headers['x-user']);if(!id)return res.sendStatus(401);req.user={id,role:req.headers['x-role']||'mother'};next();};register(app,{pool,authenticateToken:auth,authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)});
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port+'/api/patient/hospital-stay';
 async function call(suffix='',user=1,method='GET',body,role='mother'){return fetch(base+suffix,{method,headers:{'x-user':String(user),'x-role':role,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});}
 const r=await call(),body=await r.json();assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(body.stays.length,1);assert.equal(body.stays[0].status,'admitted');assert.equal(body.stays[0].updates.length,4);assert.deepEqual(body.stays[0].children.map(c=>c.id),[1,2]);assert.equal(body.stays[0].updates[1].supersedes_id,old);assert(!JSON.stringify(body).includes('internal_alert'));assert(!JSON.stringify(body).includes('early_warning'));assert(!JSON.stringify(body).includes('Not released'));assert(!JSON.stringify(body).includes('Foreign baby'));
 assert.equal((await call('',0)).status,401);assert.equal((await call('',1,'GET',undefined,'doctor')).status,403);
 assert.equal((await call('/1/questions',2,'POST',{note:'Other patient'})).status,404);
 assert.equal((await call('/1/questions',1,'POST',{note:'When is my next review?'})).status,201);
 assert.equal((await call('/1/questions',1,'POST',{note:''})).status,400);
 assert.equal((await call('/sharing',1,'PUT',{caregiver_sharing:'true'})).status,400);
 assert.equal((await call('/sharing',1,'PUT',{caregiver_sharing:true})).status,200);
 const refreshed=await(await call()).json();assert.equal(refreshed.caregiver_sharing,true);assert.equal(refreshed.caregiver_access_connected,false);assert.equal(refreshed.stays[0].notes.length,1);
 assert.equal((await call('/1',1,'PATCH',{pulse:999})).status,404);
 await pool.query("UPDATE patient_hospital_stays SET discharged_at=now()-INTERVAL '1 hour' WHERE id=1");assert.equal((await(await call()).json()).stays[0].status,'discharged');
 await pool.query("UPDATE patient_hospital_stays SET admitted_at=now()-INTERVAL '10 days',discharged_at=now()-INTERVAL '8 days' WHERE id=1");assert.equal((await(await call()).json()).stays.length,0);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();fs.rmSync(dir,{recursive:true,force:true});}
});
