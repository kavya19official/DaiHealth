'use strict';
const crypto=require('node:crypto');
const {faqs}=require('../frontend/js/daya-knowledge');
const TASKS=Object.freeze({
 'visit-questions':'Draft a structured list of non-medical logistical questions someone can ask a care centre before a visit: booking, accessibility, language support, opening times, costs to confirm and how to ask about follow-up. Do not invent answers or eligibility. Do not provide medical advice.',
 'sharing-checklist':'Draft a detailed plain-language checklist for discussing record sharing with a care team: purpose, recipient, minimum necessary documents, duration, withdrawal and questions to ask. Do not claim legal compliance, access to records or actions performed.'
});
function register(app,{pool,authenticateToken,env=process.env,fetchImpl=fetch,now=Date.now,usageTracker=null}){
 const education={revision:'prepared-faq-v1',scope:'Prepared general information; no patient records',faqs:faqs.map(f=>({id:f.id,category:f.category,question:f.question,answer:f.answer,sources:f.sources,navigation:f.navigation}))};
 let directory=null,pending=null;const rates=new Map(),inflight=new Set(),recent=new Map();
 function publicJson(req,res,value,ttl){
  const etag='"'+crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')+'"';
  res.set({'Cache-Control':`public, max-age=${ttl}, must-revalidate`,ETag:etag,'X-DAI-Cache-Scope':'public-non-personal'});
  if(req.headers['if-none-match']===etag)return res.status(304).end();return res.json(value);
 }
 app.get('/api/public/assistance-content',(req,res)=>{
  if(Object.keys(req.query).length)return res.status(400).set('Cache-Control','no-store').json({error:'This public catalogue accepts no patient or search parameters.'});
  return publicJson(req,res,education,300);
 });
 app.get('/api/public/facility-metadata',async(req,res)=>{
  if(Object.keys(req.query).length)return res.status(400).set('Cache-Control','no-store').json({error:'Use live search for location, availability or preferences.'});
  try{
   if(!directory||directory.expires<=now()){
    if(!pending)pending=(async()=>{
     const rows=(await pool.query('SELECT id,name,facility_type,city,state,pincode FROM facilities WHERE active=TRUE ORDER BY id LIMIT 500')).rows;
     // Project again even if the database adapter returns unexpected fields.
     const facilities=rows.map(f=>({id:f.id,name:f.name,facility_type:f.facility_type,city:f.city,state:f.state,pincode:f.pincode}));
     const value={facilities,fetched_at:new Date(now()).toISOString(),scope:'Basic directory metadata only; confirm services and availability with live search.',limit:500};
     directory={value,expires:now()+60000};return directory;
    })().finally(()=>{pending=null;});
    await pending;
   }
   // Browser caching is disabled here: the server owns a single 60-second freshness budget.
   // Otherwise a late cache hit could start a second 60-second browser lifetime.
   res.set({'Cache-Control':'no-store','X-DAI-Cache-Scope':'server-public-metadata','X-DAI-Metadata-Expires':new Date(directory.expires).toISOString()});
   return res.json(directory.value);
  }catch{return res.status(503).set('Cache-Control','no-store').json({error:'Directory unavailable. No expired metadata was served.'});}
 });
 app.post('/api/assistance/complex',authenticateToken,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!['mother','doctor'].includes(req.user?.role))return res.status(403).json({error:'Patient or doctor account required.'});
  const b=req.body||{};
  if(['pregnancy_risk','clinical_recommendation','document_interpretation'].includes(b.task))return res.status(422).json({error:'This task requires a clinician-approved workflow. Open Care timeline → Clinician review requests or share the original report in Records.',review_required:true});
  if(Buffer.byteLength(JSON.stringify(b),'utf8')>1024)return res.status(413).json({error:'Use only a task ID, language and approval. Context is limited to 1 KB; histories and documents are not accepted.'});
  if(Object.keys(b).some(k=>!['task','language','approved'].includes(k))||!Object.hasOwn(TASKS,b.task)||!['en','hi'].includes(b.language))return res.status(400).json({error:'Choose a supported general drafting task and language. Patient details and free-text prompts are not accepted.'});
  if(b.approved!==true)return res.status(409).json({error:'Approve this external AI task before sending it. Nothing has been sent.'});
  if(env.DAI_COMPLEX_AI_ENABLED!=='true'||!env.DAI_COMPLEX_AI_MODEL||!env.GEMINI_API_KEY)return res.status(503).json({error:'Optional external drafting is not configured. Local FAQ answers remain available.'});
  const time=now();for(const [id,v]of rates)if(v.expires<=time)rates.delete(id);
  const id=String(req.user.id),rate=rates.get(id)||{count:0,expires:time+600000};
  if(rate.count>=5||rates.size>=10000)return res.status(429).json({error:'Drafting limit reached. Try later.'});
  for(const [key,value]of recent)if(time-value.at>=30000)recent.delete(key);
  if(inflight.has(id))return res.status(409).json({error:'A draft is already in progress. No second model call was made.'});
  const last=recent.get(id);if(last?.task===b.task&&last.language===b.language)return res.status(409).json({error:'This draft was just requested. Read the existing result or wait 30 seconds before approving another attempt.'});
  rate.count++;rates.set(id,rate);inflight.add(id);recent.set(id,{task:b.task,language:b.language,at:time});
  const usage=await usageTracker?.start({owner_id:req.user.id,kind:'general_draft',task_key:b.task,model:env.DAI_COMPLEX_AI_MODEL,provider_called:true});let providerResponse=null,providerStatus=null;
  try{
   usage?.sent();
   const result=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.DAI_COMPLEX_AI_MODEL)}:generateContent`,{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},signal:AbortSignal.timeout(15000),
    body:JSON.stringify({contents:[{parts:[{text:TASKS[b.task]+` Write in ${b.language==='hi'?'Hindi':'English'}. This is a general draft, not an official instruction. Do not ask for or infer personal health information.`}]}],generationConfig:{temperature:0.2,maxOutputTokens:700}})
   });
   providerStatus=result.status??null;
   const value=await result.json();providerResponse=value;usage?.received();
   if(!result.ok)throw Error('Provider unavailable');
   const text=value.candidates?.[0]?.content?.parts?.map(p=>typeof p.text==='string'?p.text:'').join('\n').trim();
   if(!text)throw Error('No draft');
   const usageReceipt=await usage?.finish({outcome:'returned',response:providerResponse,http_status:providerStatus});
   return res.json({usage:usageReceipt||{recorded:false},text:text.slice(0,6000),source:'external-ai',task:b.task,notice:'AI-generated general draft. Check it before use. No patient records or conversation were sent. This draft is not cached.'});
  }catch(error){await usage?.finish({outcome:['AbortError','TimeoutError'].includes(error?.name)?'timeout':'failed',response:providerResponse,http_status:providerStatus});return res.status(502).json({error:'External drafting unavailable. No automatic retry was made. Wait 30 seconds before approving another attempt; local FAQs still work.'});}finally{inflight.delete(id);}
 });
}
module.exports={register,TASKS};
