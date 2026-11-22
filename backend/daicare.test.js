'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { randomUUID,generateKeyPairSync } = require('node:crypto');
const express = require('express');
const { createLocalPool } = require('./localPool');
const { migrations } = require('../scripts/seed-local.cjs');
const { scoreEPDS,priority,optionalReview } = require('./daicareEpds');
const { dispatchWaiting } = require('./daicareWellbeing');
const { approve } = require('../scripts/daicare-directory.cjs');

const minimum = [0,0,3,0,3,3,3,3,3,3];
const concern = minimum.map((v,i)=>i===9 ? 2 : v);
const maximum = minimum.map(n=>3-n);

test('EPDS reverse scoring, threshold and immediate-assessment item',async()=>{
  assert.deepEqual(scoreEPDS(minimum),{score:0,itemTen:0});
  assert.deepEqual(scoreEPDS(maximum),{score:30,itemTen:3});
  assert.deepEqual(scoreEPDS(concern),{score:1,itemTen:1});
  assert.equal(scoreEPDS(Array(10)),null);
  assert.equal(scoreEPDS([0,0]),null);
  assert.equal(priority(12,0),'routine');
  assert.equal(priority(13,0),'follow_up');
  assert.equal(priority(0,1),'urgent');
  assert.equal(await optionalReview({},{}),'unavailable');
  const env = {DAICARE_AI_ENABLED:'true',GEMINI_API_KEY:'synthetic-only',DAICARE_AI_MODEL:'gemini-test-model'};
  assert.equal(await optionalReview(env,{score:14},async (_url,config)=>{
    assert.equal(config.headers['x-goog-api-key'],'synthetic-only');
    assert.match(JSON.parse(config.body).contents[0].parts[0].text,/"score":14/);
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'"review"'}]}}]})};
  }),'review');
  assert.equal(await optionalReview(env,{},async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'"diagnosis"'}]}}]})})),'unavailable');
});

