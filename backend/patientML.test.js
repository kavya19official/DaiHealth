'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),express=require('express'),vm=require('node:vm');
const ML=require('./patientML'),{applyQuiet,plan}=require('./reminderScheduler'),{createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs');
test('rules, service failures and invalid model output never suppress gaps or return probabilities',async()=>{
 const body={patient_id:'1',consent:{personalization:true},gaps:[{id:'1',days_overdue:10,clinician_priority:false,bucket:'overdue'},{id:'2',days_overdue:1,clinician_priority:true,bucket:'overdue'}]};
 const before=process.env.ML_ENABLED;try{process.env.ML_ENABLED='false';let calls=0;const out=await ML.request('rank-gaps',body,()=>{calls++;});assert.equal(calls,0);assert.equal(out.source,'rules');assert.deepEqual(out.items.map(i=>i.id),['2','1']);process.env.ML_ENABLED='true';for(const transport of [async()=>{throw Error('Offline');},async()=>({ok:true,json:async()=>({source:'ml',items:[]})})]){const r=await ML.request('rank-gaps',body,transport);assert.equal(r.source,'rules');assert.equal(r.items.length,2);assert.ok(r.items.every(x=>x.reason));assert.ok(!JSON.stringify(r).includes('probability'));}}finally{if(before===undefined)delete process.env.ML_ENABLED;else process.env.ML_ENABLED=before;}
 assert.equal(applyQuiet(23,{quiet_hours_enabled:true,quiet_start:'21:00',quiet_end:'07:30'}),8);assert.equal(applyQuiet(18,{quiet_hours_enabled:true,quiet_start:'21:00',quiet_end:'07:00'}),18);
});
test('patient ML SQL endpoints enforce own identity, consent, eligible candidates and persistent app reminder events',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-patient-ml-')),pool=createLocalPool(dir);let server;const before=process.env.ML_ENABLED;process.env.ML_ENABLED='false';
 try{
  for(const f of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',f),'utf8'));
  const ids=[];for(const role of ['mother','mother','doctor'])ids.push((await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'fake',$2) RETURNING id",[role+ids.length+'@test.invalid',role])).rows[0].id);
  for(const id of ids.slice(0,2))await pool.query("INSERT INTO mother_profiles(user_id,full_name,lmp_date) VALUES($1,'Synthetic Test','2026-05-01')",[id]);
  const gap=(await pool.query("INSERT INTO care_milestones(mother_id,stage,category,title,due_date) VALUES($1,'Trimester 2','pregnancy','ANC visit','2026-10-01') RETURNING id",[ids[0]])).rows[0].id;
  const app=express();app.use(express.json());ML(app,{pool,authenticateToken(req,res,next){const n=Number(req.headers['x-user']||ids[0]);req.user={id:n,role:n===ids[2]?'doctor':'mother'};next();},authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)});
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
  const call=async(p,method='GET',body,user=ids[0])=>{const r=await fetch(base+'/api/patient/'+p,{method,headers:{'content-type':'application/json','x-user':String(user)},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};};
  assert.equal((await call('ml/settings','GET',null,ids[2])).status,403);
  assert.equal((await call('ml-events','POST',{event_type:'facility_viewed',entity_id:'1'})).status,403);
  const own=await call('ml/rank-gaps','POST',{patient_id:ids[1],gaps:[{id:'mother-'+gap,gap_type:0}]});assert.equal(own.status,200);assert.equal(own.data.items.length,1);
  const other=await call('ml/rank-gaps','POST',{gaps:[{id:'mother-'+gap}]},ids[1]);assert.equal(other.data.items.length,0);
  assert.equal((await call('ml/settings','PUT',{personalization:false,location:false,reminders:true,events:true})).status,200);
  assert.equal((await call('ml-events','POST',{event_type:'facility_viewed',entity_id:'1'})).status,201);
  const reminder=await plan(pool,ids[0],new Date('2026-10-24T15:00:00Z'));assert.equal(reminder.source,'rules');assert.equal(reminder.channel,'app');assert.equal(reminder.state,'ready');assert.ok(reminder.reason);
  await plan(pool,ids[0],new Date('2026-10-24T15:01:00Z'));assert.equal((await pool.query("SELECT COUNT(*)::int n FROM events WHERE event_type='reminder_sent'")).rows[0].n,1);
  const settings=await call('ml/settings','GET',null,ids[1]);assert.equal(settings.data.consent.events,false);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});if(before===undefined)delete process.env.ML_ENABLED;else process.env.ML_ENABLED=before;}
});
function frontend(enabled,personalization=enabled,help={actions:[],source:'rules'}){const root={innerHTML:'',classList:{add(){}}},events={},listeners={},window={PatientModel:require('../frontend/js/patient-model'),PatientPendingModel:require('../frontend/js/patient-pending-model'),addEventListener:(t,fn)=>listeners[t]=fn,dispatchEvent:e=>listeners[e.type]?.(),DaiAPI:{apiRequest:async url=>url.endsWith('/settings')?{enabled,consent:{personalization}}:url.includes('support-suggestions')?help:{items:[{id:'mother-2',reason:'Access assistance for your existing follow-up',source:'ml'},{id:'mother-1',reason:'Recorded overdue care',source:'ml'}],source:'ml'}}};
 const document={getElementById:id=>id==='allCareGaps'?root:null,documentElement:{lang:'en'},addEventListener:(t,fn)=>events[t]=fn};const ctx={window,document,Map,Set,Date,console,Event:class{constructor(type){this.type=type;}}};
 for(const file of ['patient-ml.js','patient-pending.js'])vm.runInNewContext(require('fs').readFileSync(path.join(__dirname,'../frontend/js',file),'utf8'),ctx);
 return {window,root};}
