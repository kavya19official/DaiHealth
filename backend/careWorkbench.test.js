'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs/promises'),path=require('node:path');
const {validate,approvable,register,sourceHighlights}=require('./careWorkbench');
const M=require('../shared/care-workbench');
const source={title:'Published source',url:'https://example.org/paper',excerpt:'The study has limitations. Follow-up was incomplete in this sample.'};
const education={kind:'education',title:'Clinic handout',payload:{type:'handout',channel:'print',body:'Doctor-authored reviewed content',sources:[source]}};
test('validates planning documents and does not confuse reference URLs with verified evidence',()=>{
 assert.equal(validate(education).payload.body,education.payload.body);
 assert.equal(approvable(validate(education)),true);
 assert.equal(approvable(validate({...education,payload:{...education.payload,sources:[]}})),false);
 assert.throws(()=>validate({...education,payload:{...education.payload,sources:[{...source,url:'javascript:alert(1)'}]}}));
 assert.throws(()=>validate({...education,payload:{...education.payload,scheduled_date:'2026-02-30'}}));
 assert.throws(()=>validate({...education,payload:{...education.payload,patient_id:3}}));
 assert.throws(()=>validate({kind:'practice',title:'Practice',payload:{period:'2026-11',inquiries:1,first_visits:2}}));
 assert.equal(sourceHighlights([source],{highlights:[{source:1,quote:'The study has limitations.'}]}).includes(source.url),true);
 assert.throws(()=>sourceHighlights([source],{highlights:[{source:1,quote:'Treatment was effective for everyone.'}]}));
 assert.throws(()=>sourceHighlights([source],{highlights:[{source:2,quote:'The study has limitations.'}]}));
});
test('registry uses real stage weeks and preserves missing stage and sharing state',()=>{
 const data={date:'2026-11-24',patients:[{id:1,name:'Nivara',stage:{week:13},overdue:1,clinical_shared:true},{id:2,name:'Other',stage:{week:28},edd:'2026-11-30',overdue:0},{id:3,name:'Postpartum',stage:{delivered:true}},{id:4,name:'Unknown',stage:{week:null}}]};
 assert.deepEqual(M.registry(data,{stage:'t1'}).map(p=>p.id),[1]);
 assert.deepEqual(M.registry(data,{stage:'t3',gap:'due14'}).map(p=>p.id),[2]);
 assert.deepEqual(M.registry(data,{gap:'overdue'}).map(p=>p.id),[1]);
 assert.deepEqual(M.registry(data,{stage:'postpartum'}).map(p=>p.id),[3]);
 assert.equal(M.registry(data,{}).length,4);
 assert.equal(M.csv([['=HYPERLINK("bad")']]).startsWith('"\'=HYPERLINK'),true);
});
test('candidate slots exclude cancellations, past times, overlaps and booked buffers',()=>{
 const data={date:'2026-11-24',appointments:[{id:1,mother_id:1,requested_date:'2026-11-24',requested_time:'09:00:00',status:'confirmed'},{id:2,mother_id:2,requested_date:'2026-11-24',requested_time:'09:30:00',status:'cancelled'},{id:3,mother_id:3,requested_date:'2026-11-24',requested_time:'10:00:00',status:'confirmed'}],queue:[{appointment_id:3,state:'waiting',checked_in_at:'2026-11-24T04:30:00Z'}]};
 const result=M.operations(data,{start:'09:00',end:'11:00',now:'2026-11-24T04:40:00Z'});
 assert.deepEqual(result.slots,['10:30']);assert.equal(result.waiting[0].wait_minutes,10);assert.equal(result.scheduled,2);
 const earlier=M.operations(data,{start:'09:00',end:'11:00',now:'2026-11-24T03:00:00Z'});assert.deepEqual(earlier.slots,['09:30','10:30']);
 assert.equal(M.operations(data,{start:'09:00',end:'11:00',duration:15,now:'2026-11-24T03:00:00Z'}).slots.includes('09:45'),false);
 assert.throws(()=>M.operations(data,{end:'08:00'}));
 const metrics=M.insights(data);assert.equal(metrics.completed,0);assert.equal(metrics.cancelled,1);assert.equal(metrics.unique,3);
});
test('owner isolation, review versioning, approval reset, conflict handling and atomic audit',async()=>{
 const db=new PGlite();await db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2)');await db.exec(await fs.readFile(path.join(__dirname,'db/care_workbench.sql'),'utf8'));
 const routes=new Map(),app={get(p,...h){routes.set('GET '+p,h);},post(p,...h){routes.set('POST '+p,h);},patch(p,...h){routes.set('PATCH '+p,h);},delete(p,...h){routes.set('DELETE '+p,h);}};
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 let verified=true;
 register(app,{pool,authenticateToken:(req,res,next)=>next(),authorizeRole:()=>((req,res,next)=>next()),verify:async()=>verified,env:{}});
 async function run(method,url,user,body={},id=1){const req={user:{id:user},body,params:{id:String(id)}},res={code:200,set(){return this;},status(n){this.code=n;return this;},json(x){this.body=x;return this;}};const h=routes.get(method+' '+url);for(const handler of h){let next=false;await handler(req,res,()=>{next=true;});if(!next)break;}return res;}
 try{
  const created=await run('POST','/api/doctor/workbench',1,education);assert.equal(created.code,201);const id=created.body.item.id;
  assert.equal((await run('GET','/api/doctor/workbench',2)).body.items.length,0);
  assert.equal((await run('PATCH','/api/doctor/workbench/:id',2,{action:'approve',version:1,reviewed:true},id)).code,404);
  assert.equal((await run('PATCH','/api/doctor/workbench/:id',1,{action:'approve',version:1},id)).code,400);
  const approved=await run('PATCH','/api/doctor/workbench/:id',1,{action:'approve',version:1,reviewed:true},id);assert.equal(approved.body.item.status,'approved');assert.equal(approved.body.item.version,2);
  assert.equal((await run('PATCH','/api/doctor/workbench/:id',1,{...education,action:'edit',version:1},id)).code,409);
  const edited=await run('PATCH','/api/doctor/workbench/:id',1,{...education,action:'edit',version:2},id);assert.equal(edited.body.item.status,'draft');assert.equal(edited.body.item.approved_at,null);
  assert.equal((await run('POST','/api/doctor/workbench/highlights',1,{sources:[source]})).code,409);
  assert.equal((await run('POST','/api/doctor/workbench/highlights',1,{sources:[source],external_consent:true})).code,503);
  verified=false;assert.equal((await run('GET','/api/doctor/workbench',1)).code,403);verified=true;
  assert.equal((await run('DELETE','/api/doctor/workbench/:id',2,{version:3},id)).code,409);
  assert.equal((await run('DELETE','/api/doctor/workbench/:id',1,{version:3},id)).body.deleted,true);
  const events=(await db.query('SELECT action FROM doctor_workbench_events ORDER BY id')).rows.map(r=>r.action);assert.deepEqual(events,['created','approved','edited','deleted']);
 }finally{await db.close();}
});

