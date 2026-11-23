'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express'),{randomUUID}=require('node:crypto');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs'),{doctorDayReports}=require('./doctorDayReports'),M=require('../frontend/js/doctor-day-model');
test('day model separates recorded risk, self-report, queue status and due-date windows',()=>{
 const d={date:'2026-11-23',patients:[{id:1,name:'SYNTHETIC Nivara Sethi 00001',stage:{delivered:true},edd:null},{id:2,stage:{week:39},edd:'2026-11-29'},{id:3,stage:{week:39},edd:'2026-11-30'}],appointments:[{id:1,mother_id:1,requested_date:'2026-11-23',status:'confirmed'}],queue:[{appointment_id:1,state:'done'}],worklist:[{patient_id:2,days_overdue:8,title:'Visit'}],patient_reports:{patients:[{mother_id:2,bp:[{systolic:148,diastolic:96}],weight:[],reduced_movement:[{at:'2026-11-23'}],supplement_last_log:'2026-11-17'}]}};
 assert.equal(M.metrics(d).seen,1);assert.equal(M.due(d,7).length,1);assert.equal(M.due(d,14).length,2);assert.equal(M.attention(d)[0].source,'Self-reported');assert.equal(M.reports(d)[0].ids.length,1);assert.equal(M.reports(d)[2].ids.length,1);assert.equal(M.name(d.patients[0].name),'Nivara Sethi');assert.equal(d.patients[1].clinicianRisk,undefined);assert.deepEqual(M.query(d,'Who is due this week with BP above 140?').ids,[2]);assert.equal(M.query(d,'make a diagnosis').recognised,false);
});
test('daily overview shares only explicitly consented logs; follow-up booking is scoped, repeat-safe and collision-checked',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-day-')),pool=createLocalPool(dir);let server;
 try{
  for(const f of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',f),'utf8'));
  const ids=[];for(const role of ['mother','mother','doctor'])ids.push((await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'unused',$2) RETURNING id",[role+ids.length+'@dai-synthetic.invalid',role])).rows[0].id);const [mother,other,doctor]=ids;
  for(const id of [mother,other])await pool.query("INSERT INTO mother_profiles(user_id,full_name,care_start_date) VALUES($1,'Synthetic patient',CURRENT_DATE)",[id]);
  await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified) VALUES($1,'Synthetic clinician','OBG','fixture',TRUE)",[doctor]);
  await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,CURRENT_DATE,'confirmed')",[mother,doctor]);
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
  await pool.query("INSERT INTO patient_daily_entries(mother_id,mutation_id,log_date,kind,data,logged_at) VALUES($1,$2,$3,'symptom',$4,NOW())",[mother,randomUUID(),date,{codes:['reduced_movement'],severity:'unspecified',note:'Private note must never appear'}]);
  assert.equal((await doctorDayReports(pool,doctor,date)).patients.length,0);
  await pool.query("INSERT INTO patient_daily_consent(mother_id,doctor_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 day')",[mother,doctor]);
  const report=await doctorDayReports(pool,doctor,date);assert.equal(report.patients.length,1);assert.equal(report.patients[0].reduced_movement.length,1);assert.ok(!JSON.stringify(report).includes('Private note'));
  const app=express();app.use(express.json());require('./doctorFollowup')(app,{pool,authenticateToken:(req,res,next)=>{if(!req.headers['x-user'])return res.sendStatus(401);req.user={id:Number(req.headers['x-user']),role:Number(req.headers['x-user'])===doctor?'doctor':'mother'};next();},authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)});
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  const call=async(b,user=doctor)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/doctor/followups',{method:'POST',headers:{'content-type':'application/json','x-user':String(user)},body:JSON.stringify(b)});return {status:r.status,data:await r.json().catch(()=>({}))};};
  const booking={mother_id:mother,date:M.add(date,1),time:'10:00',reason:'Recorded follow-up'};
  assert.equal((await call(booking,mother)).status,403);assert.equal((await call({...booking,mother_id:other})).status,403);
  const first=await call(booking);assert.equal(first.status,201);assert.equal((await call(booking)).data.id,first.data.id);
  assert.equal((await call({...booking,time:'10:15'})).status,409);assert.equal((await call({...booking,date:'2026-02-30'})).status,400);
  assert.equal((await pool.query('SELECT status FROM appointments WHERE id=$1',[first.data.id])).rows[0].status,'confirmed');
  await pool.query("INSERT INTO patient_access_controls(mother_id,grantee_type,grantee_ref,state) VALUES($1,'doctor',$2,'revoked')",[mother,String(doctor)]);
  assert.equal((await doctorDayReports(pool,doctor,date)).patients.length,0);assert.equal((await call({...booking,time:'11:00'})).status,403);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
