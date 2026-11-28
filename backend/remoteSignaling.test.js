'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {registerSignaling}=require('./remoteSignaling');
async function fixture(env={}){
 const app=express();app.use(express.json());let allowed=true;
 const auth=(req,res,next)=>{const role=req.get('x-role');if(!['mother','doctor'].includes(role))return res.sendStatus(401);req.user={role,id:role==='mother'?1:2};next();};
 registerSignaling(app,'/call',[auth],async()=>{if(!allowed)throw Object.assign(Error('Access ended'),{status:403});return {id:'fixture',mode:'audio'};},env);
 const server=await new Promise((r,j)=>{const s=app.listen(0,'127.0.0.1',()=>r(s));s.on('error',j);});
 return {revoke(){allowed=false;},close:()=>new Promise(r=>server.close(r)),async call(role,body,after=0){const r=await fetch('http://127.0.0.1:'+server.address().port+'/call/fixture/signals?after='+after,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(role?{'x-role':role}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,cache:r.headers.get('cache-control'),body:await r.json().catch(()=>({}))};}};
}
test('authenticated calls get approved STUN discovery; TURN remains explicit and protected',async()=>{
 const f=await fixture();try{assert.equal((await f.call()).status,401);const r=await f.call('mother');assert.equal(r.status,200);assert.equal(r.cache,'private, no-store');assert.deepEqual(r.body.ice_servers,[{urls:['stun:stun.l.google.com:19302']}]);assert.equal(r.body.relay_configured,false);assert.equal(r.body.cursor,0);f.revoke();assert.equal((await f.call('mother')).status,403);}finally{await f.close();}
 const relay=await fixture({DAI_STUN_URL:'stun:discovery.example:3478',DAI_TURN_URL:'turn:relay.example:3478,turns:relay.example:443',DAI_TURN_USERNAME:'test-user',DAI_TURN_PASSWORD:'private-test'});
 try{assert.equal((await relay.call()).status,401);const r=await relay.call('doctor');assert.equal(r.body.relay_configured,true);assert.deepEqual(r.body.ice_servers[1].urls,['turn:relay.example:3478','turns:relay.example:443']);}finally{await relay.close();}
});
test('patient readiness and offer/answer roles are enforced; fresh offers supersede stale hangups',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('doctor',{type:'ready',payload:null})).status,400);
  assert.equal((await f.call('mother',{type:'offer',payload:{sdp:'test'}})).status,400);
  assert.equal((await f.call('mother',{type:'ready',payload:null})).status,200);
  assert.equal((await f.call('doctor')).body.signals[0].type,'ready');
  await f.call('doctor',{type:'offer',payload:{type:'offer',sdp:'first'}});
  await f.call('doctor',{type:'hangup',payload:null});const before=(await f.call('mother')).body.cursor;
  await f.call('doctor',{type:'offer',payload:{type:'offer',sdp:'new'}});
  const fresh=(await f.call('mother',null,before)).body;assert.equal(fresh.signals.length,1);assert.equal(fresh.signals[0].payload.sdp,'new');assert.ok(fresh.cursor>before);
  await f.call('mother',{type:'answer',payload:{type:'answer',sdp:'answer'}});
  assert.equal((await f.call('doctor',null,fresh.cursor)).body.signals[0].type,'answer');
 }finally{await f.close();}
});
