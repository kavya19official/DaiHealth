'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildReadiness,CATALOGUE}=require('./birthReadiness');

test('birth readiness opens at week 28 and reflects only patient-recorded checklist state',()=>{
  const before=buildReadiness({lmp_date:'2026-05-01',pregnancy_status:'pregnant'},[],'2026-11-12');
  assert.equal(before.week,27);assert.equal(before.eligible,false);assert.equal(before.completed,0);assert.equal(before.total,7);
  const active=buildReadiness({lmp_date:'2026-05-01',pregnancy_status:'pregnant'},[
    {item_key:'facility_selected',completed:true},{item_key:'documents_ready',completed:true}
  ],'2026-11-20');
  assert.equal(active.week,29);assert.equal(active.eligible,true);assert.equal(active.completed,2);assert.equal(active.percent,29);
  assert.equal(active.next_action.key,'transport_arranged');assert.equal(active.next,'Transport arranged');
  assert.ok(active.items.every(item=>item.confirmable&&item.can_confirm));
});

test('birth readiness is a fixed allowlisted preparation catalogue, not a clinical score',()=>{
  assert.deepEqual(CATALOGUE.map(item=>item.key),[
    'facility_selected','transport_arranged','emergency_contact','blood_support',
    'documents_ready','danger_signs_understood','benefits_started'
  ]);
  const delivered=buildReadiness({lmp_date:'2026-01-01',pregnancy_status:'delivered'},[],'2026-11-20');
  assert.equal(delivered.eligible,false);assert.match(delivered.caution,/does not predict/i);assert.match(delivered.methodology,/not a clinical score/i);
});

const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),express=require('express');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs');
test('patient updates persist and only a verified connected doctor with active consent gets a read-only view',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-birth-readiness-')),pool=createLocalPool(dir);let server;
  try{
    for(const name of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
    const ids=[];for(const role of ['mother','doctor','doctor'])ids.push((await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id',[role+ids.length+'@dai-synthetic.invalid','fake',role])).rows[0].id);
    const [mother,doctor,unrelated]=ids;
    await pool.query("INSERT INTO mother_profiles(user_id,full_name,care_start_date,lmp_date,pregnancy_status) VALUES($1,'SYNTHETIC Mother',CURRENT_DATE-210,CURRENT_DATE-210,'pregnant')",[mother]);
    for(const id of [doctor,unrelated])await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified) VALUES($1,'SYNTHETIC Clinician','OBG','NMC-FAKE-TEST',TRUE)",[id]);
    await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,CURRENT_DATE,'confirmed')",[mother,doctor]);
    const app=express();app.use(express.json());
    const authenticateToken=(req,res,next)=>{const id=Number(req.headers['x-user']);if(!ids.includes(id))return res.sendStatus(401);req.user={id,role:id===mother?'mother':'doctor'};next();};
    const authorizeRole=roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403);
    require('./birthReadiness').register(app,{pool,authenticateToken,authorizeRole});
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base='http://127.0.0.1:'+server.address().port+'/api';
    async function call(url,user=mother,method='GET',body){const r=await fetch(base+url,{method,headers:{'x-user':String(user),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null,cache:r.headers.get('cache-control')};}
    let own=await call('/patient/birth-readiness');assert.equal(own.status,200);assert.equal(own.cache,'no-store');assert.equal(own.data.readiness.eligible,true);assert.equal(own.data.readiness.completed,0);
    assert.equal((await call('/patient/birth-readiness/items/not-real',mother,'PUT',{complete:true})).status,400);
    assert.equal((await call('/patient/birth-readiness/items/facility_selected',mother,'PUT',{complete:'yes'})).status,400);
    own=await call('/patient/birth-readiness/items/facility_selected',mother,'PUT',{complete:true});assert.equal(own.status,200);assert.equal(own.data.readiness.completed,1);
    assert.equal((await call('/doctor/patients/'+mother+'/birth-readiness',doctor)).status,403);
    assert.equal((await call('/doctor/patients/'+mother+'/birth-readiness',unrelated)).status,403);
    await pool.query("INSERT INTO clinical_dashboard_consent(mother_id,doctor_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days')",[mother,doctor]);
    const shared=await call('/doctor/patients/'+mother+'/birth-readiness',doctor);assert.equal(shared.status,200);assert.equal(shared.data.read_only,true);assert.equal(shared.data.readiness.completed,1);
    assert.equal((await call('/patient/birth-readiness',doctor)).status,403);
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM birth_readiness_events WHERE mother_id=$1 AND event_type='item_updated'",[mother])).rows[0].n,1);
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM birth_readiness_events WHERE mother_id=$1 AND event_type='doctor_view'",[mother])).rows[0].n,1);
  }finally{await new Promise(resolve=>server?server.close(resolve):resolve());await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
