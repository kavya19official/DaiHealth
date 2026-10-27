'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),express=require('express');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs');
const cc=require('./careCoordination'),{staticCompression,pickEncoding}=require('./staticCompression');

test('validators keep in-person care explicit and repeat-test decisions with the clinician',()=>{
 assert.throws(()=>cc.validatePack({kind:'test_preparation',title:'Fasting test',body:'Do not eat after 10pm.',in_person_required:true}),/in-person/);
 assert.equal(cc.validatePack({kind:'test_preparation',title:'Fasting test',body:'Do not eat after 10pm.'}).in_person_reason,null);
 assert.throws(()=>cc.validateTestDecision({test_name:'Hb',decision:'repeat_clinically_indicated'}),/clinical reason/);
 assert.equal(cc.validateTestDecision({test_name:'Hb',decision:'prior_result_used'}).reason,null);
 assert.throws(()=>cc.validateJourney({care_need:'scan',outcome:'seen_first_visit',failure_reason:'cost'}),/did not go ahead/);
 assert.throws(()=>cc.validateFollowup({gap_key:'other:1',action:'contacted',mother_id:1}),/care gap/);
});

test('facility order is capability-gated, then nearest, then reported availability',()=>{
 const soon=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-86400000).toISOString();
 const out=cc.coordinationOrder([
  {id:1,name:'B',distance_km:5,slots:[{starts_at:past,available_places:3}]},
  {id:2,name:'A',distance_km:5,slots:[{starts_at:soon,available_places:2}]},
  {id:3,name:'C',distance_km:2,slots:[]},
  {id:4,name:'D',distance_km:null,slots:[]}],'emergency_maternity');
 assert.deepEqual(out.map(f=>f.id),[3,2,1,4]);
 assert.equal(out[1].coordination.availability,'slots_reported');assert.equal(out[2].open_slots,0);
 assert.deepEqual(out[0].coordination.order,['clinical_capability','location','availability']);
});

