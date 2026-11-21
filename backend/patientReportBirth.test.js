'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),express=require('express');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs');
const {patientCandidates}=require('./patientReportBirth');
test('patient extraction only uses printed reference ranges; missing units stay missing',()=>{
 const x=patientCandidates('Lab report\n2026-11-01\nHb 11.2 g/dL Reference range: 10.0–14.0\nGlucose 92\nPlatelets 220 Reference: 150-450');
 assert.equal(x.observations[0].reference_range,'10.0–14.0');assert.equal(x.observations[1].reference_range,'');assert.equal(x.observations[1].unit,'');assert.equal(x.observations[2].unit,'');assert.equal(x.report_date,'2026-11-01');
});
test('private previews, explicit confirmation, provenance, source integrity and versioned birth plans',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-report-birth-')),pool=createLocalPool(path.join(dir,'db'));let server;const prev=process.env.PATIENT_DOCS_DIR;process.env.PATIENT_DOCS_DIR=path.join(dir,'files');
 try{
  for(const migration of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',migration),'utf8'));
  for(const [email,role]of [['mother@synthetic.invalid','mother'],['other@synthetic.invalid','mother'],['doctor@synthetic.invalid','doctor']])await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'test-only',$2)",[email,role]);
  const app=express();app.use(express.json());const options={pool,authenticateToken(req,res,next){req.user={id:Number(req.headers['x-user']),role:req.headers['x-user']==='3'?'doctor':'mother'};next();},authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)};
  delete require.cache[require.resolve('./patientDocuments')];require('./patientDocuments')(app,options);
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const call=async(url,user=1,method='GET',body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api'+url,{method,headers:{'content-type':'application/json','x-user':String(user)},body:body?JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null};};
  const uploaded=await call('/documents',1,'POST',{title:'Synthetic lab',doc_type:'lab_report',mime_type:'image/heic',filename:'report.heic',content_base64:Buffer.from('Synthetic manual transcription fixture').toString('base64')});assert.equal(uploaded.status,201);const id=uploaded.data.document.id;
  const preview=await call('/documents/'+id+'/patient-preview',1,'POST',{});assert.equal(preview.status,200);assert.equal((await pool.query('SELECT COUNT(*)::int n FROM patient_report_entries')).rows[0].n,0);assert.equal((await pool.query('SELECT COUNT(*)::int n FROM document_intake_drafts')).rows[0].n,0);
  assert.equal((await call('/documents/'+id+'/patient-preview',2,'POST',{})).status,404);assert.equal((await call('/documents/'+id+'/patient-preview',3,'POST',{})).status,403);
  const b={source_sha256:preview.data.source_sha256,report_date:'2026-11-01',confirm_source:true,observations:[{label:'Hb',value:'11.2',unit:'g/dL',reference_range:'10-14',confirmed:true}]};
  assert.equal((await call('/documents/'+id+'/patient-confirm',1,'POST',{...b,confirm_source:false})).status,400);assert.equal((await call('/documents/'+id+'/patient-confirm',2,'POST',b)).status,404);
  assert.equal((await call('/documents/'+id+'/patient-confirm',1,'POST',{...b,report_date:'2026-02-30'})).status,400);
  assert.equal((await call('/documents/'+id+'/patient-confirm',1,'POST',{...b,observations:[{...b.observations[0],unit:''}]})).status,400);
  assert.equal((await call('/documents/'+id+'/patient-confirm',1,'POST',b)).status,201);assert.equal((await call('/documents/'+id+'/patient-confirm',1,'POST',b)).status,409);
  const entries=(await call('/patient/report-timeline')).data.entries;assert.equal(entries.length,1);assert.equal(entries[0].source,'patient_confirmed');assert.equal(entries[0].clinical_verification,false);assert.equal((await call('/patient/report-timeline',2)).data.entries.length,0);
  assert.equal((await pool.query('SELECT verification_status FROM patient_documents WHERE id=$1',[id])).rows[0].verification_status,'pending');
  await pool.query('UPDATE patient_documents SET is_sensitive=TRUE WHERE id=$1',[id]);assert.equal((await call('/patient/report-timeline')).data.entries.length,0);assert.equal((await call('/documents/'+id+'/patient-preview',1,'POST',{})).status,403);assert.equal((await call('/patient/report-timeline?reveal=1')).data.entries.length,1);
  const storage=(await pool.query('SELECT storage_key FROM patient_documents WHERE id=$1',[id])).rows[0].storage_key;await fs.writeFile(path.join(process.env.PATIENT_DOCS_DIR,storage),'Changed file');assert.equal((await call('/documents/'+id+'/patient-confirm?reveal=1',1,'POST',{...b,report_date:'2026-11-02'})).status,409);
  const pdf=await fs.readFile(path.join(__dirname,'../scripts/fixtures/nivara-records/nivara-lab_report-2026-06-22.pdf'));
  const uploadedPDF=await call('/documents',1,'POST',{title:'Synthetic printed PDF',doc_type:'lab_report',mime_type:'application/pdf',filename:'printed.pdf',content_base64:pdf.toString('base64')});assert.equal(uploadedPDF.status,201);
  const pdfPreview=await call('/documents/'+uploadedPDF.data.document.id+'/patient-preview',1,'POST',{});assert.equal(pdfPreview.status,200);assert.equal(pdfPreview.data.candidates.report_date,'2026-06-22');assert.equal(pdfPreview.data.candidates.observations[0].value,'10.6');assert.equal(pdfPreview.data.candidates.observations[0].reference_range,'');
  assert.equal((await call('/patient/birth-plan')).data.plan.version,0);assert.equal((await call('/patient/birth-plan',3)).status,403);
  const saved=await call('/patient/birth-plan',1,'PUT',{version:0,preferences:{facility:'Chosen centre',emergency_name:'My contact',emergency_phone:'1234567890'}});assert.equal(saved.status,200);assert.equal(saved.data.plan.version,1);
  assert.equal((await call('/patient/birth-plan',2)).data.plan.version,0);assert.equal((await call('/patient/birth-plan',1,'PUT',{version:0,preferences:{}})).status,409);assert.equal((await call('/patient/birth-plan',1,'PUT',{version:1,preferences:{unknown:'bad'}})).status,400);
  assert.equal((await call('/patient/birth-plan',1,'PUT',{version:1,preferences:{facility:'Updated preference'}})).data.plan.version,2);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await fs.rm(dir,{recursive:true,force:true});if(prev===undefined)delete process.env.PATIENT_DOCS_DIR;else process.env.PATIENT_DOCS_DIR=prev;}
});