test('patient Pending Care renders with ML on and off, reasons/badge only for learned order, and keeps completed history',async()=>{
 const state={user:{id:1,lmp_date:'2026-05-01'},post:{},children:[],milestones:[{id:1,title:'First check',due_date:'2026-10-01'},{id:2,title:'Second check',due_date:'2026-10-02'},{id:3,title:'Done check',due_date:'2026-09-01',completed_at:'2026-09-01',status:'completed'}]};
 for(const enabled of [false,true]){const v=frontend(enabled);await v.window.PatientML.refresh();v.window.PatientPending.update(state);await new Promise(r=>setTimeout(r,15));assert.ok(v.root.innerHTML.includes('START HERE'));assert.ok(v.root.innerHTML.includes('Done check'));assert.equal(v.root.innerHTML.includes('Simulated on synthetic data'),enabled);if(enabled)assert.ok(v.root.innerHTML.indexOf('Second check')<v.root.innerHTML.indexOf('First check'));else assert.ok(v.root.innerHTML.indexOf('First check')<v.root.innerHTML.indexOf('Second check'));}
});
test('Nearby Care renders ML match/reasons and preserves rule results when ML is off',async()=>{
 for(const learned of [false,true]){
  const nodes=new Map(),events={},listeners={};const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',hidden:true,disabled:false,style:{},classList:{add(){},remove(){}},addEventListener:(t,fn)=>events[id+':'+t]=fn,focus(){}});return nodes.get(id);};
  const facility={id:1,name:'Fictional care centre',services:[{service_name:'ANC',available:true}],capabilities:[],languages:[],verification_source:'synthetic_fixture',distance_km:3};
  const window={DaiAPI:{apiRequest:async path=>path.includes('/search?')?{facilities:[facility],warnings:[]}:{location:null},toast(){}},FacilityMatchUI:{read:()=>({}),announce(){},explain:()=>''},PatientML:{rankFacilities:async rows=>rows.map(f=>learned?{...f,ml_source:'ml',ml_best:true,ml_reason:'Listed for ANC, 3 km away; confirm with the centre'}:f),badge:source=>source==='ml'?'<small>Simulated on synthetic data</small>':''},addEventListener(){}};
  const document={readyState:'loading',getElementById:node,addEventListener:(t,fn)=>listeners[t]=fn,querySelectorAll:()=>[]};
  vm.runInNewContext(require('fs').readFileSync(path.join(__dirname,'../frontend/js/facility-discovery.js'),'utf8'),{window,document,URLSearchParams,console,FormData});listeners.DOMContentLoaded();node('city').value='New Delhi';await events['searchBtn:click']();const html=node('facilitiesList').innerHTML;assert.ok(html.includes('Fictional care centre'));assert.equal(html.includes('Best match for this search'),learned);assert.equal(html.includes('Simulated on synthetic data'),learned);if(learned)assert.ok(html.includes('Listed for ANC, 3 km away'));
 }
});
test('reported opening hours never equate a 24x7 emergency flag with an open laboratory',()=>{
 const now=new Date('2026-10-24T05:00:00Z');
 assert.equal(ML.reportedOpen({emergency_24x7:true},'ultrasound',now),false);
 assert.equal(ML.reportedOpen({emergency_24x7:true},'emergency',now),true);
 assert.equal(ML.reportedOpen({operating_hours:{Saturday:'09:00-17:00'}},'ANC',now),true);
 assert.equal(ML.reportedOpen({operating_hours:{Saturday:'09:00-17:00'}},'ANC',new Date('2026-10-24T18:00:00Z')),false);
});
test('canonical completion telemetry logs successful facts without forwarding clinical notes',async()=>{
 const {EventEmitter}=require('node:events'),calls=[];
 const pool={query:async(sql,args)=>{calls.push([sql,args]);return {rows:sql.startsWith('SELECT')?[{mother_id:7}]:[]};}};
 const capture=require('./patientMLEvents')(pool);
 for(const status of [409,200]){const req={path:'/api/doctor/queue/12',method:'POST',body:{state:'done',note:'PRIVATE CLINICAL NOTE'},user:{id:3,role:'doctor'}};const res=new EventEmitter();res.statusCode=status;capture(req,res,()=>{});res.emit('finish');await new Promise(r=>setTimeout(r,5));}
 const insert=calls.filter(([sql])=>sql.startsWith('INSERT'));assert.equal(insert.length,1);assert.deepEqual(insert[0][1],[7,'appointment_kept','record-12']);assert.ok(!JSON.stringify(calls).includes('PRIVATE CLINICAL NOTE'));
});

