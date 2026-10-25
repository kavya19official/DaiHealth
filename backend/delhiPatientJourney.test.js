'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validate}=require('./delhiPatientJourney');
test('PIN validation uses listed Delhi centres only',()=>{const p=validate({need:'antenatal',location:{source:'manual_pin',pincode:'110017'}});assert.equal(p.precision,'pincode');assert.equal(p.latitude,28.533);for(const pin of ['110999','400001','11001',110017])assert.throws(()=>validate({need:'antenatal',location:{source:'manual_pin',pincode:pin}}));});
test('device permission, coordinates, accuracy and care needs are validated',()=>{const location={source:'device',consent:true,latitude:28.533,longitude:77.21,accuracy:50};assert.equal(validate({need:'vaccination',location}).source,'device');for(const change of [{consent:false},{latitude:19},{latitude:'28.5'},{accuracy:-1},{longitude:NaN}])assert.throws(()=>validate({need:'antenatal',location:{...location,...change}}));assert.throws(()=>validate({need:'__proto__',location}));});
test('real seeded database search, access, coverage and service filtering',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs'),{seedDelhiDemo}=require('../scripts/seed-delhi-demo.cjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-location-')),pool=createLocalPool(dir);let server;const old=process.env.DAI_LOCAL;
 try{
  for(const name of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
  const client=await pool.connect();try{await seedDelhiDemo(client,{DAI_LOCAL:'true'});}finally{client.release();}
  const app=express();app.use(express.json());require('./delhiPatientJourney').register(app,{pool,authenticateToken:(req,res,next)=>{if(!req.headers['x-role'])return res.sendStatus(401);req.user={role:req.headers['x-role']};next();}});
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const url='http://127.0.0.1:'+server.address().port+'/api/facilities/demo-journey/search';
  const body={need:'antenatal',location:{source:'manual_pin',pincode:'110017'}};
  async function call(payload=body,role='mother'){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(role?{'x-role':role}:{})},body:JSON.stringify(payload)});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null,cache:r.headers.get('cache-control')};}
  process.env.DAI_LOCAL='true';assert.equal((await call(body,null)).status,401);assert.equal((await call(body,'doctor')).status,403);
  const result=await call();assert.equal(result.status,200);assert.equal(result.cache,'private, no-store');assert.equal(result.data.not_bookable,true);assert.equal(result.data.facilities.length,3);assert.equal(result.data.facilities[0].pincode,'110017');assert.ok(result.data.facilities.every(f=>f.services.some(s=>s.category==='obstetrics')));

  assert.equal(result.data.excluded.required_service,2);
  assert.ok(result.data.facilities.every(f=>f.ranking.availability==='unknown'));
  assert.equal((await call({...body,preferences:{max_distance_km:5}})).data.facilities.length,1);
  assert.equal((await call({...body,preferences:{max_distance_km:-2}})).status,400);
  const west=(await pool.query("SELECT s.id FROM facility_services s JOIN facilities f ON f.id=s.facility_id WHERE f.pincode='110075' AND s.service_category='obstetrics'")).rows[0];
  const start=new Date(Date.now()+86400000),end=new Date(start.getTime()+3600000);
  await pool.query('INSERT INTO facility_service_slots(facility_service_id,starts_at,ends_at,available_places,source) VALUES($1,$2,$3,2,$4)',[west.id,start.toISOString(),end.toISOString(),'SYNTHETIC AUTOMATED TEST REPORT']);
  const reported=await call();assert.equal(reported.data.facilities[0].pincode,'110075');assert.equal(reported.data.facilities[0].ranking.availability,'reported_available');assert.equal(reported.data.facilities[0].ranking.matching_slots[0].source,'SYNTHETIC AUTOMATED TEST REPORT');
  await pool.query("UPDATE facility_service_slots SET updated_at=NOW()-INTERVAL '8 days'");
  assert.ok((await call()).data.facilities.every(f=>f.ranking.availability==='unknown'));
  assert.equal((await call({...body,location:{source:'manual_pin',pincode:'110999'}})).status,400);
  const device=await call({need:'vaccination',location:{source:'device',consent:true,latitude:28.715,longitude:77.12,accuracy:75}});assert.equal(device.status,200);assert.equal(device.data.facilities.length,1);assert.equal(device.data.facilities[0].pincode,'110085');
  await pool.query("UPDATE facility_services SET available=FALSE WHERE service_category='vaccination'");assert.equal((await call({need:'vaccination',location:body.location})).data.facilities.length,0);
  assert.equal(Number((await pool.query('SELECT count(*) FROM patient_locations')).rows[0].count),0);
  process.env.DAI_LOCAL='false';assert.equal((await call()).status,404);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});if(old===undefined)delete process.env.DAI_LOCAL;else process.env.DAI_LOCAL=old;}
});
