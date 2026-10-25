'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{assemble}=require('./doctorWorkspace'),M=require('../frontend/js/doctor-workspace-model');
const fixture=shared=>assemble({date:'2026-10-24',profile:{user_id:3,full_name:'SYNTHETIC Clinician',specialization:'OBG'},patients:[{id:1,full_name:'SYNTHETIC Mother A',lmp_date:'2026-04-01',edd_date:'2027-01-06'},{id:2,full_name:'SYNTHETIC Mother B',pregnancy_status:'delivered'}],milestones:[{id:1,mother_id:1,title:'Hb follow-up',stage:'Trimester 2',category:'pregnancy',due_date:'2026-10-01',completed_at:null,status:'upcoming'},{id:2,mother_id:1,title:'Visit',stage:'Trimester 2',category:'pregnancy',due_date:'2026-10-10',completed_at:'2026-10-10',status:'completed'},{id:3,mother_id:2,title:'Old ANC test',stage:'Trimester 3',category:'pregnancy',due_date:'2026-04-01',completed_at:null,status:'upcoming'}],appointments:[{id:1,mother_id:1,requested_date:'2026-10-24',status:'confirmed'}],reports:[],postpartum:[{mother_id:2,delivery_date:'2026-10-01'}],shared,snapshot:{patients:{1:{age:28,uhid:'FAKE-1',clinicianRisk:shared.has(1)?{reviewer:'SYNTHETIC Clinician',reason:'Recorded extra care'}:null}},beds:[],blood:[],onCall:[],incoming:[],alerts:[],clinics:[]}});
test('doctor panel derives gaps, sourced completion and consent-limited clinician labels',()=>{const d=fixture(new Set());assert.equal(d.summary.assigned,2);assert.equal(d.summary.open_gaps,1);assert.equal(d.worklist.length,1);assert.match(d.worklist[0].reason,/2026-10-01/);assert.equal(d.patients[1].stage.label,'Postpartum, day 23');assert.equal(d.summary.high_risk,0);assert.equal(d.patients[0].clinical_shared,false);assert.equal(d.patients[0].readiness,null);assert.equal(d.hospital.onCall.length,0);const shared=fixture(new Set([1]));assert.equal(shared.summary.high_risk,1);assert.equal(shared.patients[0].clinicianRisk.reviewer,'SYNTHETIC Clinician');});
test('patient search, saved views, date windows and chart counts use recorded events',()=>{const d=fixture(new Set([1]));assert.equal(M.roster(d,{query:'fake-1'}).length,1);assert.equal(M.roster(d,{filter:'overdueHb'}).length,1);assert.equal(M.roster(d,{filter:'high-risk'}).length,1);assert.equal(M.roster(d,{filter:'postpartum'}).length,1);assert.equal(M.roster(d,{period:'day',date:'2026-10-24'}).length,1);assert.equal(M.roster(d,{period:'day',date:'2026-10-25'}).length,0);assert.deepEqual(M.bounds('2026-01-03','week'),{start:'2025-12-28',end:'2026-01-03'});assert.equal(M.completion([]).percent,null);assert.equal(M.completion(d.milestones).percent,33);assert.equal(M.completionSeries(d.milestones,'2026-10-10').at(-1).visits,1);assert.equal(M.completionSeries(d.milestones,'2026-10-10',30).length,30);});
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),express=require('express'),{createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs');
test('workspace API denies wrong roles and unverified doctors, scopes records and logs every roster read',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-doctor-workspace-')),pool=createLocalPool(dir);let server;
 try{for(const name of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
 // The application uses India calendar dates; CURRENT_DATE fixtures must use the same timezone.
 await pool.query("SET TIME ZONE 'Asia/Kolkata'");
 const ids=[];for(const role of ['mother','mother','doctor','doctor'])ids.push((await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id',[role+ids.length+'@dai-synthetic.invalid','fake',role])).rows[0].id);const [mother,other,doctor,unverified]=ids;
 for(const id of [mother,other])await pool.query("INSERT INTO mother_profiles(user_id,full_name,care_start_date) VALUES($1,$2,'2026-04-01')",[id,'SYNTHETIC Mother '+id]);
 for(const id of [doctor,unverified])await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified) VALUES($1,'SYNTHETIC Clinician','OBG','NMC-FAKE-TEST',$2)",[id,id===doctor]);
 await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,CURRENT_DATE,'confirmed'),($3,$4,CURRENT_DATE,'confirmed')",[mother,doctor,other,unverified]);
 await pool.query("INSERT INTO care_milestones(mother_id,stage,category,title,due_date) VALUES($1,'Trimester 2','pregnancy','Synthetic Hb follow-up',CURRENT_DATE-1),($2,'Trimester 2','pregnancy','PRIVATE OTHER CASE',CURRENT_DATE-1)",[mother,other]);
 const app=express();app.use(express.json());const dependencies={pool,authenticateToken:(req,res,next)=>{if(!req.headers['x-user'])return res.sendStatus(401);req.user={id:Number(req.headers['x-user'])};req.user.role=[mother,other].includes(req.user.id)?'mother':'doctor';next();},authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)};require('./doctorWorkspace')(app,dependencies);require('./doctorOperations')(app,dependencies);
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const url='http://127.0.0.1:'+server.address().port+'/api/doctor/workspace';
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{'x-user':String(mother)}})).status,403);assert.equal((await fetch(url,{headers:{'x-user':String(unverified)}})).status,403);
 const r=await fetch(url,{headers:{'x-user':String(doctor)}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const d=await r.json();assert.equal(d.patients.length,1);assert.equal(d.patients[0].id,mother);assert.equal(d.worklist.length,1);assert.ok(!JSON.stringify(d).includes('PRIVATE OTHER CASE'));assert.equal(d.hospital,null);assert.equal(d.patients[0].clinical_shared,false);assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM patient_access_events WHERE mother_id=$1 AND event_type='doctor_workspace_read'",[mother])).rows[0].n,1);
 const appointment=(await pool.query('SELECT id FROM appointments WHERE doctor_id=$1',[doctor])).rows[0].id;
 const base='http://127.0.0.1:'+server.address().port+'/api/doctor';
 async function change(route,body,user=doctor){const r=await fetch(base+route,{method:'POST',headers:{'x-user':String(user),'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
 assert.equal((await change('/queue/'+appointment,{state:'in_consult',version:0})).status,409);
 assert.equal((await change('/queue/'+appointment,{state:'waiting',version:0})).status,200);
 assert.equal((await change('/queue/'+appointment,{state:'waiting',version:0})).status,409);
 assert.equal((await change('/queue/'+appointment,{state:'in_consult',version:1})).status,200);
 const second=(await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,CURRENT_DATE,'confirmed') RETURNING id",[mother,doctor])).rows[0].id;
 assert.equal((await change('/queue/'+second,{state:'waiting',version:0})).status,200);
 assert.equal((await change('/queue/'+second,{state:'in_consult',version:1})).status,409);
 assert.equal((await change('/queue/'+appointment,{state:'done',version:2,note:'Synthetic completed consultation summary.'})).status,200);
 assert.equal((await pool.query('SELECT status,doctor_notes FROM appointments WHERE id=$1',[appointment])).rows[0].status,'completed');
 assert.equal((await change('/queue/'+appointment,{state:'waiting',version:3})).status,409);
 const milestone=(await pool.query('SELECT id FROM care_milestones WHERE mother_id=$1',[mother])).rows[0].id;
 assert.equal((await change('/worklist/'+milestone,{state:'dismissed',reason:''})).status,400);
 assert.equal((await change('/worklist/'+milestone,{state:'reviewed',reason:'Discussed during synthetic review.'})).status,200);
 assert.equal((await pool.query('SELECT completed_at FROM care_milestones WHERE id=$1',[milestone])).rows[0].completed_at,null);
 assert.equal((await change('/worklist/'+milestone,{state:'reviewed',reason:'Invalid access'},unverified)).status,403);
 const outside=(await pool.query('SELECT id FROM care_milestones WHERE mother_id=$1',[other])).rows[0].id;
 assert.equal((await change('/worklist/'+outside,{state:'dismissed',reason:'Invalid other patient'})).status,404);
 assert.ok((await pool.query('SELECT COUNT(*)::int AS n FROM doctor_operations_event WHERE doctor_id=$1',[doctor])).rows[0].n>=4);
 await pool.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'PRIVATE_OTHER_ACTOR',jsonb_build_object('doctor_id',$2::int))",[other,unverified]);
 const activity=await fetch(base+'/activity',{headers:{'x-user':String(doctor)}});assert.equal(activity.status,200);const history=await activity.json();assert.ok(history.changes.length>=4);assert.ok(!JSON.stringify(history).includes('PRIVATE_OTHER_ACTOR'));
 const future=(await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,CURRENT_DATE+1,'confirmed') RETURNING id",[mother,doctor])).rows[0].id;
 assert.equal((await change('/queue/'+future,{state:'waiting',version:0})).status,409);


 }finally{await new Promise(resolve=>server?server.close(resolve):resolve());await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