test('support fallbacks use recorded facts, respect provenance, and reject legacy unreviewed predictions',async()=>{
 const body={consent:{personalization:true,location:true},features:{distance_km:12,prior_missed_visits:2,caregiver_support:0},known_features:['distance_km','prior_missed_visits']};
 const fallback=ML.rules('support-suggestions',body);assert.equal(fallback.source,'rules');assert.deepEqual(fallback.actions.map(a=>a.action),['nearby','asha','schemes']);assert.ok(fallback.actions[0].reason.includes('12 km'));
 const unknown=ML.rules('support-suggestions',{...body,known_features:[]});assert.deepEqual(unknown.actions.map(a=>a.action),['schemes']);
 assert.deepEqual(ML.rules('support-suggestions',{...body,consent:{personalization:false,location:true}}).actions.map(a=>a.action),['schemes']);
 const before=process.env.ML_ENABLED;try{process.env.ML_ENABLED='true';const out=await ML.request('support-suggestions',body,async()=>({ok:true,json:async()=>({source:'ml',actions:[{action:'asha',reason:'Unreviewed prediction'}]})}));assert.deepEqual(out,fallback);}finally{if(before===undefined)delete process.env.ML_ENABLED;else process.env.ML_ENABLED=before;}
});

test('record-based help renders with ML disabled and does not carry an ML badge',async()=>{
 const v=frontend(false,true,{source:'rules',actions:[{action:'asha',reason:'A previous visit is recorded as missed.'}]});await v.window.PatientML.refresh();const html=v.window.PatientML.supportHTML();assert.ok(html.includes('Recorded information and simple rules'));assert.ok(html.includes('recorded as missed'));assert.ok(!html.includes('Simulated on synthetic data'));assert.equal(v.window.PatientML.isActive(),false);
});
