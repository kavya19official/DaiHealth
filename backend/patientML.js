'use strict';
const EVENTS=new Set(['reminder_opened','action_started','action_completed','facility_viewed','facility_chosen']);
const CLASSES=new Set(['rank-gaps','rank-facilities','best-send-time','support-suggestions']);
const label=source=>source==='ml'?'Simulated on synthetic data':'Rule-based assistance';
const enabled=()=>process.env.ML_ENABLED==='true';
const SUPPORT_POLICY='support-release-v1';
function knownFields(b){return new Set(Array.isArray(b.known_features)?b.known_features:Object.keys(b.features||{}));}
const gapOrder=(a,b)=>({overdue:0,week:1,upcoming:2}[a.bucket||'overdue']-{overdue:0,week:1,upcoming:2}[b.bucket||'overdue'])||Number(b.clinician_priority)-Number(a.clinician_priority)||b.days_overdue-a.days_overdue;
function rules(kind,b={}){
 if(kind==='rank-gaps')return {items:[...(b.gaps||[])].sort(gapOrder).map(g=>({id:String(g.id),source:'rules',reason:(g.days_overdue?'Overdue by '+g.days_overdue+' days':'Upcoming care in your recorded plan')+(g.clinician_priority?' and marked important by your clinician':'')})),source:'rules',data_label:label('rules')};
 if(kind==='rank-facilities')return {items:[...(b.candidates||[])].filter(f=>f.offers_service).sort((a,b)=>(Number.isFinite(a.distance_km)?a.distance_km:Infinity)-(Number.isFinite(b.distance_km)?b.distance_km:Infinity)).map(f=>({id:String(f.id),source:'rules',reason:'Listed for this service'+(Number.isFinite(f.distance_km)?' · '+f.distance_km+' km away':'')+' · confirm details with the centre'})),source:'rules',data_label:label('rules')};
 if(kind==='best-send-time')return {hour:9,channel:'app',reason:'A 9 AM app reminder; your quiet hours still apply.',source:'rules',data_label:label('rules')};
 const actions=[],f=b.features||{},known=knownFields(b);
 if(b.consent?.personalization){
  if(b.consent.location&&known.has('distance_km')&&Number.isFinite(f.distance_km)&&f.distance_km>=5)actions.push({action:'nearby',reason:'Your recorded journey is '+f.distance_km+' km. You can look for a closer centre offering the planned service.'});
  if(known.has('prior_missed_visits')&&f.prior_missed_visits>0)actions.push({action:'asha',reason:'A previous visit is recorded as missed. You can ask your ASHA or care team for help planning the next visit.'});
  else if(known.has('caregiver_support')&&f.caregiver_support===0)actions.push({action:'asha',reason:'You reported needing caregiver support. You can ask your ASHA or care team for help planning the visit.'});
 }
 actions.push({action:'schemes',reason:'Check official maternity and transport support information; eligibility needs confirmation.'});
 return {actions,source:'rules',data_label:label('rules')};
}
function reportedOpen(f,service,now=new Date()){
 if(service==='emergency'&&f.emergency_24x7)return true;
 let hours=f.operating_hours;if(typeof hours==='string'){try{hours=JSON.parse(hours);}catch{return false;}}
 if(!hours||typeof hours!=='object')return false;
 const long=now.toLocaleDateString('en',{weekday:'long',timeZone:'Asia/Kolkata'}).toLowerCase(),short=long.slice(0,3),time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
 const entry=Object.entries(hours).find(([k])=>[long,short].includes(k.toLowerCase()));if(!entry||typeof entry[1]!=='string')return false;
 const m=entry[1].match(/(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})/);if(!m)return false;
 return m[1]<m[2]?time>=m[1]&&time<m[2]:time>=m[1]||time<m[2];
}
function validResponse(kind,out,b){
 if(!out||!['ml','rules'].includes(out.source))return false;
 if(kind.startsWith('rank-')){const input=kind==='rank-gaps'?b.gaps:b.candidates.filter(x=>x.offers_service);const allowed=new Set(input.map(x=>String(x.id)));return Array.isArray(out.items)&&out.items.length===allowed.size&&new Set(out.items.map(x=>x.id)).size===out.items.length&&out.items.every(x=>allowed.has(x.id)&&typeof x.reason==='string'&&x.reason.length&&x.source===out.source);}
 if(kind==='best-send-time')return Number.isInteger(out.hour)&&out.hour>=0&&out.hour<=23&&out.channel==='app'&&typeof out.reason==='string'&&!!out.reason;
 if(out.source==='ml'&&out.policy_version!==SUPPORT_POLICY)return false;
 return Array.isArray(out.actions)&&out.actions.every(a=>['nearby','asha','schemes'].includes(a.action)&&typeof a.reason==='string'&&a.reason.length);
}
async function request(kind,b,transport=fetch){
 const fallback=rules(kind,b);
 if(!enabled()||!b.consent?.personalization)return fallback;
 try{
  const url=process.env.PATIENT_ML_URL||'http://127.0.0.1:8200';
  const r=await transport(url+'/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(1500)});
  if(!r.ok)return fallback;const out=await r.json();if(!validResponse(kind,out,b))return fallback;
  // Explicit response allowlist: even an unexpected service field cannot expose a score.
  if(kind.startsWith('rank-')){
   let items=out.items.map(x=>({id:x.id,reason:x.reason.slice(0,500),source:out.source}));
   if(kind==='rank-gaps'){const original=new Map(b.gaps.map(g=>[String(g.id),g]));const indices=new Map(items.map((x,i)=>[x.id,i]));items.sort((a,c)=>{const x=original.get(a.id),y=original.get(c.id);return ({overdue:0,week:1,upcoming:2}[x.bucket]-{overdue:0,week:1,upcoming:2}[y.bucket])||Number(y.clinician_priority)-Number(x.clinician_priority)||indices.get(a.id)-indices.get(c.id);});}
   return {items,source:out.source,data_label:label(out.source)};
  }
  if(kind==='best-send-time')return {hour:out.hour,channel:out.channel,reason:out.reason.slice(0,500),source:out.source,data_label:label(out.source)};
  return {actions:out.actions.map(a=>({action:a.action,reason:a.reason.slice(0,500)})),source:out.source,data_label:label(out.source)};
 }catch{return fallback;}
}
async function context(pool,id){
 const settings=(await pool.query('SELECT * FROM patient_ml_settings WHERE patient_id=$1',[id])).rows[0]||{};
 const prefs={quiet_hours_enabled:true,quiet_start:'21:00',quiet_end:'07:00',...((await pool.query('SELECT preferences FROM patient_preferences WHERE user_id=$1',[id])).rows[0]?.preferences||{})};
 const consent={personalization:settings.personalization===true,location:settings.location===true,reminders:settings.reminders===true,events:settings.events===true,allowed_channels:['app']};
 let features,known_features=[];
 if(consent.personalization){
  const p=(await pool.query('SELECT lmp_date,pregnancy_status FROM mother_profiles WHERE user_id=$1',[id])).rows[0]||{};
  // Cancelled appointments do not prove missed visits; count explicit no-show queue events instead.
  const missed=Number((await pool.query("SELECT COUNT(*)::int AS n FROM doctor_queue_state q JOIN appointments a ON a.id=q.appointment_id WHERE a.mother_id=$1 AND q.state='no_show' AND a.requested_date<CURRENT_DATE",[id])).rows[0]?.n||0);
  const days=p.lmp_date?Math.floor((Date.now()-new Date(p.lmp_date).getTime())/86400000):0;
  known_features.push('prior_missed_visits');if(p.lmp_date&&p.pregnancy_status==='pregnant')known_features.push('week');
  features={age:26,week:p.pregnancy_status==='pregnant'?Math.max(0,Math.min(42,Math.floor(days/7))):0,prior_missed_visits:Math.min(5,missed),digital_literacy:1,caregiver_support:0,preferred_channel:0,distance_km:0};
  // Import only explicitly allowed source attributes; no condition or lab columns.
  if(process.env.DAI_LOCAL==='true'){
   try{const fs=require('fs'),path=require('path'),file=path.join(__dirname,'../synthetic_data/output/dai.db');const link=(await pool.query("SELECT source_id FROM dai_local_source_link WHERE entity='mother' AND target_id=$1",[id])).rows[0];if(link&&fs.existsSync(file)){const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file,{readOnly:true});try{const m=db.prepare("SELECT age,digital_literacy,CASE WHEN caregiver_contact IS NOT NULL AND caregiver_contact<>'' THEN 1 ELSE 0 END AS caregiver_support"+(consent.location?",distance_km":"")+" FROM mothers WHERE mother_id=?").get(link.source_id);if(m){known_features.push('age','digital_literacy');if(consent.location)known_features.push('distance_km');features.age=m.age;features.digital_literacy={low:0,medium:1,high:2}[m.digital_literacy]??1;features.caregiver_support=m.caregiver_support;if(consent.location)features.distance_km=m.distance_km;}}finally{db.close();}}}catch{/* Optional source unavailable: minimal allowed profile still works. */}
  }
 }
 return {patient_id:String(id),consent,features,known_features,prefs};
}
module.exports=function(app,{pool,authenticateToken,authorizeRole}){
 const own=[authenticateToken,authorizeRole(['mother'])];
 app.get('/api/patient/ml/settings',...own,async(req,res)=>{try{const c=await context(pool,req.user.id);res.set('Cache-Control','no-store').json({enabled:enabled(),consent:c.consent});}catch{res.status(503).json({error:'Assistance settings unavailable',enabled:false});}});
 app.put('/api/patient/ml/settings',...own,async(req,res)=>{const b=req.body||{},keys=['personalization','location','reminders','events'];if(Object.keys(b).some(k=>!keys.includes(k))||keys.some(k=>typeof b[k]!=='boolean'))return res.status(400).json({error:'Explicitly choose all assistance and event-sharing settings'});try{await pool.query(`INSERT INTO patient_ml_settings(patient_id,personalization,location,reminders,events) VALUES($1,$2,$3,$4,$5) ON CONFLICT(patient_id) DO UPDATE SET personalization=$2,location=$3,reminders=$4,events=$5,updated_at=NOW()`,[req.user.id,...keys.map(k=>b[k])]);await pool.query("UPDATE patient_reminder_plans SET state='cancelled' WHERE patient_id=$1 AND state IN ('scheduled','ready')",[req.user.id]);res.json({saved:true});}catch{res.status(500).json({error:'Settings were not saved'});}});
 app.post('/api/patient/ml/:kind',...own,async(req,res)=>{const kind=req.params.kind;if(!CLASSES.has(kind))return res.status(404).json({error:'Unknown assistance action'});try{
  const c=await context(pool,req.user.id),b={patient_id:c.patient_id,consent:c.consent,...(c.features?{features:c.features,known_features:c.known_features}:{})};
  if(kind==='rank-gaps'){
   const input=req.body?.gaps;if(!Array.isArray(input)||input.length>200||input.some(g=>!g||typeof g.id!=='string'||!/^mother-\d+$/.test(g.id)||g.gap_type!==undefined&&(!Number.isInteger(g.gap_type)||g.gap_type<0||g.gap_type>3))||new Set(input.map(g=>g.id)).size!==input.length)return res.status(400).json({error:'Expected up to 200 open care items'});
   const canonical=(await pool.query('SELECT cm.id,cm.due_date,cm.added_by_doctor_id,CASE WHEN dp.credential_verified THEN cm.clinician_priority ELSE NULL END AS clinician_priority FROM care_milestones cm LEFT JOIN doctor_profiles dp ON dp.user_id=cm.added_by_doctor_id WHERE cm.mother_id=$1 AND cm.completed_at IS NULL',[req.user.id])).rows;
   const known=new Map(canonical.map(x=>['mother-'+x.id,x]));b.gaps=[];
   for(const g of input){const m=known.get(g.id);if(!m)continue;const due=new Date(m.due_date).getTime(),days=Math.floor((Date.now()-due)/86400000);b.gaps.push({id:g.id,days_overdue:Math.max(0,days),clinician_priority:!!(m.added_by_doctor_id&&['urgent','high','important'].includes(String(m.clinician_priority))),bucket:days>0?'overdue':days>=-7?'week':'upcoming',gap_type:Math.min(3,Math.max(0,Number(g.gap_type)||0)),stage:Math.min(4,Math.max(0,Math.floor((c.features?.week||0)/13)))});}
  }
  if(kind==='rank-facilities'){
   const input=req.body?.candidates;if(!Array.isArray(input)||input.length>100||input.some(f=>!f||f.id===undefined||f.distance_km!==undefined&&(!Number.isFinite(f.distance_km)||f.distance_km<0||f.distance_km>20000))||new Set(input.map(f=>String(f.id))).size!==input.length)return res.status(400).json({error:'Expected up to 100 facilities'});
   // Server derives services, confirmation and reported slots; client cannot invent verification.
   const ids=input.map(x=>Number(x.id));if(ids.some(x=>!Number.isInteger(x)||x<1))return res.status(400).json({error:'Invalid facility IDs'});
   const rows=(await pool.query(`SELECT f.id,f.verified_at,f.emergency_24x7,f.operating_hours,EXISTS(SELECT 1 FROM facility_services s WHERE s.facility_id=f.id AND s.available=TRUE AND ($2='' OR (s.service_name=$2 OR s.service_category=$2))) AS offers_service,(SELECT COUNT(*)::int FROM facility_service_slots s JOIN facility_services ss ON ss.id=s.facility_service_id WHERE ss.facility_id=f.id AND s.available_places>0 AND s.starts_at>NOW()) AS slots FROM facilities f WHERE f.active=TRUE AND f.id=ANY($1::int[])`,[ids,String(req.body.needed_service||'').slice(0,100)])).rows;
   const distance=new Map(input.map(x=>[String(x.id),Number(x.distance_km)]));b.candidates=rows.map(f=>({id:String(f.id),distance_km:c.consent.location&&Number.isFinite(distance.get(String(f.id)))?Math.max(0,Math.min(20000,distance.get(String(f.id)))):null,offers_service:f.offers_service,open_now:reportedOpen(f,b.needed_service||String(req.body.needed_service||'')),days_since_confirmed:f.verified_at?Math.max(0,Math.floor((Date.now()-new Date(f.verified_at))/86400000)):10000,appointment_availability:f.slots}));b.needed_service=String(req.body.needed_service||'').slice(0,100);
  }
  const out=await request(kind,b);res.set('Cache-Control','no-store').json(out);
 }catch(e){console.error('Patient assistance:',e.message);res.status(503).json({error:'Assistance unavailable; keep the existing rule order',source:'rules'});}});
 app.post('/api/patient/ml-events',...own,async(req,res)=>{const b=req.body||{};if(!EVENTS.has(b.event_type)||typeof b.entity_id!=='string'||!/^[\w:.-]{1,120}$/.test(b.entity_id))return res.status(400).json({error:'Invalid event'});try{const c=await context(pool,req.user.id);if(!c.consent.events)return res.status(403).json({error:'Interaction logging needs your permission'});await pool.query("INSERT INTO events(patient_id,event_type,channel,entity_id) VALUES($1,$2,'app',$3)",[req.user.id,b.event_type,b.entity_id]);if(b.event_type==='reminder_opened'&&/^reminder-\d+$/.test(b.entity_id))await pool.query("UPDATE patient_reminder_plans SET state='opened' WHERE id=$1 AND patient_id=$2 AND state='ready'",[Number(b.entity_id.slice(9)),req.user.id]);res.status(201).json({saved:true});}catch{res.status(500).json({error:'Interaction was not logged'});}});
};
Object.assign(module.exports,{rules,request,context,enabled,validResponse,reportedOpen});
