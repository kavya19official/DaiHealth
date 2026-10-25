'use strict';
const crypto=require('node:crypto'),jwt=require('jsonwebtoken');
const {NEEDS}=require('./delhiPatientJourney');
module.exports=function(app,{pool,authenticateToken}){
 const prefix='/api/facilities/demo-journey/requests';
 async function patient(req,res,next){
  if(process.env.DAI_LOCAL!=='true'||process.env.DAI_DEMO!=='true')return res.status(404).json({error:'Synthetic request workflow is available in local demo mode only.'});
  if(req.user?.role!=='mother')return res.status(403).json({error:'Patient account required.'});
  try{const u=(await pool.query('SELECT u.email,m.full_name FROM users u JOIN mother_profiles m ON m.user_id=u.id WHERE u.id=$1',[req.user.id])).rows[0];
   if(!u||!u.email.endsWith('@dai-synthetic.invalid'))return res.status(403).json({error:'Use a synthetic patient account for this demonstration.'});
   req.demoPatient={sub:'node-mother:'+req.user.id,patient_name:String(u.full_name||'Synthetic patient').slice(0,150)};next();
  }catch{res.status(503).json({error:'Could not verify the synthetic patient account.'});}
 }
 async function forward(req,res,path,method,body){
  try{
   const origin=new URL(process.env.DAI_PORTAL_API_ORIGIN||'http://127.0.0.1:8100');
   if(!['127.0.0.1','localhost'].includes(origin.hostname)||origin.protocol!=='http:')throw Error('Local portal origin required');
   const raw=body===undefined?'':JSON.stringify(body),secret=process.env.JWT_SECRET;
   if(!secret||secret.length<32)throw Error('Shared local authentication secret missing');
   const token=jwt.sign({...req.demoPatient,method,path,body_sha256:crypto.createHash('sha256').update(raw).digest('hex')},secret,{algorithm:'HS256',issuer:'dai-patient-coordination',audience:'dai-hospital-coordination',expiresIn:45});
   const result=await fetch(new URL(path,origin),{method,headers:{'Content-Type':'application/json','x-dai-coordination':token},body:method==='GET'?undefined:raw,signal:AbortSignal.timeout(10000),redirect:'error'});
   const type=result.headers.get('content-type')||'';
   if(!type.includes('application/json'))return res.status(502).json({error:'Hospital request API returned an unexpected page. Restart npm start with the update installed.'});
   const value=await result.json();res.set('Cache-Control','private, no-store');
   if(!result.ok)return res.status(result.status).json({error:typeof value.detail==='string'?value.detail:'Request could not be processed. Check the form and retry.'});
   res.status(result.status).json(value);
  }catch{return res.status(503).json({error:'Hospital request service is unavailable. Restart npm start, then retry; no confirmation was received.'});}
 }
 app.get(prefix,authenticateToken,patient,(req,res)=>forward(req,res,'/api/demo-coordination/patient/requests','GET'));
 app.post(prefix,authenticateToken,patient,async(req,res)=>{
  const b=req.body||{};
  if(!Object.hasOwn(NEEDS,b.need)||!['appointment','referral'].includes(b.kind)||b.consent!==true||typeof b.request_key!=='string'||b.request_key.length<16||b.request_key.length>80||typeof b.patient_note!=='string'||b.patient_note.length>500)return res.status(400).json({error:'Choose a request type, provide valid details and confirm sharing consent.'});
  if(!Number.isSafeInteger(b.facility_id)||b.facility_id<1)return res.status(400).json({error:'Select a facility from the eligible shortlist.'});
  try{const f=(await pool.query(`SELECT f.facility_code FROM facilities f WHERE f.id=$1 AND f.active=TRUE AND f.verification_source='synthetic_delhi_focused_v1' AND EXISTS(SELECT 1 FROM facility_services s WHERE s.facility_id=f.id AND s.available=TRUE AND s.service_category=$2)`,[b.facility_id,NEEDS[b.need].service])).rows[0];
   if(!f)return res.status(409).json({error:'This facility no longer lists the required service. Search again.'});
   return forward(req,res,'/api/demo-coordination/patient/requests','POST',{directory_code:f.facility_code.replace('DAI-DELHI-FOCUSED-',''),kind:b.kind,need:b.need,service:NEEDS[b.need].service,requested_date:b.requested_date||'',patient_note:b.patient_note,request_key:b.request_key,consent:true});
  }catch{return res.status(503).json({error:'Could not check facility eligibility. Please retry.'});}
 });
 app.post(prefix+'/:id/cancel',authenticateToken,patient,(req,res)=>{
  if(!/^[\da-f-]{36}$/i.test(req.params.id))return res.status(400).json({error:'Invalid request identifier.'});
  return forward(req,res,'/api/demo-coordination/patient/requests/'+req.params.id+'/cancel','POST',req.body);
 });
};