test('source extraction and content adaptation require opt-in, reject ungrounded output and recheck clinician access',async()=>{
 const handlers=new Map(),app={get(){},post(p,...h){handlers.set(p,h);},patch(){},delete(){}};
 let output={highlights:[{source:1,quote:'The study has limitations.'}]},calls=0,allowed=true,revokeDuringCall=false;
 register(app,{pool:{},authenticateToken:(req,res,next)=>next(),authorizeRole:()=>((req,res,next)=>next()),verify:async()=>allowed,env:{DAI_CONSULTATION_AI_ENABLED:'true',GEMINI_API_KEY:'synthetic-test-only',DAI_CONSULTATION_AI_MODEL:'gemini-test'},fetchImpl:async()=>{calls++;if(revokeDuringCall)allowed=false;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(output)}]}}]})};}});
 async function run(path,id,body){const req={user:{id},body},res={code:200,set(){return this;},status(n){this.code=n;return this;},json(x){this.body=x;return this;}};for(const h of handlers.get('/api/doctor/workbench/'+path)){let next=false;await h(req,res,()=>{next=true;});if(!next)break;}return res;}
 assert.equal((await run('highlights',1,{sources:[source]})).code,409);assert.equal(calls,0);
 const result=await run('highlights',1,{sources:[source],external_consent:true});assert.equal(result.code,200);assert.match(result.body.findings,/The study has limitations/);assert.equal(result.body.saved,false);
 assert.equal((await run('highlights',1,{sources:[source],external_consent:true})).code,429);
 output={highlights:[{source:1,quote:'Every treatment cures everyone.'}]};assert.equal((await run('highlights',2,{sources:[source],external_consent:true})).code,502);
 const sourceText='This note covers 2 clinic visits.';
 output={body:'इस नोट में 2 क्लिनिक विज़िट हैं।'};const translated=await run('adapt',3,{text:sourceText,language:'Hindi',format:'handout',external_consent:true});assert.equal(translated.code,200);assert.equal(translated.body.review_required,true);
 output={body:'This note covers 5 clinic visits.'};assert.equal((await run('adapt',4,{text:sourceText,language:'English',format:'handout',external_consent:true})).code,502);
 output={body:sourceText};revokeDuringCall=true;assert.equal((await run('adapt',5,{text:sourceText,language:'English',format:'handout',external_consent:true})).code,403);
});

test('follow-up candidates exclude future confirmed maternal visits and never borrow unshared clinical flags',()=>{
 const data={date:'2026-11-24',patients:[{id:1,name:'A',overdue:1},{id:2,name:'B',overdue:5},{id:3,name:'C',overdue:0,clinical_shared:true,clinicianRisk:{reason:'Reviewed'}},{id:4,name:'D',overdue:0,clinical_shared:false,clinicianRisk:{reason:'Hidden'}}],appointments:[{mother_id:2,child_id:null,requested_date:'2026-11-25',status:'confirmed'},{mother_id:1,child_id:9,requested_date:'2026-11-25',status:'confirmed'}]};
 assert.deepEqual(M.followupCandidates(data).map(p=>p.id),[3,1]);
 assert.match(M.followupCandidates(data)[0].reason,/Clinician marked/);
});
