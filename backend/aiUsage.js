'use strict';
const crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const assessment=require('../config/privacy-deployment-assessment.json');
const integer=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const text=v=>typeof v==='string'?v.slice(0,160):null;
function providerUsage(response){const u=response?.usageMetadata||{};return {
 input_tokens:integer(u.promptTokenCount),output_tokens:integer(u.candidatesTokenCount),total_tokens:integer(u.totalTokenCount),cached_input_tokens:integer(u.cachedContentTokenCount),thought_tokens:integer(u.thoughtsTokenCount),
 reported_model_version:text(response?.modelVersion),provider_response_id:text(response?.responseId)
};}
function createTracker({pool,clock=()=>performance.now(),log=()=>console.warn('AI usage persistence unavailable; usage totals may be incomplete.'),writeTimeoutMs=1000}={}){
 const failures=new Map();let nextPurge=0;
 const write=async(sql,params)=>{let timer;try{return await Promise.race([pool.query(sql,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Usage write timeout')),writeTimeoutMs);})]);}finally{clearTimeout(timer);}};
 const noteFailure=owner=>{const key=owner??'anonymous';if(failures.size<10000||failures.has(key))failures.set(key,(failures.get(key)||0)+1);log();};
 return {
 failuresFor:owner=>failures.get(owner)??0,
 async start(meta){
  const id=crypto.randomUUID(),started=clock(),owner=Number.isSafeInteger(meta.owner_id)&&meta.owner_id>0?meta.owner_id:null;
  let saved=false,sentAt=null,receivedAt=null,done=false,receipt=null;
  try{
   // Fixed 30-day metadata retention. No prompt, answer, history, IP or API key is stored.
   if(Date.now()>=nextPurge){nextPurge=Date.now()+86400000;await write("DELETE FROM ai_usage_events WHERE created_at<NOW()-INTERVAL '30 days'");}
   await write("INSERT INTO ai_usage_events(id,owner_id,kind,task_key,requested_model,provider_called,provider,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,'started')",[id,owner,meta.kind,meta.task_key,text(meta.model)||'not configured',meta.provider_called===true,text(meta.provider)||'google']);saved=true;
  }catch{noteFailure(owner);}
  return {
   sent(){sentAt=clock();},
   received(){receivedAt=clock();},
   async finish({outcome,response=null,http_status=null}={}){
    if(done)return receipt||{event_id:null,recorded:false};done=true;
    const elapsed=Math.max(0,Math.min(2147483647,Math.round(clock()-started))),providerMs=sentAt===null?null:Math.max(0,Math.min(2147483647,Math.round((receivedAt??clock())-sentAt))),u=providerUsage(response);
    if(!saved)return receipt={event_id:null,recorded:false};
    try{await write(`UPDATE ai_usage_events SET outcome=$2,provider_http_status=$3,latency_ms=$4,provider_latency_ms=$5,input_tokens=$6,output_tokens=$7,total_tokens=$8,cached_input_tokens=$9,thought_tokens=$10,reported_model_version=$11,provider_response_id=$12,completed_at=NOW() WHERE id=$1`,[id,outcome,integer(http_status),elapsed,providerMs,u.input_tokens,u.output_tokens,u.total_tokens,u.cached_input_tokens,u.thought_tokens,u.reported_model_version,u.provider_response_id]);return receipt={event_id:id,recorded:true};}
    catch{noteFailure(owner);return receipt={event_id:null,recorded:false};}
   }
  };
 }
 };
}
function register(app,{pool,authenticateToken,env=process.env,tracker=createTracker({pool})}){
 app.get('/api/ai-usage/mine',authenticateToken,async(req,res)=>{
  res.set('Cache-Control','private, no-store');if(!['mother','doctor'].includes(req.user?.role))return res.status(403).json({error:'Patient or doctor account required.'});
  if(Object.keys(req.query).length)return res.status(400).json({error:'This view is scoped to your own last 30 days.'});
  try{
   const owner=req.user.id,where="owner_id=$1 AND created_at>=NOW()-INTERVAL '30 days'";
   const summary=(await pool.query(`SELECT COUNT(*)::int AS tracked_requests,COUNT(*) FILTER(WHERE provider_called)::int AS provider_attempts,COUNT(*) FILTER(WHERE outcome='returned')::int AS responses_returned,COUNT(*) FILTER(WHERE outcome IN ('failed','timeout'))::int AS failed,COUNT(*) FILTER(WHERE outcome='timeout')::int AS timeouts,COUNT(*) FILTER(WHERE outcome='started')::int AS unfinished,COUNT(*) FILTER(WHERE outcome='cache_hit')::int AS cache_hits,COUNT(*) FILTER(WHERE outcome='coalesced')::int AS coalesced,COUNT(*) FILTER(WHERE outcome='fallback')::int AS fallbacks,COUNT(*) FILTER(WHERE provider_called AND total_tokens IS NOT NULL)::int AS calls_with_total_tokens,SUM(total_tokens) AS reported_total_tokens,SUM(input_tokens) AS reported_input_tokens,SUM(output_tokens) AS reported_output_tokens,SUM(thought_tokens) AS reported_thought_tokens,COUNT(provider_latency_ms) FILTER(WHERE provider_called)::int AS round_trip_samples,AVG(provider_latency_ms) FILTER(WHERE provider_called) AS mean_server_round_trip_ms,COUNT(feedback_useful)::int AS feedback_count,COUNT(*) FILTER(WHERE feedback_useful=TRUE)::int AS useful_count FROM ai_usage_events WHERE ${where}`,[owner])).rows[0];
   const models=(await pool.query(`SELECT provider,requested_model,reported_model_version,COUNT(*)::int AS provider_attempts,SUM(total_tokens) AS reported_total_tokens FROM ai_usage_events WHERE ${where} AND provider_called GROUP BY provider,requested_model,reported_model_version ORDER BY requested_model`,[owner])).rows;
   const recent=(await pool.query(`SELECT id,kind,task_key,provider,requested_model,reported_model_version,provider_called,outcome,provider_http_status,provider_latency_ms,input_tokens,output_tokens,total_tokens,feedback_useful,created_at FROM ai_usage_events WHERE ${where} ORDER BY created_at DESC LIMIT 20`,[owner])).rows;
   res.json({window_days:30,scope:'Your authenticated requests only. Anonymous public speech and browser-local activity are excluded. Service attempts are not confirmed billed model invocations.',summary,models,recent,persistence_failures_this_process:tracker.failuresFor(owner),cost:{amount:null,currency:null,status:'Not reported by the generation API; provider billing is not connected. This is not a zero-cost claim.'},compute:{status:'Provider compute/energy not reported. Latency is measured by this server, not GPU time.'},quality:'Returned response means nonempty text, supported audio or a schema-valid ranking reached the backend; it may still be incomplete; it does not establish medical correctness or that audio played. Usefulness feedback is self-reported.',environmental_claim:'Water and carbon savings are not calculated.',deployment:{external_drafting_configured:env.DAI_COMPLEX_AI_ENABLED==='true'&&!!env.DAI_COMPLEX_AI_MODEL&&!!env.GEMINI_API_KEY,assessment}});
  }catch{return res.status(503).json({error:'Usage metrics unavailable. Do not interpret missing metrics as zero usage.'});}
 });
 app.post('/api/ai-usage/:id/feedback',authenticateToken,async(req,res)=>{
  res.set('Cache-Control','private, no-store');const b=req.body||{};
  if(!['mother','doctor'].includes(req.user?.role))return res.status(403).json({error:'Patient or doctor account required.'});
  if(!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(req.params.id)||Object.keys(b).some(k=>k!=='useful')||typeof b.useful!=='boolean')return res.status(400).json({error:'Choose useful or not useful; no free-text or patient details are accepted.'});
  try{const row=(await pool.query("UPDATE ai_usage_events SET feedback_useful=$3,feedback_at=NOW() WHERE id=$1 AND owner_id=$2 AND kind='general_draft' AND outcome='returned' AND created_at>=NOW()-INTERVAL '30 days' RETURNING id",[req.params.id,req.user.id,b.useful])).rows[0];if(!row)return res.status(404).json({error:'Returned draft not found in your scope.'});return res.json({saved:true});}catch{return res.status(503).json({error:'Feedback was not saved.'});}
 });
 return tracker;
}
module.exports={providerUsage,createTracker,register};