test('DaiCare discovery, bookings, bounded calls, private consent and verified on-call assignments', {timeout:45000}, async t=>{
  process.env.CONSENT_AUDIT_KEY='synthetic-daicare-audit-key-for-tests';
  process.env.CONSENT_RECEIPT_PRIVATE_KEY=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'daicare-test-'));
  const pool=process.env.DAICARE_TEST_DATABASE_URL
    ? new (require('pg').Pool)({connectionString:process.env.DAICARE_TEST_DATABASE_URL})
    : createLocalPool(path.join(temp,'db'));
  let server;
  t.after(async()=>{
    if(server){const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
    await pool.end();
    await fs.rm(temp,{recursive:true,force:true});
  });
  for(const file of migrations) await pool.query(await fs.readFile(path.join(__dirname,'db',file),'utf8'));
  async function account(role,name) {
    const {rows}=await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'synthetic',$2) RETURNING id",[name+'@example.invalid',role]);
    const id=rows[0].id;
    if(role==='doctor') await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number) VALUES($1,$2,'Psychiatry',$2)",[id,name]);
    else await pool.query('INSERT INTO mother_profiles(user_id,full_name) VALUES($1,$2)',[id,name]);
    return {id,role};
  }
  const patient=await account('mother','Patient P'), other=await account('mother','Patient Q');
  const clinician=await account('doctor','Clinician R'), unknown=await account('doctor','Unverified clinician');
  const config=path.join(temp,'profile.json');
  await fs.writeFile(config,JSON.stringify({registration_number:'Clinician R',council:'Test council',qualification:'Synthetic MD',
    city:'Mumbai',state:'Maharashtra',public_contact:'test@example.invalid',languages:['Hindi'],
    pincodes:['400001'],modes:['home','audio','video'],mental_health:true,verification_ref:'SYNTHETIC TEST ONLY'}));
  await approve(pool,clinician.id,config);

  const app=express();
  app.use(express.json());
  const actors=[patient,other,clinician,unknown];
  const authenticateToken=(req,res,next)=>{
    req.user=actors.find(actor=>actor.id===Number(req.get('x-test-user')));
    if(!req.user)return res.sendStatus(401);
    next();
  };
  const authorizeRole=roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403);
  const env={DAICARE_AI_ENABLED:'true',DAICARE_AI_MODEL:'gemini-test-model',GEMINI_API_KEY:'synthetic-only'};
  let transmitted;
  require('./daicare')(app,{pool,authenticateToken,authorizeRole,env,fetchImpl:async(_url,opts)=>{
    transmitted=opts.body;
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'"review"'}]}}]})};
  }});
  require('./accessControl')(app,{pool,authenticateToken,authorizeRole});
  require('./clinicalDashboard')(app,{pool,authenticateToken,authorizeRole});
  require('./notifications')(app,{pool,authenticateToken});
  server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  async function request(user,url,method='GET',body) {
    const r=await fetch(base+'/api'+url,{method,headers:{'x-test-user':String(user?.id||0),'content-type':'application/json'},
      body:body?JSON.stringify(body):undefined});
    const data=await r.json().catch(()=>null);
    return {status:r.status,data};
  }
  const send=(user,url,method,body)=>request(user,'/daicare'+url,method,body);
  const expect=async(promise,status)=>{
    const result=await promise;
    assert.equal(result.status,status,JSON.stringify(result.data));
    return result.data;
  };

  await expect(send(null,'/directory'),401);
  const listed=await expect(send(patient,'/directory?mode=home&pin=400001&state=Maharashtra&q=psychiatry'),200);
  assert.deepEqual(listed.doctors.map(d=>d.doctor_id),[clinician.id]);
  assert.equal('verification_ref' in listed.doctors[0],false);
  assert.equal((await expect(send(patient,'/directory?mode=home&pin=110001'),200)).doctors.length,0);
  await expect(send(patient,'/directory?mode=home'),400);
  const future=new Date((Math.ceil(Date.now()/1800000)+3)*1800000).toISOString();
  await expect(send(unknown,'/schedule','POST',{starts_at:future,mode:'home'}),403);
  const {slot}=await expect(send(clinician,'/schedule','POST',{starts_at:future,mode:'home'}),201);
  await expect(send(clinician,'/schedule','POST',{starts_at:future,mode:'audio'}),409);
  assert.equal((await expect(send(patient,'/doctors/'+clinician.id+'/slots?mode=home&pin=400001'),200)).slots[0].id,slot.id);
  const booking={slot_id:slot.id,consent:true,pin:'400001',address:'Synthetic test home address'};
  await expect(send(patient,'/visits','POST',{...booking,consent:false}),400);
  await expect(send(patient,'/visits','POST',{...booking,pin:'110001'}),400);
  const simultaneous=await Promise.all([send(patient,'/visits','POST',booking),send(patient,'/visits','POST',booking)]);
  assert.deepEqual(simultaneous.map(x=>x.status).sort(),[201,409]);
  const visit=simultaneous.find(r=>r.status===201).data.visit;
  const visitUrl='/visits/'+visit.id;
  await expect(send(other,visitUrl),404);
  const before=await expect(send(clinician,'/visits'),200);
  assert.equal(before.visits[0].address,null);
  await expect(request(clinician,'/doctor/patients/'+patient.id+'/dashboard'),403);
  await expect(send(clinician,visitUrl,'PATCH',{action:'confirm'}),200);
  assert.equal((await expect(send(clinician,'/visits'),200)).visits[0].address,booking.address);
  await expect(request(clinician,'/doctor/patients/'+patient.id+'/dashboard'),403);
  await expect(request(patient,'/patient/dashboard/consent','PUT',{doctor_id:clinician.id,allow:true,confirmed:true}),200);
  await expect(request(clinician,'/doctor/patients/'+patient.id+'/dashboard'),200);
  await expect(request(clinician,'/doctor/patients/'+patient.id+'/dashboard/entries','POST',{}),403);
  await expect(send(patient,visitUrl+'/signals'),409);
  await expect(send(patient,visitUrl,'PATCH',{action:'cancel'}),200);
  await expect(send(clinician,visitUrl),404);
  await expect(request(clinician,'/doctor/patients/'+patient.id+'/dashboard'),403);

  const remote=(await expect(send(clinician,'/schedule','POST',{starts_at:future,mode:'video'}),409));
  assert.match(remote.error,/slot/);
  const otherTime=new Date(+new Date(future)+1800000).toISOString();
  const videoSlot=(await expect(send(clinician,'/schedule','POST',{starts_at:otherTime,mode:'video'}),201)).slot;
  const video=(await expect(send(patient,'/visits','POST',{slot_id:videoSlot.id,consent:true}),201)).visit;
  const call='/visits/'+video.id;
  await expect(send(clinician,call,'PATCH',{action:'confirm'}),200);
  await expect(send(patient,call+'/signals'),409);
  await pool.query("UPDATE daicare_slots SET starts_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[videoSlot.id]);
  await expect(send(patient,call+'/signals','POST',{type:'offer',payload:{sdp:'test'}}),400);
  await expect(send(clinician,call+'/signals','POST',{type:'offer',payload:{sdp:'test'}}),200);
  const signals=await expect(send(patient,call+'/signals'),200);
  assert.equal(signals.mode,'video');
  assert.equal(signals.signals[0].type,'offer');
  const tomorrow=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  await expect(send(clinician,call,'PATCH',{action:'complete',follow_up_on:tomorrow,follow_up:'Book the agreed follow-up.'}),200);
  await expect(send(patient,call+'/signals'),409);
  await expect(send(patient,call,'PATCH',{action:'acknowledge_follow_up'}),200);
  const followed=(await expect(send(patient,'/visits'),200)).visits.find(row=>row.follow_up==='Book the agreed follow-up.');
  assert.ok(followed.follow_up_seen_at);

  await expect(send(patient,'/wellbeing/mood','POST',{mood:2}),201);
  await expect(send(patient,'/wellbeing/mood','POST',{mood:3}),201);
  const wellness=await expect(send(patient,'/wellbeing'),200);
  assert.equal(wellness.due,false);
  assert.deepEqual(wellness.check_ins.map(x=>x.mood),[3]);
  await expect(send(patient,'/wellbeing/epds','POST',{answers:minimum}),400);
  const quiet=(await expect(send(patient,'/wellbeing/epds','POST',{answers:minimum,postpartum:true}),201)).screen;
  const urgent=(await expect(send(patient,'/wellbeing/epds','POST',{answers:concern,postpartum:true}),201)).screen;
  assert.equal(urgent.priority,'urgent');
  assert.equal((await expect(send(other,'/wellbeing'),200)).screens.length,0);
  await expect(send(patient,'/wellbeing/epds/'+urgent.id+'/ai-review','POST',{consent:true}),409);
  await expect(send(patient,'/wellbeing/epds/'+quiet.id+'/ai-review','POST',{consent:false}),400);
  assert.equal((await expect(send(patient,'/wellbeing/epds/'+quiet.id+'/ai-review','POST',{consent:true}),200)).ai_status,'review');
  assert.doesNotMatch(transmitted,/Patient P|full_name|answers/);
  const referral='/wellbeing/epds/'+urgent.id+'/referral';
  const queue='/mental-health/referrals';
  await expect(send(patient,referral,'POST',{consent:false}),400);
  const wait=await expect(send(patient,referral,'POST',{consent:true}),202);
  assert.equal(wait.status,'waiting');
  await expect(send(unknown,queue),403);
  await pool.query("INSERT INTO daicare_on_call(id,doctor_id,starts_at,ends_at) VALUES($1,$2,clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '1 hour')",[randomUUID(),clinician.id]);
  await dispatchWaiting(pool);
  const {referrals}=await expect(send(clinician,queue),200);
  assert.deepEqual(referrals.map(row=>row.id),[urgent.id]);
  assert.equal(referrals[0].answers,undefined);
  assert.equal(referrals[0].patient_name,'Patient P');
  const alerts=await expect(request(clinician,'/notifications'),200);
  const alert=alerts.notifications.find(n=>n.title==='New DaiCare on-call referral');
  assert.equal(alert.severity,'danger');
  assert.doesNotMatch(JSON.stringify(alert),/Patient P/);
  await expect(send(clinician,queue+'/'+urgent.id,'PATCH',{action:'acknowledge'}),200);
  await expect(send(clinician,queue+'/'+urgent.id,'PATCH',{action:'resolve',note:'Call the clinic for follow-up.'}),200);
  await expect(send(patient,referral,'DELETE'),204);
  assert.equal((await expect(send(clinician,queue),200)).referrals.length,0);
  await expect(send(clinician,queue+'/'+urgent.id,'PATCH',{action:'acknowledge'}),404);
  const receipts=(await pool.query("SELECT event_type,actor_id FROM consent_audit_events WHERE mother_id=$1 AND event_type LIKE 'daicare_%'",[patient.id])).rows;
  assert.ok(receipts.some(r=>r.event_type==='daicare_wellbeing_revoked'&&r.actor_id===patient.id));
  assert.ok(receipts.some(r=>r.event_type==='daicare_wellbeing_acknowledged'&&r.actor_id===clinician.id));
  await expect(request(patient,'/patient/access/doctor/'+clinician.id,'PUT',{state:'revoked'}),200);
  assert.equal((await expect(send(clinician,'/visits'),200)).visits.length,0);
});
