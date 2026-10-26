'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs');
test('complete backend starts and patient timeline APIs authenticate, isolate records and persist self-reported completion',{timeout:45000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-timeline-integration-'));let pool=createLocalPool(path.join(dir,'patient-db')),child,logs='';
 try{
  for(const name of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
  const hash=await require('bcrypt').hash('Synthetic-Timeline-Test-2026!',10),ids=[];
  for(const role of ['mother','mother','doctor'])ids.push((await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id',[role+ids.length+'@dai-synthetic.invalid',hash,role])).rows[0].id);
  for(const id of ids.slice(0,2))await pool.query("INSERT INTO mother_profiles(user_id,full_name,care_start_date,lmp_date,pregnancy_status) VALUES($1,'SYNTHETIC Test Patient',CURRENT_DATE-100,CURRENT_DATE-100,'pregnant')",[id]);
  await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number) VALUES($1,'SYNTHETIC Clinician','OBG','FAKE-TEST-ONLY')",[ids[2]]);
  const mine=(await pool.query("INSERT INTO care_milestones(mother_id,stage,category,title,due_date) VALUES($1,'Trimester 2','pregnancy','SYNTHETIC own timeline milestone',CURRENT_DATE) RETURNING id",[ids[0]])).rows[0].id;
  const other=(await pool.query("INSERT INTO care_milestones(mother_id,stage,category,title,due_date) VALUES($1,'Trimester 2','pregnancy','PRIVATE other patient milestone',CURRENT_DATE) RETURNING id",[ids[1]])).rows[0].id;
  await pool.end();pool=null;
  const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  child=spawn(process.execPath,[path.join(__dirname,'server.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,DAI_LOCAL:'true',DAI_DEMO:'true',PORT:String(port),DAI_LOCAL_DB_DIR:path.join(dir,'patient-db'),JWT_SECRET:'synthetic-timeline-integration-test-at-least-48-characters',DAI_HOSPITAL_DB:path.join(dir,'no-source.db')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>{logs+=d.toString();});child.stderr.on('data',d=>{logs+=d.toString();});
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(base+'/api/health');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,'Backend did not start. '+logs.slice(-2500));
  const login=async email=>{const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Synthetic-Timeline-Test-2026!'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
  const mother=await login('mother0@dai-synthetic.invalid'),doctor=await login('doctor2@dai-synthetic.invalid');
  const request=async(url,cookie,method='GET',body)=>{const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,cacheControl:r.headers.get('cache-control'),body:await r.json()};};
  for(const url of ['/api/timeline','/api/timeline/enhanced']){
   assert.equal((await request(url)).status,401);assert.equal((await request(url,doctor)).status,403);
   const r=await request(url,mother);assert.match(r.cacheControl,/no-store/);assert.equal(r.status,200);assert.equal(r.body.milestones.length,1);assert.equal(r.body.milestones[0].id,mine);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE other patient/);
  }
  const catalogue=await request('/api/public/assistance-content');assert.equal(catalogue.status,200);assert.match(catalogue.cacheControl,/public/);assert.equal(catalogue.body.faqs.length,40);
  const unapproved=await request('/api/assistance/complex',mother,'POST',{task:'visit-questions',language:'en',approved:false});assert.equal(unapproved.status,409);assert.match(unapproved.cacheControl,/no-store/);
  assert.equal((await request('/api/timeline/'+other+'/complete',mother,'PATCH')).status,404);
  assert.equal((await request('/api/timeline/'+mine+'/complete',mother,'PATCH')).status,200);
  for(const url of ['/api/timeline','/api/timeline/enhanced']){const r=await request(url,mother);assert.equal(r.body.milestones[0].status,'completed');assert.equal(r.body.milestones[0].completion_verification,'self_reported');}
 }finally{
  if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
  if(pool)await pool.end();await fs.rm(dir,{recursive:true,force:true});
 }
});