test('static compression serves br/gzip with ETag, skips small or traversal paths',async()=>{
 assert.equal(pickEncoding('gzip, deflate, br'),'br');assert.equal(pickEncoding('br;q=0, gzip'),'gzip');assert.equal(pickEncoding('identity'),null);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-static-'));let server;
 try{
  await fs.writeFile(path.join(dir,'big.js'),'console.log("low bandwidth");\n'.repeat(200));await fs.writeFile(path.join(dir,'tiny.css'),'a{}');
  const app=express();app.use(staticCompression(dir),express.static(dir));
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+server.address().port;
  const http=require('node:http');
  const get=(p,headers)=>new Promise((ok,ko)=>http.get(base+p,{headers},res=>{const c=[];res.on('data',d=>c.push(d));res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body:Buffer.concat(c)}));}).on('error',ko));
  const br=await get('/big.js',{'accept-encoding':'br'});assert.equal(br.headers['content-encoding'],'br');assert.match(zlib.brotliDecompressSync(br.body).toString(),/low bandwidth/);assert.ok(br.body.length<1000);
  assert.equal((await get('/big.js',{'accept-encoding':'br','if-none-match':br.headers.etag})).status,304);
  const gz=await get('/big.js',{'accept-encoding':'gzip'});assert.equal(gz.headers['content-encoding'],'gzip');assert.match(zlib.gunzipSync(gz.body).toString(),/low bandwidth/);
  assert.equal((await get('/tiny.css',{'accept-encoding':'br'})).headers['content-encoding'],undefined);
  assert.equal((await get('/big.js',{})).headers['content-encoding'],undefined);
  assert.equal((await get('/..%2f..%2fetc%2fpasswd',{'accept-encoding':'br'})).headers['content-encoding'],undefined);
 }finally{if(server)await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

test('care coordination API enforces verified, connected clinicians and records outcomes without claims',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-care-coord-')),pool=createLocalPool(dir);let server;
 try{
 for(const name of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
 for(const role of ['mother','mother','doctor','doctor','doctor'])await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'fake',$2)",[role+Math.random()+'@synthetic.invalid',role]);
 for(const id of [1,2])await pool.query("INSERT INTO mother_profiles(user_id,full_name) VALUES($1,'Synthetic Patient')",[id]);
 for(const id of [3,4,5])await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified) VALUES($1,'Synthetic Clinician','OBG','SYNTHETIC-ONLY',$2)",[id,id!==5]);
 const appt=(await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES(1,3,CURRENT_DATE-10,'completed') RETURNING id")).rows[0].id;
 await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES(1,5,CURRENT_DATE,'confirmed')");
 const app=express();app.use(express.json());const options={pool,authenticateToken(req,res,next){const id=Number(req.headers['x-user']);if(!id)return res.sendStatus(401);req.user={id,role:id<3?'mother':'doctor'};next();},authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)};
 cc(app,options);
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 const api=async(url,user,body,method)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/'+url,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json','x-user':String(user)},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({})),cache:r.headers.get('cache-control')};};

 // Digital-first packs: drafts are invisible; only connected, verified clinicians write; in-person stays explicit.
 const pack={mother_id:1,appointment_id:appt,kind:'test_preparation',title:'Glucose test preparation',body:'Do not eat for 8 hours before the test. Bring your last report.',in_person_required:true,in_person_reason:'Blood must be drawn at the lab.'};
 assert.equal((await api('doctor/care-coordination/packs',4,pack)).status,403);
 assert.equal((await api('doctor/care-coordination/packs',5,{...pack,appointment_id:undefined})).status,403);
 assert.equal((await api('doctor/care-coordination/packs',3,{...pack,appointment_id:9999})).status,404);
 const created=await api('doctor/care-coordination/packs',3,pack);assert.equal(created.status,201);const packId=created.body.pack.id;
 assert.equal((await api('patient/care-coordination',1)).body.packs.length,0);
 assert.equal((await api('doctor/care-coordination/packs/'+packId+'/verify',3,{})).status,400);
 assert.equal((await api('doctor/care-coordination/packs/'+packId+'/verify',3,{confirmed:true})).body.pack.status,'verified');
 const view=await api('patient/care-coordination',1);assert.match(view.cache,/no-store/);assert.equal(view.body.packs[0].in_person_required,true);assert.match(view.body.notice,/attend/);
 assert.equal((await api('patient/care-coordination',2)).body.packs.length,0);
 assert.equal((await api('patient/care-coordination/packs/'+packId+'/feedback',2,{outcome:'avoided_trip'})).status,404);
 assert.equal((await api('patient/care-coordination/packs/'+packId+'/feedback',1,{outcome:'avoided_paperwork'})).status,200);
 assert.equal((await api('patient/care-coordination/packs/'+packId+'/seen',1,{})).status,200);

 // Referral journeys: capability match is checked against the facility record, not assumed.
 const fac=(await pool.query("INSERT INTO facilities(facility_code,name,facility_type,address,city,district,state,pincode,latitude,longitude) VALUES('SYN-CC-1','Synthetic Centre','hospital','Synthetic Rd','Delhi','New Delhi','Delhi','110001',28.6,77.2) RETURNING id")).rows[0].id;
 await pool.query("INSERT INTO facility_capabilities(facility_id,capability,available) VALUES($1,'emergency_maternity',TRUE)",[fac]);
 const j=await api('patient/care-coordination/journeys',1,{care_need:'emergency_maternity',facility_id:fac,prior_searches:0});assert.equal(j.status,201);assert.equal(j.body.journey.capability_matched,true);
 assert.equal((await api('patient/care-coordination/journeys/'+j.body.journey.id,2,{outcome:'seen_first_visit'},'PATCH')).status,404);
 assert.equal((await api('patient/care-coordination/journeys/'+j.body.journey.id,1,{outcome:'seen_first_visit'},'PATCH')).body.journey.outcome,'seen_first_visit');
 const j2=await api('doctor/care-coordination/patients/1/journeys',3,{care_need:'neonatal_surgery',facility_id:fac,prior_searches:3,outcome:'failed_visit',failure_reason:'capability_unavailable'});assert.equal(j2.body.journey.capability_matched,false);
 const match=await api('care-coordination/facility-match?capability=emergency_maternity&user_lat=28.6&user_lon=77.2',1);assert.equal(match.status,200);assert.deepEqual(match.body.facilities.map(f=>f.id),[fac]);
 assert.equal((await api('care-coordination/facility-match?capability=neonatal_surgery',1)).body.facilities.length,0);
 assert.equal((await api('care-coordination/facility-match?capability=anything',1)).status,400);

 // Prior reports: only explicitly shared documents; unshared ones are counted, never described.
 const doc=async t=>(await pool.query("INSERT INTO patient_documents(mother_id,title,doc_type,original_filename,mime_type,size_bytes,storage_key) VALUES(1,$1,'lab_report','fake.pdf','application/pdf',10,$2) RETURNING id",[t,'k'+Math.random()])).rows[0].id;
 const shared=await doc('Synthetic Hb report'),hidden=await doc('Private report');
 await pool.query('INSERT INTO patient_document_shares(document_id,doctor_id,shared_by) VALUES($1,3,1)',[shared]);
 assert.equal((await api('doctor/care-coordination/patients/1/prior-records',4)).status,403);
 const prior=await api('doctor/care-coordination/patients/1/prior-records',3);
 assert.deepEqual(prior.body.reports.map(r=>r.id),[shared]);assert.equal(prior.body.unshared_report_count,1);assert.ok(!JSON.stringify(prior.body).includes('Private report'));assert.match(prior.body.notice,/clinician/);
 assert.equal((await api('doctor/care-coordination/patients/1/test-decisions',3,{test_name:'Hb',decision:'prior_result_used',document_id:hidden})).status,404);
 assert.equal((await api('doctor/care-coordination/patients/1/test-decisions',3,{test_name:'Hb',decision:'prior_result_used',document_id:shared})).status,201);
 assert.equal((await api('doctor/care-coordination/patients/1/test-decisions',3,{test_name:'Hb',decision:'repeat_clinically_indicated',reason:'Symptoms changed since the last report.'})).status,201);
 assert.ok((await pool.query("SELECT 1 FROM patient_record_access_log WHERE doctor_id=4 AND allowed=FALSE")).rows.length>0);

 // Preventive follow-up: due follow-up appears as a gap; outcomes are recorded and evaluated as counts only.
 await pool.query(`INSERT INTO visit_summaries(appointment_id,mother_id,doctor_id,status,summary_text,follow_up,approved_at) VALUES($1,1,3,'approved','Synthetic visit',$2,NOW())`,[appt,JSON.stringify({text:'Blood pressure check',due_date:new Date().toISOString().slice(0,10)})]);
 await pool.query("UPDATE appointments SET status='cancelled' WHERE mother_id=1 AND doctor_id=5");
 const gaps=await api('doctor/care-coordination/care-gaps',3);const gap=gaps.body.gaps.find(g=>g.source==='visit_summary');assert.ok(gap);
 assert.equal((await api('doctor/care-coordination/care-gaps',5)).status,403);
 assert.equal((await api('doctor/care-coordination/care-gaps/events',3,{mother_id:2,gap_key:gap.gap_key,action:'contacted',outcome:'completed'})).status,403);
 assert.equal((await api('doctor/care-coordination/care-gaps/events',3,{mother_id:1,gap_key:gap.gap_key,action:'reminder_sent'})).status,201);
 assert.equal((await api('doctor/care-coordination/care-gaps/events',3,{mother_id:1,gap_key:gap.gap_key,action:'contacted',outcome:'completed',emergency_use_reported:true})).status,201);
 assert.equal((await api('doctor/care-coordination/care-gaps',3)).body.gaps.find(g=>g.gap_key===gap.gap_key).last_event.outcome,'completed');
 const ev=(await api('doctor/care-coordination/evaluation',3)).body;
 assert.equal(ev.prevention_claim,'not_evaluated');assert.equal(ev.instructions.verified,1);assert.equal(ev.instructions.seen,1);assert.equal(ev.instructions.patient_feedback.avoided_paperwork,1);
 assert.equal(ev.referrals.outcomes.seen_first_visit,1);assert.equal(ev.referrals.first_search_first_visit,1);assert.equal(ev.referrals.capability_failures,1);
 assert.deepEqual(ev.tests,{prior_result_used:1,repeat_clinically_indicated:1});assert.deepEqual(ev.follow_up.latest_outcomes,{completed:1});assert.equal(ev.follow_up.patients_with_reported_emergency_use,1);
 assert.match(ev.notice,/not assumed/);

 // Revocation removes clinician access immediately.
 await pool.query("INSERT INTO patient_access_controls(mother_id,grantee_type,grantee_ref,state) VALUES(1,'doctor','3','revoked')");
 assert.equal((await api('doctor/care-coordination/patients/1/prior-records',3)).status,403);
 assert.equal((await api('doctor/care-coordination/packs',3)).body.packs.length,0);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
