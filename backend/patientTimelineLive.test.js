'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
const Flow=require('./careStepMachine'),{createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs');
test('XState prevents skipped review, patient confirmation, missing evidence and terminal overwrites',()=>{
 assert.equal(Flow.transition('planned',{type:'REPORT',owner:true}),'patient_reported');
 assert.throws(()=>Flow.transition('planned',{type:'REPORT',owner:false}));
 assert.throws(()=>Flow.transition('planned',{type:'CONFIRM',authorised:true,evidence:true}));
 assert.throws(()=>Flow.transition('patient_reported',{type:'EVIDENCE',owner:true,evidence:false}));
 assert.throws(()=>Flow.transition('awaiting_review',{type:'CONFIRM',authorised:false,evidence:true}));
 assert.throws(()=>Flow.transition('awaiting_review',{type:'CONFIRM',authorised:true,evidence:false}));
 assert.equal(Flow.transition('awaiting_review',{type:'CONFIRM',authorised:true,evidence:true}),'clinician_confirmed');
 assert.throws(()=>Flow.transition('clinician_confirmed',{type:'EVIDENCE',owner:true,evidence:true}));
});
test('real upload, guarded doctor review and authenticated SSE stay scoped; guided assistance is draft-only',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-step-test-')),pool=createLocalPool(path.join(dir,'db')),aborters=[];let server;
 const saved=process.env.PATIENT_DOCS_DIR;process.env.PATIENT_DOCS_DIR=path.join(dir,'files');delete require.cache[require.resolve('./patientDocuments')];
 try{
  for(const f of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',f),'utf8'));
  for(const [id,role] of [[1,'mother'],[2,'mother'],[3,'doctor']])await pool.query("INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,'fake',$3)",[id,id+'@synthetic.invalid',role]);
  await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,facility_name,credential_verified) VALUES(3,'SYNTHETIC Clinician','OBG','NMC-FAKE-123','SYNTHETIC Centre',TRUE)");
  await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES(1,3,CURRENT_DATE,'confirmed')");
  const step=(await pool.query("INSERT INTO care_milestones(mother_id,stage,category,title,guidance,due_date,sort_order) VALUES(1,'T2','pregnancy','OGTT appointment','Recorded care-team instruction',CURRENT_DATE,1) RETURNING *")).rows[0];
  const app=express();app.use(express.json());const opts={pool,intervalMs:40,authenticateToken(req,res,next){const id=Number(req.headers['x-user']);if(![1,2,3].includes(id))return res.sendStatus(401);req.user={id,role:id===3?'doctor':'mother',exp:req.headers['x-exp']?Number(req.headers['x-exp']):Math.floor(Date.now()/1000)+60};next();},authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)};
  require('./patientTimelineLive')(app,opts);require('./patientDocuments')(app,opts);
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+server.address().port+'/api';
  const call=async(url,user=1,body,method=body?'POST':'GET')=>{const r=await fetch(base+url,{method,headers:{'x-user':String(user),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
  assert.equal((await call('/patient/timeline/events',0)).status,401);assert.equal((await call('/patient/timeline/events',3)).status,403);
  async function stream(user,extra={}){const controller=new AbortController();aborters.push(controller);const r=await fetch(base+'/patient/timeline/events',{headers:{'x-user':String(user),...extra},signal:controller.signal});assert.match(r.headers.get('content-type'),/text\/event-stream/);return {reader:r.body.getReader(),controller};}
  async function until(s,text){let out='';const timeout=setTimeout(()=>s.controller.abort(),4000);try{while(!out.includes(text)){const {value,done}=await s.reader.read();if(done)break;out+=new TextDecoder().decode(value);}assert.ok(out.includes(text),out);return out;}finally{clearTimeout(timeout);}}
  const a=await stream(1),b=await stream(2);assert.doesNotMatch(await until(a,'event: ready'),/OGTT|instruction/);await until(b,'event: ready');
  const upload=await call('/documents',1,{title:'Synthetic OGTT file',doc_type:'lab_report',mime_type:'application/pdf',filename:'synthetic.pdf',content_base64:Buffer.from('%PDF-1.4\n% Synthetic test file\n%%EOF').toString('base64'),milestone_id:step.id});assert.equal(upload.status,201);const doc=upload.body.document.id;
  assert.deepEqual((await pool.query('SELECT to_state FROM care_step_events ORDER BY id')).rows.map(r=>r.to_state),['evidence_submitted','awaiting_review']);
  await until(a,'event: timeline-changed');assert.doesNotMatch(await until(b,'heartbeat'),/timeline-changed/);
  assert.equal((await call('/documents/'+doc+'/review',1,{doctor_note:'Patient cannot confirm'},'PATCH')).status,403);
  assert.equal((await call('/documents/'+doc+'/review',3,{doctor_note:'Not shared'},'PATCH')).status,404);
  await call('/documents/'+doc+'/share',1,{doctor_id:3});
  assert.equal((await call('/documents/'+doc+'/review',3,{doctor_note:'Reviewed original synthetic report'},'PATCH')).status,200);
  const change=await until(a,'event: timeline-changed');assert.doesNotMatch(change,/report|OGTT/);
  assert.equal(Flow.stateOf((await pool.query('SELECT * FROM care_milestones WHERE id=$1',[step.id])).rows[0]),'clinician_confirmed');
  assert.equal((await pool.query('SELECT to_state FROM care_step_events ORDER BY id DESC LIMIT 1')).rows[0].to_state,'clinician_confirmed');
  const reconnected=await stream(1);await until(reconnected,'event: ready');
  const expired=await stream(1,{'x-exp':'1'});await until(expired,'event: session-ended');
  const before=(await pool.query('SELECT COUNT(*)::int AS n FROM appointments')).rows[0].n;
  const assist=await call('/patient/timeline/'+step.id+'/assist',1,{});assert.equal(assist.status,200);assert.equal(assist.body.requires_confirmation,true);assert.equal(assist.body.draft.milestone_id,step.id);assert.equal(assist.body.source,'rules');assert.equal(assist.body.questions.length,3);assert.equal('probability' in assist.body,false);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM appointments')).rows[0].n,before);
  assert.equal((await call('/patient/timeline/'+step.id+'/assist',2,{})).status,404);assert.equal((await call('/patient/timeline/'+step.id+'/assist',3,{})).status,403);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM care_step_assistance_log')).rows[0].n,1);
  await pool.query('UPDATE patient_document_shares SET revoked_at=NOW() WHERE document_id=$1',[doc]);assert.equal((await call('/documents/'+doc+'/review',3,{doctor_note:'Access revoked'},'PATCH')).status,404);
 }finally{aborters.forEach(c=>c.abort());if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool.end();await fs.rm(dir,{recursive:true,force:true});if(saved===undefined)delete process.env.PATIENT_DOCS_DIR;else process.env.PATIENT_DOCS_DIR=saved;}
});
