'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');

test('reports flow both ways between a patient and her connected, verified clinician',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-report-sharing-'));
 process.env.PATIENT_DOCS_DIR=path.join(dir,'files');await fs.mkdir(process.env.PATIENT_DOCS_DIR,{recursive:true});
 const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs'),registerDocuments=require('./patientDocuments');
 const pool=createLocalPool(dir);let server;
 try{
  for(const name of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
  for(const role of ['mother','mother','doctor','doctor','doctor'])await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'fake',$2)",[role+Math.random()+'@synthetic.invalid',role]);
  for(const id of [1,2])await pool.query("INSERT INTO mother_profiles(user_id,full_name) VALUES($1,$2)",[id,'Synthetic Patient '+id]);
  for(const id of [3,4,5])await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified) VALUES($1,$3,'OBG','SYNTHETIC-ONLY',$2)",[id,id!==5,'Synthetic Clinician '+id]);
  for(const doctor of [3,5])await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES(1,$1,CURRENT_DATE-3,'completed')",[doctor]);
  const app=express();app.use(express.json({limit:'8mb'}));
  registerDocuments(app,{pool,
   authenticateToken(req,res,next){const id=Number(req.headers['x-user']);if(!id)return res.sendStatus(401);req.user={id,role:id<3?'mother':'doctor'};next();},
   authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'Forbidden'})});
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  const base='http://127.0.0.1:'+server.address().port+'/api/';
  const api=async(url,user,body,method)=>{const r=await fetch(base+url,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json','x-user':String(user)},body:body?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t);}catch(_){j=t;}return{status:r.status,body:j,type:r.headers.get('content-type')};};
  const pdf=Buffer.from('%PDF-1.4\n% synthetic test report only\n%%EOF\n');
  const file={filename:'cbc.pdf',mime_type:'application/pdf',content_base64:pdf.toString('base64')};

  // Patient -> doctor: upload, explicit share, doctor lists and downloads the original.
  const mine=await api('documents',1,{title:'Synthetic CBC',doc_type:'lab_report',...file});assert.equal(mine.status,201);const mineId=mine.body.document.id;
  assert.equal(mine.body.document.source,'self_uploaded');
  assert.equal((await api('documents/'+mineId+'/download',3)).status,404);
  assert.equal((await api('documents/'+mineId+'/share',1,{doctor_id:4})).status,403);
  assert.equal((await api('documents/'+mineId+'/share',1,{doctor_id:3})).status,200);
  let list=await api('doctor/documents',3);assert.deepEqual(list.body.documents.map(d=>[d.id,d.uploaded_by_me]),[[mineId,false]]);
  const dl=await api('documents/'+mineId+'/download',3);assert.equal(dl.status,200);assert.equal(dl.type,'application/pdf');

  // Doctor -> patient: only a verified clinician connected to this patient can add a report.
  const report={title:'Synthetic ultrasound summary',doc_type:'scan_imaging',notes:'Synthetic note for the patient.',report_date:'2026-01-05',...file};
  assert.equal((await api('doctor/patients/1/documents',4,report)).status,403);
  assert.equal((await api('doctor/patients/1/documents',5,report)).status,403);
  assert.equal((await api('doctor/patients/2/documents',3,report)).status,403);
  assert.equal((await api('doctor/patients/1/documents',3,{...report,mime_type:'text/html'})).status,400);
  assert.equal((await api('doctor/patients/1/documents',1,report)).status,403);
  const added=await api('doctor/patients/1/documents',3,report);assert.equal(added.status,201);const addedId=added.body.document.id;
  assert.equal(added.body.document.source,'clinician_uploaded');

  // Patient sees the clinician's report, can open it, but cannot delete it.
  const patientList=await api('documents',1);const seen=patientList.body.documents.find(d=>d.id===addedId);
  assert.ok(seen);assert.equal(seen.source,'clinician_uploaded');assert.equal(seen.uploaded_by_name,'Synthetic Clinician 3');assert.equal(seen.can_delete,false);
  assert.equal((await api('documents/'+addedId,1)).body.document.uploaded_by_name,'Synthetic Clinician 3');
  const patientDl=await api('documents/'+addedId+'/download',1);assert.equal(patientDl.status,200);assert.equal(patientDl.type,'application/pdf');assert.match(patientDl.body,/synthetic test report/);
  assert.equal((await api('documents/'+addedId,1,null,'DELETE')).status,403);
  assert.equal((await api('documents/'+addedId,2)).status,404);
  assert.equal((await api('documents/'+addedId+'/download',4)).status,404);
  list=await api('doctor/documents',3);assert.deepEqual(list.body.documents.map(d=>d.id).sort(),[mineId,addedId].sort());
  assert.equal(list.body.documents.find(d=>d.id===addedId).uploaded_by_me,true);
  const events=(await pool.query("SELECT event_type,actor_id FROM patient_document_events WHERE document_id=$1 ORDER BY id",[addedId])).rows;
  assert.deepEqual(events[0],{event_type:'upload',actor_id:3});

  // Revoking the clinician removes their access, including to reports they added; the patient keeps hers.
  await pool.query("INSERT INTO patient_access_controls(mother_id,grantee_type,grantee_ref,state) VALUES(1,'doctor','3','revoked')");
  assert.equal((await api('doctor/documents',3)).body.documents.length,0);
  assert.equal((await api('documents/'+addedId+'/download',3)).status,404);
  assert.equal((await api('doctor/patients/1/documents',3,report)).status,403);
  assert.equal((await api('documents/'+addedId+'/download',1)).status,200);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end?.();await fs.rm(dir,{recursive:true,force:true});}
});
