'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {register}=require('./assistanceRouting');
async function fixture(options={}){
 let queries=0,time=0,fail=false,calls=[];const app=express();app.use(express.json());
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 register(app,{pool:{query:async()=>{queries++;if(fail)throw Error('offline');return {rows:[{id:1,name:'Fictional centre',city:'Delhi',state:'Delhi',pincode:'110017',facility_type:'clinic',patient_name:'PRIVATE',slots:['PRIVATE'],notes:'PRIVATE'}]};}},authenticateToken:(req,res,next)=>{if(!req.headers['x-user'])return res.sendStatus(401);req.user={id:req.headers['x-user'],role:req.headers['x-role']||'mother'};next();},env:options.env||{},now:()=>time,fetchImpl:async(url,init)=>{calls.push([url,init]);if(options.block)await options.block;return options.upstream||{ok:true,json:async()=>({candidates:[{content:{parts:[{text:'General draft only'}]}}]})};}});
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+server.address().port;
 return {queries:()=>queries,calls,advance:ms=>{time+=ms;},fail:()=>{fail=true;},get:(path,headers={})=>fetch(base+path,{headers}),post:(body,user='one')=>fetch(base+'/api/assistance/complex',{method:'POST',headers:{'Content-Type':'application/json',...(user?{'x-user':user}:{})},body:JSON.stringify(body)}),close:()=>new Promise(r=>server.close(r))};
}
test('public FAQ content has revision-aware validators, no identity and no model calls',async()=>{
 const f=await fixture();try{const a=await f.get('/api/public/assistance-content',{'x-user':'one'}),data=await a.json();assert.equal(data.faqs.length,40);assert.match(a.headers.get('cache-control'),/^public/);assert.equal(data.scope,'Prepared general information; no patient records');
 const b=await f.get('/api/public/assistance-content',{'x-user':'two','if-none-match':a.headers.get('etag')});assert.equal(b.status,304);assert.equal(f.calls.length,0);
 assert.equal((await f.get('/api/public/assistance-content?patient_id=1')).status,400);
 }finally{await f.close();}
});
test('shared facility cache projects only public fields, expires, and never serves stale on failure',async()=>{
 const f=await fixture();try{const responses=await Promise.all([f.get('/api/public/facility-metadata',{'x-user':'one'}),f.get('/api/public/facility-metadata',{'x-user':'two'})]);
 for(const r of responses){const text=await r.text();assert.ok(!text.includes('PRIVATE'));assert.match(r.headers.get('cache-control'),/no-store/);assert.ok(text.includes('Fictional centre'));}assert.equal(f.queries(),1);
 f.advance(59999);await f.get('/api/public/facility-metadata');assert.equal(f.queries(),1);
 f.advance(2);await f.get('/api/public/facility-metadata');assert.equal(f.queries(),2);
 f.advance(60001);f.fail();assert.equal((await f.get('/api/public/facility-metadata')).status,503);
 assert.equal((await f.get('/api/public/facility-metadata?lat=28&patient=1')).status,400);
 }finally{await f.close();}
});
const env={DAI_COMPLEX_AI_ENABLED:'true',DAI_COMPLEX_AI_MODEL:'configured-test-model',GEMINI_API_KEY:'test-key'};
const task={task:'visit-questions',language:'en',approved:true};
test('external drafting requires authentication, explicit approval and strict local validation',async()=>{
 const f=await fixture({env});try{
 assert.equal((await f.post(task,null)).status,401);
 assert.equal((await f.post({...task,approved:false})).status,409);
 for(const body of [{...task,prompt:'PRIVATE'},{...task,patient_id:'two'},{...task,task:'diagnose'},{...task,language:'fr'}])assert.equal((await f.post(body)).status,400);
 assert.equal(f.calls.length,0);
 }finally{await f.close();}
});
test('approved drafts send fixed tasks only and are never shared or cached between patients',async()=>{
 const f=await fixture({env});try{for(const id of ['one','two']){const r=await f.post(task,id);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal((await r.json()).source,'external-ai');}
 assert.equal(f.calls.length,2);for(const [url,init]of f.calls){assert.ok(!url.includes('test-key'));assert.ok(!init.body.includes('patient_id'));assert.ok(!init.body.includes('PRIVATE'));assert.match(init.body,/non-medical logistical/);assert.equal(JSON.parse(init.body).generationConfig.maxOutputTokens,700);}
 }finally{await f.close();}
});
test('unconfigured external drafting keeps FAQ path local and reports unavailable honestly',async()=>{
 const f=await fixture();try{const r=await f.post(task);assert.equal(r.status,503);assert.equal(f.calls.length,0);assert.match((await r.json()).error,/Local FAQ/);}finally{await f.close();}
});
test('per-user external request budget does not bypass consent or reuse drafts',async()=>{
 const f=await fixture({env});try{for(let i=0;i<5;i++){assert.equal((await f.post(task)).status,200);f.advance(31000);}assert.equal((await f.post(task)).status,429);assert.equal((await f.post(task,'two')).status,200);assert.equal(f.calls.length,6);}finally{await f.close();}
});

test('provider failure and empty output never become cacheable drafts',async()=>{
 for(const upstream of [{ok:false},{ok:true,json:async()=>({candidates:[]})}]){
  const f=await fixture({env,upstream});try{const r=await f.post(task);assert.equal(r.status,502);assert.match(r.headers.get('cache-control'),/no-store/);const d=await r.json();assert.equal(d.source,undefined);}finally{await f.close();}
 }
});

test('repeated same-task approval makes no second call; failed calls are not retried',async()=>{
 const f=await fixture({env});try{assert.equal((await f.post(task)).status,200);assert.equal((await f.post(task)).status,409);assert.equal(f.calls.length,1);f.advance(30001);assert.equal((await f.post(task)).status,200);assert.equal(f.calls.length,2);}finally{await f.close();}
});
test('high stakes tasks and oversized context stop locally before any external call',async()=>{
 const f=await fixture({env});try{for(const name of ['pregnancy_risk','clinical_recommendation','document_interpretation']){const r=await f.post({...task,task:name});assert.equal(r.status,422);assert.equal((await r.json()).review_required,true);}
 assert.equal((await f.post({...task,history:'PRIVATE'.repeat(1000)})).status,413);assert.equal(f.calls.length,0);
 }finally{await f.close();}
});

test('one in-flight request per patient blocks parallel agent-style fanout',async()=>{
 let finish;const block=new Promise(r=>{finish=r;}),f=await fixture({env,block});let first;
 try{first=f.post(task);for(let i=0;i<100&&!f.calls.length;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.calls.length,1);assert.equal((await f.post({...task,task:'sharing-checklist'})).status,409);assert.equal(f.calls.length,1);finish();assert.equal((await first).status,200);}finally{finish();if(first)await first;await f.close();}
});
