'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),express=require('express');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs'),{register,createService}=require('./recordConnections');
const fixtures=require('../scripts/fixtures/record-connection-demo.cjs');
test('demo provider records require patient-specific consent, expire and revoke immediately, and never grant ABHA-number access',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-connected-records-')),pool=createLocalPool(path.join(dir,'db'));let server;
 try{
  for(const name of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
  const add=async(email,role)=>(await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,\'fake\',$2) RETURNING id',[email,role])).rows[0].id;
  const mother=await add('nivara@dai-synthetic.invalid','mother'),doctor=await add('doctor@dai-synthetic.invalid','doctor'),other=await add('other@dai-synthetic.invalid','mother'),outsider=await add('outside@dai-synthetic.invalid','doctor');
  await pool.query("INSERT INTO mother_profiles(user_id,full_name) VALUES($1,'Nivara Sethi'),($2,'Other mother')",[mother,other]);
  for(const id of [doctor,outsider])await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified) VALUES($1,'SYNTHETIC Hemangini Batra','OBG','DEMO-ONLY',TRUE)",[id]);
  await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,CURRENT_DATE,'confirmed')",[mother,doctor]);
  await pool.query('CREATE TABLE dai_local_source_link(entity TEXT,target_id INTEGER,source_id TEXT)');await pool.query("INSERT INTO dai_local_source_link VALUES('mother',$1,'MOTHER-SYN-0000001')",[mother]);
  const env={DAI_LOCAL:'true',DAI_DEMO:'true',DAI_RECORD_CONNECTIONS_KEY:'31'.repeat(32)};
  const app=express();app.use(express.json());register(app,{pool,env,authenticateToken(req,res,next){if(!req.headers['x-user'])return res.sendStatus(401);const id=Number(req.headers['x-user']);req.user={id,role:[doctor,outsider].includes(id)?'doctor':'mother'};next();},authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)});
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});const base='http://127.0.0.1:'+server.address().port+'/api';
  async function call(url,user=mother,method='GET',body){const r=await fetch(base+url,{method,headers:{...(user?{'x-user':String(user)}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const type=r.headers.get('content-type')||'';return {status:r.status,cache:r.headers.get('cache-control'),body:type.includes('application/json')?await r.json():await r.text()};}
  const own='/patient/record-connections',doc='/doctor/patients/'+mother+'/record-connections';
  assert.equal((await call(own,null)).status,401);assert.equal((await call(own,doctor)).status,403);
  assert.equal((await call(doc,outsider)).status,403);
  const start=await call(own);assert.equal(start.body.demo_available,true);assert.equal(start.body.live_connected,false);assert.equal(start.body.identity.status,'not_added');assert.match(start.cache,/no-store/);
  assert.equal((await call(own+'/identity',mother,'PUT',{abha_number:'123',confirmed:true})).status,400);
  // Test-only, deliberately unverified 14-digit value. Never transmitted to a provider.
  const entered='12345678901234';assert.equal((await call(own+'/identity',mother,'PUT',{abha_number:entered,confirmed:true})).status,200);
  let self=(await call(own)).body;assert.equal(self.identity.status,'unverified');assert.ok(!JSON.stringify(self).includes(entered));assert.equal((await call(doc,doctor)).body.identity.status,'not_shared');
  let stored=(await pool.query('SELECT * FROM record_connection_identities WHERE mother_id=$1',[mother])).rows[0];assert.ok(!JSON.stringify(stored).includes(entered));
  assert.equal((await call(own+'/identity',mother,'PUT',{demo:true,confirmed:true})).status,200);
  assert.equal((await call(own+'/abdm/demo-link',other,'POST',{confirmed_demo:true,record_ids:[fixtures[0].provider_record_id]})).status,403);
  for(const provider of ['abdm','digilocker']){
   const ids=fixtures.filter(f=>f.provider===provider).map(f=>f.provider_record_id);
   assert.equal((await call(own+'/'+provider+'/demo-link',mother,'POST',{confirmed_demo:true,record_ids:ids})).status,200);
   const sync=await call(own+'/'+provider+'/sync',mother,'POST');assert.equal(sync.status,200,JSON.stringify(sync.body));assert.equal(sync.body.imported,ids.length);
   assert.equal((await call(own+'/'+provider+'/sync',mother,'POST')).body.imported,0);
  }
  self=(await call(own)).body;assert.equal(self.records.length,5);assert.ok(self.records.every(r=>r.demo&&r.verification_status==='pending'));assert.equal((await call(doc,doctor)).body.records.length,0);
  const report=self.records[0],url=own+'/records/'+report.record_id+'/original',docUrl=doc+'/records/'+report.record_id+'/original';
  assert.equal((await call(url)).status,200);assert.equal((await call(url,other)).status,404);assert.equal((await call(docUrl,doctor)).status,403);
  const encrypted=(await pool.query('SELECT payload_cipher FROM connected_records WHERE id=$1',[report.record_id])).rows[0].payload_cipher;assert.ok(!JSON.stringify(encrypted).includes('%PDF'));assert.ok(!JSON.stringify(encrypted).includes('Nivara'));
  const scope={providers:['abdm','digilocker'],categories:['lab_report','scan_imaging','discharge_summary'],from_date:'2024-01-01',to_date:'2026-11-25',purpose:'Consultation and follow-up',days:7};
  const request=await call(doc+'/consent-requests',doctor,'POST',scope);assert.equal(request.status,200,JSON.stringify(request.body));const id=request.body.id;
  assert.equal((await call(doc,doctor)).body.records.length,0);
  assert.equal((await call(own+'/consents/'+id+'/approve',other,'POST',{confirmed:true})).status,404);
  assert.equal((await call(own+'/consents/'+id+'/approve',mother,'POST',{confirmed:true,days:30})).status,400);
  assert.equal((await call(own+'/consents/'+id+'/approve',mother,'POST',{confirmed:true})).status,200);
  assert.equal((await call(doc,doctor)).body.records.length,5);
  const file=await call(docUrl,doctor);assert.equal(file.status,200);assert.ok(file.body.startsWith('%PDF-'));
  assert.equal((await call(doc+'/sync',doctor,'POST')).body.imported,0);
  const issued=(await pool.query('SELECT * FROM record_connection_consents WHERE id=$1',[id])).rows[0];assert.equal(issued.created_by,doctor);assert.ok(issued.granted_at);
  await pool.query("UPDATE record_connection_consents SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[id]);assert.equal((await call(docUrl,doctor)).status,403);assert.equal((await call(doc,doctor)).body.records.length,0);
  // A fresh, narrowed grant exposes only the older CBC and not the prior birth or scan.
  const narrow=await call(own+'/consents',mother,'POST',{...scope,providers:['abdm'],categories:['lab_report'],from_date:'2026-11-01',confirmed:true,doctor_id:doctor});assert.equal(narrow.status,200,JSON.stringify(narrow.body));
  const allowed=(await call(doc,doctor)).body.records;assert.equal(allowed.length,1);assert.equal(allowed[0].external_reference,'DEMO-PATH-CBC-20261116');
  const cbcUrl=doc+'/records/'+allowed[0].record_id+'/original';assert.equal((await call(cbcUrl,doctor)).status,200);
  assert.equal((await call(own+'/consents/'+narrow.body.id,mother,'DELETE')).status,200);assert.equal((await call(cbcUrl,doctor)).status,403);
  // Existing patient-wide revocation overrides even an approved connected-record scope.
  const grant=await call(own+'/consents',mother,'POST',{...scope,confirmed:true,doctor_id:doctor});assert.equal(grant.status,200);
  await pool.query("INSERT INTO patient_access_controls(mother_id,grantee_type,grantee_ref,state) VALUES($1,'doctor',$2,'revoked')",[mother,String(doctor)]);
  assert.equal((await call(doc,doctor)).status,403);assert.equal((await call(docUrl,doctor)).status,403);
  await pool.query('DELETE FROM patient_access_controls WHERE mother_id=$1',[mother]);
  assert.equal((await call(own+'/abdm',mother,'DELETE')).status,200);assert.equal((await call(doc,doctor)).body.records.length,0);assert.equal((await call(docUrl,doctor)).status,403);
  assert.equal((await call(own)).body.records.length,5); // Revoking clinician access does not erase the patient's originals.
  const standalone=createService(pool,{env:{...env,DAI_LOCAL:'false'}});await assert.rejects(()=>standalone.sync(mother,mother),/Live government retrieval is not connected/);
  assert.equal((await pool.query('SELECT * FROM patient_document_shares')).rows.length,0);assert.equal((await pool.query('SELECT * FROM clinical_dashboard_consent')).rows.length,0);assert.equal((await pool.query('SELECT * FROM care_milestones')).rows.length,0);
  assert.ok((await pool.query("SELECT * FROM record_connection_events WHERE event_type='original_report_opened'")).rows.length);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
