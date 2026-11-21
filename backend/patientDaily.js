'use strict';
const Model=require('../shared/daily-tracking'),EM=require('../shared/emergency-triage'),{dateValid}=require('./patientContinuity'),{verifiedDoctor}=require('./clinicalDashboard'),access=require('./accessControl');
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function range(end){const d=new Date(end+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-6);return d.toISOString().slice(0,10);}
async function summary(pool,id,end){const from=range(end),bounds=[id,from,end];const [entries,logs,water,supplements,meals,targets,profile,appointments,shares,prefs,candidates,carePlan]=await Promise.all([
 pool.query('SELECT id,kind,data,log_date,logged_at FROM patient_daily_entries WHERE mother_id=$1 AND log_date BETWEEN $2 AND $3 ORDER BY logged_at',bounds),
 pool.query("SELECT id,log_type,data,logged_at FROM health_logs WHERE mother_id=$1 AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date ORDER BY logged_at",bounds),
 pool.query('SELECT log_date,glasses FROM water_logs WHERE mother_id=$1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date',bounds),
 pool.query('SELECT log_date,supplement,taken FROM supplement_logs WHERE mother_id=$1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date',bounds),
 pool.query('SELECT log_date,text,logged_at FROM nutrition_logs WHERE mother_id=$1 AND log_date BETWEEN $2 AND $3 ORDER BY logged_at',bounds),
 pool.query('SELECT e.targets_json,e.recorded_on,dp.full_name AS doctor FROM clinical_dashboard_entries e JOIN doctor_profiles dp ON dp.user_id=e.doctor_id WHERE e.mother_id=$1 ORDER BY e.recorded_on DESC,e.id DESC',[id]),
 pool.query('SELECT full_name,pregnancy_status,care_start_date,pregnancy_confirmed_at FROM mother_profiles WHERE user_id=$1',[id]),
 pool.query("SELECT id,requested_date,requested_time,status,reason FROM appointments WHERE mother_id=$1 AND requested_date >= $2 AND status NOT IN ('cancelled','completed') ORDER BY requested_date LIMIT 10",[id,end]),
 pool.query('SELECT c.doctor_id,dp.full_name AS name,c.expires_at FROM patient_daily_consent c JOIN doctor_profiles dp ON dp.user_id=c.doctor_id WHERE c.mother_id=$1 AND c.expires_at>NOW()',[id]),
 pool.query('SELECT reminder_time,reminder_enabled FROM patient_daily_preferences WHERE mother_id=$1',[id]),
 pool.query('SELECT DISTINCT dp.user_id AS doctor_id,dp.full_name AS doctor_name FROM appointments a JOIN doctor_profiles dp ON dp.user_id=a.doctor_id WHERE a.mother_id=$1',[id]),
 pool.query('SELECT title,description FROM clinical_dashboard_plan WHERE mother_id=$1 ORDER BY created_at DESC',[id])]);
 const verified=[];for(const c of candidates.rows)if(await verifiedDoctor(pool,c.doctor_id))verified.push(c);
 const t={};for(const r of targets.rows)for(const [k,text]of Object.entries(r.targets_json))if(!t[k])t[k]={text,doctor:r.doctor,date:r.recorded_on};
 return {from,to:end,entries:entries.rows.filter(x=>['sleep','mood','activity','symptom'].includes(x.kind)),logs:logs.rows,water:water.rows,supplements:supplements.rows,meals:meals.rows,targets:t,profile:profile.rows[0]||{},appointments:appointments.rows,shares:shares.rows,preferences:prefs.rows[0]||{reminder_enabled:false,reminder_time:null},candidates:verified,carePlan:carePlan.rows,source:'Self-reported; not clinical confirmation',time_zone:'Asia/Kolkata'};
}
module.exports=function(app,{pool,authenticateToken,authorizeRole}){
 const mother=[authenticateToken,authorizeRole(['mother'])],doctor=[authenticateToken,authorizeRole(['doctor'])];
 const wrap=fn=>async(req,res)=>{res.set('Cache-Control','private, no-store');try{await fn(req,res);}catch(e){console.error('Daily tracking:',e.message);res.status(500).json({error:'Could not save or load daily tracking. Your input remains on this device.'});}};
 const audit=(id,event,detail)=>pool.query('INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,$2,$3::jsonb)',[id,event,JSON.stringify(detail)]);
 app.get('/api/patient/daily',...mother,wrap(async(req,res)=>{const end=req.query.date||today();if(!dateValid(end)||end>today())return res.status(400).json({error:'Choose a real date, no later than today.'});res.json(await summary(pool,req.user.id,end));}));
 app.post('/api/patient/daily/entries',...mother,wrap(async(req,res)=>{
  const b=req.body||{},data=Model.clean(b.kind,b.data),when=new Date(b.logged_at),day=b.date;
  if(!uuid.test(b.mutation_id||'')||!data||!dateValid(day)||day>today()||Number.isNaN(when.valueOf())||when>new Date(Date.now()+300000)||when<new Date(Date.now()-3*365*86400000)||when.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})!==day)return res.status(400).json({error:'Check the date, time and entry values.'});
  const client=await pool.connect();let created=false;
  try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO patient_daily_entries(mother_id,mutation_id,log_date,kind,data,logged_at) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING RETURNING id',[req.user.id,b.mutation_id,day,b.kind,JSON.stringify(data),when.toISOString()]);created=!!inserted.rows.length;
   if(!created){const prev=(await client.query('SELECT kind,data,log_date,logged_at FROM patient_daily_entries WHERE mother_id=$1 AND mutation_id=$2',[req.user.id,b.mutation_id])).rows[0];if(prev.kind!==b.kind||!require('node:util').isDeepStrictEqual(prev.data,data)||(prev.log_date instanceof Date?prev.log_date.toISOString().slice(0,10):String(prev.log_date).slice(0,10))!==day||new Date(prev.logged_at).valueOf()!==when.valueOf()){await client.query('ROLLBACK');return res.status(409).json({error:'This saved update differs from the queued copy. Review it before retrying.'});}}
   else if(b.kind==='water')await client.query('INSERT INTO water_logs(mother_id,log_date,glasses) VALUES($1,$2,1) ON CONFLICT(mother_id,log_date) DO UPDATE SET glasses=LEAST(water_logs.glasses+1,8)',[req.user.id,day]);
   else if(b.kind==='supplement')await client.query('INSERT INTO supplement_logs(mother_id,log_date,supplement,taken) VALUES($1,$2,$3,$4) ON CONFLICT(mother_id,log_date,supplement) DO UPDATE SET taken=$4',[req.user.id,day,data.supplement,data.taken]);
   else if(b.kind==='meal')await client.query('INSERT INTO nutrition_logs(mother_id,log_date,text,logged_at) VALUES($1,$2,$3,$4)',[req.user.id,day,data.text,when.toISOString()]);
   else if(['blood_pressure','weight','blood_glucose','kick_session'].includes(b.kind))await client.query('INSERT INTO health_logs(mother_id,log_type,data,logged_at) VALUES($1,$2,$3::jsonb,$4)',[req.user.id,b.kind,JSON.stringify(data),when.toISOString()]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  if(created&&['blood_pressure','blood_glucose'].includes(b.kind))await require('./riskService').runRiskAssessment(pool,req.user.id,{},'auto_log').catch(()=>{});
  res.status(created?201:200).json({saved:true,replayed:!created,source:'self_report'});
 }));
 app.put('/api/patient/daily/preferences',...mother,wrap(async(req,res)=>{const b=req.body||{};if(typeof b.enabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time||''))return res.status(400).json({error:'Choose a reminder time.'});await pool.query('INSERT INTO patient_daily_preferences(mother_id,reminder_time,reminder_enabled) VALUES($1,$2,$3) ON CONFLICT(mother_id) DO UPDATE SET reminder_time=$2,reminder_enabled=$3',[req.user.id,b.time,b.enabled]);res.json({saved:true});}));
 app.put('/api/patient/daily/consent',...mother,wrap(async(req,res)=>{const b=req.body||{};if(!Number.isInteger(b.doctor_id)||typeof b.allow!=='boolean'||b.allow&&b.confirmed!==true)return res.status(400).json({error:'Explicitly confirm the selected clinician.'});if(b.allow){if(!await verifiedDoctor(pool,b.doctor_id)||!await access.hasDoctorAccess(pool,b.doctor_id,req.user.id))return res.sendStatus(403);await pool.query("INSERT INTO patient_daily_consent(mother_id,doctor_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days') ON CONFLICT(mother_id,doctor_id) DO UPDATE SET expires_at=EXCLUDED.expires_at",[req.user.id,b.doctor_id]);}else await pool.query('DELETE FROM patient_daily_consent WHERE mother_id=$1 AND doctor_id=$2',[req.user.id,b.doctor_id]);await audit(req.user.id,'daily_consent',{doctor_id:b.doctor_id,allow:b.allow});res.json({saved:true});}));
 app.get('/api/doctor/patients/:motherId/daily-summary',...doctor,wrap(async(req,res)=>{const id=Number(req.params.motherId),end=req.query.date||today();if(!Number.isInteger(id)||id<1||!dateValid(end)||end>today())return res.sendStatus(400);if(!await verifiedDoctor(pool,req.user.id)||!await access.hasDoctorAccess(pool,req.user.id,id)||!(await pool.query('SELECT 1 FROM patient_daily_consent WHERE mother_id=$1 AND doctor_id=$2 AND expires_at>NOW()',[id,req.user.id])).rows.length)return res.status(403).json({error:'Daily tracking has not been shared with this clinician.'});const data=await summary(pool,id,end);delete data.shares;delete data.preferences;delete data.candidates;delete data.appointments;await audit(id,'doctor_daily_summary',{doctor_id:req.user.id,from:data.from,to:data.to});res.json(data);}));
};
Object.assign(module.exports,{summary,range});
