'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs');
test('human review requires verified connected clinicians, protects original sharing, versions, ownership and immutable events',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-human-review-')),pool=createLocalPool(dir);let server;
 try{
 for(const name of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
 for(const role of ['mother','mother','doctor','doctor','doctor'])await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'fake',$2)",[role+Math.random()+'@synthetic.invalid',role]);
 for(const id of [1,2])await pool.query("INSERT INTO mother_profiles(user_id,full_name) VALUES($1,'Synthetic Patient')",[id]);
 for(const id of [3,4,5])await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified) VALUES($1,'Synthetic Clinician','OBG','SYNTHETIC-ONLY',$2)",[id,id!==3]);
 for(const id of [3,4])await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES(1,$1,CURRENT_DATE,'confirmed')",[id]);
 const app=express();app.use(express.json());const options={pool,authenticateToken(req,res,next){const id=Number(req.headers['x-user']);if(!id)return res.sendStatus(401);req.user={id,role:id<3?'mother':'doctor'};next();},authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)};
 require('./clinicalReview').register(app,options);
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 const api=async(url,user=1,body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/'+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-user':String(user)},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({})),cache:r.headers.get('cache-control')};};
 const create={kind:'pregnancy_risk',summary:'Please review the relevant original measurement log.'};
 const a=await api('patient/clinical-reviews',1,create);assert.equal(a.status,201);const id=a.body.request.id;
 assert.equal((await api('patient/clinical-reviews',1,create)).body.request.id,id);assert.equal((await pool.query('SELECT * FROM clinical_review_events')).rows.length,1);
 assert.equal((await api('patient/clinical-reviews',2)).body.requests.length,0);
 assert.equal((await api('doctor/clinical-reviews',3)).status,403);assert.equal((await api('doctor/clinical-reviews',5)).body.requests.length,0);assert.equal((await api('doctor/clinical-reviews',4)).body.requests.length,1);
 const decision={version:1,action:'escalate',note:'I reviewed the original synthetic record and take responsibility for escalation.',evidence_ref:'SYNTHETIC original record 1',confirmed:true};
 const endpoint='doctor/clinical-reviews/'+id+'/decision';
 assert.equal((await api(endpoint,1,decision)).status,403);assert.equal((await api(endpoint,4,{...decision,confirmed:false})).status,400);assert.equal((await api(endpoint,4,{...decision,version:99})).status,409);
 await pool.query('UPDATE doctor_profiles SET credential_verified=FALSE WHERE user_id=4');assert.equal((await api(endpoint,4,decision)).status,403);await pool.query('UPDATE doctor_profiles SET credential_verified=TRUE WHERE user_id=4');
 const escalated=await api(endpoint,4,decision);assert.equal(escalated.status,200);assert.equal(escalated.body.request.reviewer_id,4);assert.equal(escalated.body.request.state,'escalated');
 await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES(1,5,CURRENT_DATE,'confirmed')");
 assert.equal((await api(endpoint,5,{...decision,version:2,action:'close'})).status,409);
 await pool.query("INSERT INTO patient_access_controls(mother_id,grantee_type,grantee_ref,state) VALUES(1,'doctor','4','revoked')");assert.equal((await api(endpoint,4,{...decision,version:2,action:'close'})).status,404);assert.equal((await api('doctor/clinical-reviews',4)).body.requests.length,0);
 await pool.query('DELETE FROM patient_access_controls WHERE mother_id=1');assert.equal((await api(endpoint,4,{...decision,version:2,action:'close'})).status,200);assert.equal((await api(endpoint,4,{...decision,version:3,action:'close'})).status,409);
 const list=await api('patient/clinical-reviews');assert.match(list.cache,/no-store/);assert.equal(list.body.requests[0].history.length,3);assert.equal(list.body.requests[0].state,'closed');
 const rec=await api('patient/clinical-reviews',1,{kind:'clinical_recommendation',summary:'Please review my original care-team plan.'});const recUpdate=await api('patient/clinical-reviews',1,{kind:'clinical_recommendation',summary:'Please review my original care-team plan with this updated question.'});assert.equal(rec.body.request.id,recUpdate.body.request.id);assert.equal(recUpdate.body.request.version,2);
 // Legacy automatic assessment now queues review once and never writes a risk label.
 const service=require('./riskService');for(let i=0;i<2;i++)assert.equal((await service.runRiskAssessment(pool,1,{},'auto_log')).status,202);
 assert.equal((await pool.query('SELECT * FROM risk_assessments')).rows.length,0);assert.equal((await pool.query('SELECT risk_level FROM mother_profiles WHERE user_id=1')).rows[0].risk_level,null);
 assert.equal((await pool.query("SELECT * FROM clinical_review_requests WHERE mother_id=1 AND kind='pregnancy_risk' AND state='pending'")).rows.length,1);
 assert.equal((await service.runRiskAssessment(pool,1,{full_history:'private'})).status,400);
 const pending=(await pool.query("SELECT * FROM clinical_review_requests WHERE mother_id=1 AND kind='pregnancy_risk' AND state='pending'")).rows[0];assert.equal(pending.version,2);
 const doc=(await pool.query("INSERT INTO patient_documents(mother_id,title,doc_type,original_filename,mime_type,size_bytes,storage_key) VALUES(1,'Synthetic original','lab_report','fake.pdf','application/pdf',10,'fake-key') RETURNING id")).rows[0].id;
 const documentRequest=await api('patient/clinical-reviews',1,{kind:'document_interpretation',summary:'Interpret the shared original report with a clinician',document_id:doc});assert.equal(documentRequest.status,201);const docId=documentRequest.body.request.id;
 assert.ok(!(await api('doctor/clinical-reviews',4)).body.requests.some(r=>r.id===docId));
 await pool.query('INSERT INTO patient_document_shares(document_id,doctor_id,shared_by) VALUES($1,4,1)',[doc]);
 assert.ok((await api('doctor/clinical-reviews',4)).body.requests.some(r=>r.id===docId));
 await pool.query('UPDATE patient_document_shares SET revoked_at=NOW() WHERE document_id=$1',[doc]);
 assert.equal((await api('doctor/clinical-reviews/'+docId+'/decision',4,{...decision,action:'review_recorded'})).status,404);
 assert.equal((await api('patient/clinical-reviews',1,{kind:'document_interpretation',summary:'Review this original report please',document_id:999})).status,404);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
