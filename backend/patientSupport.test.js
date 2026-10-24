'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),S=require('../frontend/js/support-model'),{clean}=require('./patientSupport');
test('scheme guidance never guarantees eligibility or treats uncertainty as rejection',()=>{
 assert.equal(S.eligibility(['yes','yes','yes']).title,'Might be eligible');assert.equal(S.eligibility(['yes','unsure','yes']).title,'Check with your ASHA or office');assert.equal(S.eligibility([]).title,'Check with your ASHA or office');
 assert.ok(S.schemes.every(s=>new URL(s.url).hostname.endsWith('.gov.in')));assert.ok(S.schemes.every(s=>!s.id_number&&!s.deadline));
});
test('sharing summary counts effective people rather than number of report grants',()=>{const shares=[{doctor_id:1},{doctor_id:1},{doctor_id:2}];assert.equal(S.effectivePeople(shares),2);assert.equal(S.effectivePeople(shares,false),0);assert.equal(S.effectivePeople([]),0);});
test('checklists reject invalid steps, arbitrary personal fields and impossible dates',()=>{
 assert.equal(clean({step:5}),null);assert.equal(clean({step:2,documents:{identity:'yes'}}),null);assert.equal(clean({step:1,documents:{national_id:'private'}}),null);assert.equal(clean({step:1,reminder_on:'2026-02-30'}),null);assert.deepEqual(clean({step:1,documents:{identity:true}}),{step:1,documents:{identity:true},reminder_on:null});
});
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express'),{createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs');
test('support progress and notification snooze persist with ownership and role checks',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-support-')),pool=createLocalPool(dir);let server;try{
 for(const name of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
 const users=[];for(const role of ['mother','mother','doctor'])users.push((await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id',[role+users.length+'@dai-synthetic.invalid','synthetic',role])).rows[0].id);const [a,b,doc]=users;
 const app=express();app.use(express.json());const authenticateToken=(req,res,next)=>{const id=Number(req.headers['x-user']);if(!users.includes(id))return res.sendStatus(401);req.user={id,role:id===doc?'doctor':'mother'};next();};const authorizeRole=roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403);
 require('./patientSupport')(app,{pool,authenticateToken,authorizeRole});require('./notifications')(app,{pool,authenticateToken});
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
 async function call(url,user=a,method='GET',body){const r=await fetch(base+'/api/'+url,{method,headers:{'x-user':String(user),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null};}
 assert.equal((await call('patient/support',doc)).status,403);assert.deepEqual((await call('patient/support',b)).data.progress,[]);
 assert.equal((await call('patient/support/pmmvy',a,'PUT',{step:2,documents:{identity:true},reminder_on:'2026-10-24'})).status,200);assert.equal((await call('patient/support',a)).data.progress[0].step,2);assert.equal((await call('patient/support',b)).data.progress.length,0);assert.equal((await call('patient/support/fake',a,'PUT',{step:4})).status,400);
 const feed=await call('notifications');assert.equal(feed.status,200);assert.ok(feed.data.notifications.some(n=>n.category==='scheme'));const reminder=feed.data.notifications.find(n=>n.category==='scheme');await call('notifications/'+reminder.id+'/snooze',a,'PATCH',{hours:24});assert.ok(!(await call('notifications')).data.notifications.some(n=>n.id===reminder.id));
 const n=(await pool.query("INSERT INTO notifications(user_id,dedupe_key,severity,category,title) VALUES($1,'test','info','scheme','Synthetic reminder') RETURNING id",[a])).rows[0].id;
 assert.equal((await call('notifications/'+n+'/snooze',b,'PATCH',{hours:24})).status,404);assert.equal((await call('notifications/'+n+'/snooze',a,'PATCH',{hours:999})).status,400);assert.equal((await call('notifications/'+n+'/snooze',a,'PATCH',{hours:24})).status,200);assert.ok((await pool.query('SELECT snoozed_until>NOW() AS future FROM notifications WHERE id=$1',[n])).rows[0].future);
 await pool.query("UPDATE notifications SET severity='danger',read_at=NOW() WHERE id=$1",[n]);assert.equal((await call('notifications/'+n+'/snooze',a,'PATCH',{hours:24})).status,404);assert.ok((await call('notifications')).data.notifications.some(r=>r.id===n));
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});

test('support screens accept the actual care-team contract and never light unlinked family access',()=>{
 const vm=require('node:vm'),syncFs=require('node:fs');const roots=Object.fromEntries(['patientSchemes','panel-family','supportFamily','panel-messages','supportInbox'].map(id=>[id,{innerHTML:'',className:''}]));
 const document={getElementById:id=>roots[id]||null,documentElement:{lang:'en'},addEventListener(){}};const window={SupportModel:S};
 vm.runInNewContext(syncFs.readFileSync(path.join(__dirname,'../frontend/js/patient-support.js'),'utf8'),{window,document,Intl,Date,Map,Set,location:{hash:''},setInterval:()=>0});
 window.PatientSupport.update({user:{id:88,guest:true,full_name:'SYNTHETIC Mother'},overview:{care_team:{doctor_name:'SYNTHETIC Dr <X>',unit:'I'}},milestones:[]},{privacy_share_doctors:false});
 assert.match(roots.patientSchemes.innerHTML,/SYNTHETIC Dr &lt;X&gt;/);assert.match(roots.supportFamily.innerHTML,/0 connected report recipients/);assert.match(roots.supportFamily.innerHTML,/Not linked/);assert.doesNotMatch(roots.supportFamily.innerHTML,/person-1 is-linked/);assert.match(roots.supportInbox.innerHTML,/All caught up/);
});
