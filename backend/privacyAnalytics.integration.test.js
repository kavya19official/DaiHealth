'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
const {createLocalPool}=require('./localPool');
const register=require('./privacyAnalytics');
test('SQL-backed population reports preserve source meaning, historical attribution, suppression and exact scoped exports',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'population-sql-')),pool=createLocalPool(dir);let server;
 try{
  for(const name of require('../scripts/seed-local.cjs').migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
  const doc=(await pool.query("INSERT INTO users(email,password_hash,role) VALUES('doctor@fixture.invalid','unused','doctor') RETURNING id")).rows[0].id;
  const other=(await pool.query("INSERT INTO users(email,password_hash,role) VALUES('other@fixture.invalid','unused','doctor') RETURNING id")).rows[0].id;
  for(const id of [doc,other])await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified,facility_name) VALUES($1,'Fixture doctor','Obstetrics','FIXTURE',true,'Current profile facility')",[id]);
  const ids=[];for(let i=0;i<15;i++)ids.push((await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'unused','mother') RETURNING id",['person-'+i+'@fixture.invalid'])).rows[0].id);
  const facility=async(code,name)=>(await pool.query("INSERT INTO facilities(facility_code,name,facility_type,address,city,district,state,pincode) VALUES($1,$2,'clinic','Synthetic','Delhi','South','Delhi','110017') RETURNING id",[code,name])).rows[0].id;
  const north=await facility('NORTH','Synthetic North'),south=await facility('SOUTH','Synthetic South');
  for(let i=0;i<15;i++){
   const appt=(await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status,facility_uuid) VALUES($1,$2,CURRENT_DATE-20,$3,$4) RETURNING id",[ids[i],doc,i<6?'completed':'confirmed',i<12?'NORTH':'SOUTH'])).rows[0].id;
   if(i<12){
    await pool.query("INSERT INTO facility_appointments(user_id,facility_id,appointment_type,requested_date,status) VALUES($1,$2,'follow_up',CURRENT_DATE-20,$3)",[ids[i],north,i<3?'no_show':i<6?'confirmed':'completed']);
    await pool.query("INSERT INTO facility_referrals(user_id,to_facility_id,referral_reason,status,created_at,completed_at) VALUES($1,$2,'Fixture',$3,NOW()-INTERVAL '30 days',CASE WHEN $4::boolean THEN NOW()-INTERVAL '25 days' ELSE NULL END)",[ids[i],north,i<6?'completed':'pending',i<6]);
    const item=(await pool.query("INSERT INTO missed_care_items(mother_id,appointment_id,item_type,title,due_date,created_at) VALUES($1,$2,'appointment','Fixture',CURRENT_DATE-20,NOW()-INTERVAL '15 days') RETURNING id",[ids[i],appt])).rows[0].id;
    if(i<6)await pool.query("INSERT INTO outreach_attempts(missed_care_id,attempt_type,outcome,attempt_date) VALUES($1,'call','no_answer',NOW()-INTERVAL '13 days')",[item]);
    // Earlier timestamps are invalid; future appointments must not change attribution.
    await pool.query("INSERT INTO outreach_attempts(missed_care_id,attempt_type,outcome,attempt_date) VALUES($1,'call','no_answer',NOW()-INTERVAL '16 days'),($1,'call','no_answer',NOW()+INTERVAL '2 days')",[item]);
    await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status,facility_uuid) VALUES($1,$2,CURRENT_DATE+10,'confirmed','SOUTH')",[ids[i],doc]);
   }
  }
  // Unassigned legacy appointments stay unassigned; never inferred from today's profile.
  for(const id of ids.slice(0,12))await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,CURRENT_DATE-10,'confirmed')",[id,doc]);
  // Cancelled, current-day and future facility visits must not affect the past no-show rate.
  await pool.query("INSERT INTO facility_appointments(user_id,facility_id,appointment_type,requested_date,status) VALUES($1,$2,'follow_up',CURRENT_DATE-20,'cancelled'),($1,$2,'follow_up',(NOW() AT TIME ZONE 'Asia/Kolkata')::date,'no_show'),($1,$2,'follow_up',CURRENT_DATE+10,'no_show')",[ids[0],north]);
  const app=express(),auth=(req,res,next)=>{const id=Number(req.headers['x-fixture-user']);if(!id)return res.sendStatus(401);req.user={id,role:ids.includes(id)?'mother':'doctor'};next();};
  register(app,{pool,authenticateToken:auth,authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)});
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
  const get=async(url,user=doc)=>{const r=await fetch(base+'/api/analytics/'+url,{headers:{'x-fixture-user':String(user)}});const text=await r.text();let json;try{json=JSON.parse(text);}catch{}return {status:r.status,json,text,headers:r.headers};};
  assert.equal((await get('report',0)).status,401);assert.equal((await get('report',ids[0])).status,403);
  assert.equal((await get('report?metric=__proto__')).status,400);
  assert.equal((await get('report?window=90&window=30')).status,400);
  assert.equal((await get('report?patient_id=1')).status,400);
  assert.equal((await get('report?metric=missed_visits&group_by=area')).status,400);
  assert.equal((await get('metrics')).json.metrics.length,4);
  const legacy=(await get('report?metric=missed_visits')).json;
  assert.match(legacy.definition.label,/estimate/);assert.equal(legacy.rows.find(r=>r.label==='Synthetic North').rate_text,'50%');
  const hidden=legacy.rows.find(r=>r.suppressed);assert.deepEqual(Object.keys(hidden).sort(),['key','label','reason','suppressed']);
  assert.equal(legacy.data_quality.unassigned_facility,true);assert.equal(legacy.rows.find(r=>r.key==='unassigned').label,'No facility recorded');
  const show=await get('report?metric=recorded_no_shows');assert.equal(show.status,200);assert.match(show.headers.get('cache-control'),/no-store/);
  assert.equal(show.json.rows.length,1);assert.equal(show.json.rows[0].rate_text,'25%');assert.equal(show.json.rows[0].people_band,'10–19');
  assert.equal(JSON.stringify(show.json).includes('"total":'),false);assert.equal(JSON.stringify(show.json).includes('@fixture'),false);
  const follow=(await get('report?metric=time_to_follow_up')).json;assert.equal(follow.rows.length,1);assert.equal(follow.rows[0].label,'Synthetic North');assert.equal(follow.rows[0].median_days,2);assert.equal(follow.rows[0].rate_text,'50%');
  const referral=(await get('report?metric=referral_completion&group_by=area')).json;assert.equal(referral.rows[0].label,'south');assert.equal(referral.rows[0].median_days,5);
  // Distinct-person threshold: many valid durations from only one person cannot publish a median.
  await pool.query("UPDATE facility_referrals SET completed_at=NULL WHERE user_id<>$1",[ids[0]]);
  for(let i=0;i<6;i++)await pool.query("INSERT INTO facility_referrals(user_id,to_facility_id,referral_reason,status,created_at,completed_at) VALUES($1,$2,'Repeat fixture','completed',NOW()-INTERVAL '30 days',NOW()-INTERVAL '25 days')",[ids[0],north]);
  assert.equal((await get('report?metric=referral_completion')).json.rows[0].median_days,null);
  const link='export.csv?report_id='+show.json.report_id;
  assert.equal((await get('export.csv?metric=recorded_no_shows')).status,400);
  assert.equal((await get(link,other)).status,410);
  await pool.query("UPDATE facility_appointments SET status='completed' WHERE status='no_show'");
  const exported=await get(link);assert.equal(exported.status,200);assert.equal(exported.text,register.reportToCsv(show.json));assert.match(exported.text,/25%/);
  assert.notEqual((await get('report?metric=recorded_no_shows')).json.rows[0].rate_text,'25%');
  // Four quota slots remain; parallel requests cannot all pass a stale count.
  const parallel=await Promise.all(Array.from({length:7},()=>get(link)));assert.equal(parallel.filter(r=>r.status===200).length,4);assert.equal(parallel.filter(r=>r.status===429).length,3);
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM analytics_access_log WHERE user_id=$1 AND kind='export'",[doc])).rows[0].n),5);
  await pool.query('UPDATE analytics_report_snapshots SET expires_at=NOW()-INTERVAL \'1 minute\' WHERE id=$1',[show.json.report_id]);assert.equal((await get(link)).status,410);
  await pool.query('UPDATE doctor_profiles SET credential_verified=false WHERE user_id=$1',[doc]);assert.equal((await get('report')).status,403);assert.equal((await get(link)).status,403);
  const stored=(await pool.query('SELECT report FROM analytics_report_snapshots LIMIT 1')).rows[0].report;assert.equal(JSON.stringify(stored).includes('mother_id'),false);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
