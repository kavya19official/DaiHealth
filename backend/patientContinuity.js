'use strict';
const fs=require('node:fs'),path=require('node:path');
const config=require('./continuity-config.json');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
const day=d=>(new Date(d+'T00:00:00Z').getUTCDay()+6)%7;
const dateValid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
const time=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function openPortal(readOnly=true){const file=process.env.DAI_PORTAL_DB||path.join(__dirname,'../.local/portal.db');if(process.env.DAI_LOCAL!=='true'||!fs.existsSync(file))return null;const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(file,{readOnly});if(!readOnly)db.exec('PRAGMA busy_timeout=3000');return db;}
async function catalogue(pool,motherId){
 const base=(await pool.query('SELECT u.id,dp.full_name,dp.specialization,dp.facility_name FROM users u LEFT JOIN doctor_profiles dp ON dp.user_id=u.id WHERE u.role=\'doctor\' ORDER BY dp.full_name')).rows;
 const db=openPortal();if(!db)return {doctors:base.map(d=>({...d,sessions:[],booking_supported:false})),facilities:[],assigned_doctor_id:null};
 try{
  if(!(await pool.query("SELECT to_regclass('public.dai_local_source_link') AS found")).rows[0]?.found)return {doctors:[],facilities:[]};
  const links=(await pool.query("SELECT * FROM dai_local_source_link WHERE entity='doctor' OR (entity='mother' AND target_id=$1)",[motherId])).rows;
  const motherLink=links.find(x=>x.entity==='mother'),mother=motherLink?db.prepare('SELECT * FROM mother WHERE id=?').get(motherLink.portal_uuid):null;
  const facilities=db.prepare('SELECT id,name,tier,ownership,address,lat,lng,capabilities FROM facility').all().map(f=>({...f,registered:f.id===mother?.registered_facility_id,capabilities:JSON.parse(f.capabilities||'{}'),fee_status:'Confirm charges and eligibility with the centre',hours:'See the selected clinic session'})).sort((a,b)=>Number(b.registered)-Number(a.registered)||a.name.localeCompare(b.name));
  const doctors=[];
  for(const d of base){const link=links.find(x=>x.entity==='doctor'&&x.target_id===d.id);if(!link)continue;const u=db.prepare('SELECT * FROM portal_user WHERE id=? AND verified=1').get(link.portal_uuid);if(!u)continue;const unit=u.unit_id?db.prepare('SELECT * FROM unit WHERE id=?').get(u.unit_id):null;
   // Hospital configuration is the authority for unit days and rooms. Sessions are a demo booking window.
   const days=[...new Set([unit?.anc_day,unit?.gynae_day,unit?.opd_day].filter(x=>Number.isInteger(x)))];
   const sessions=days.map(weekday=>({day:weekday,start:config.fallback_session_start,end:config.fallback_session_end,kind:weekday===unit?.anc_day?'ANC':weekday===unit?.gynae_day?'Gynaecology':'Paediatrics',room:unit?.room||null}));
   let languages=[],maxDaily=null;const sourceFile=path.resolve(process.env.DAI_HOSPITAL_DB||path.join(__dirname,'data/dai-hospital.db'));if(fs.existsSync(sourceFile)){const {DatabaseSync}=require('node:sqlite'),source=new DatabaseSync(sourceFile,{readOnly:true});try{const recorded=source.prepare('SELECT day,start_time,end_time FROM doctor_schedules WHERE doctor_id=? AND is_on_call=0').all(u.source_id);for(const session of sessions){const match=recorded.find(r=>r.day===session.day);if(match){session.start=match.start_time;session.end=match.end_time;}}if(source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='doctors'").get()){const profile=source.prepare('SELECT languages_spoken,max_daily_patients FROM doctors WHERE doctor_id=?').get(u.source_id);if(profile){try{languages=JSON.parse(profile.languages_spoken);}catch{languages=String(profile.languages_spoken||'').split(',').filter(Boolean);}maxDaily=profile.max_daily_patients;}}}finally{source.close();}}
   doctors.push({...d,portal_uuid:u.id,source_id:u.source_id,facility_id:u.facility_id,unit_id:u.unit_id,unit_label:unit?.code||null,room:unit?.room||null,languages,max_daily_patients:maxDaily,sessions,assigned:u.id===mother?.assigned_doctor_id,booking_supported:sessions.length>0,slot_minutes:config.request_window_minutes,slot_note:config.assumptions});
  }
  doctors.sort((a,b)=>Number(b.assigned)-Number(a.assigned)||Number(b.facility_id===mother?.registered_facility_id)-Number(a.facility_id===mother?.registered_facility_id)||a.full_name.localeCompare(b.full_name));
  return {doctors,facilities,assigned_doctor_id:doctors.find(d=>d.assigned)?.id||null,data_label:'Simulated on synthetic data',slot_assumptions:config};
 }finally{db.close();}
}
function sessionFor(doctor,date,requestedTime,visitType){
 const sessions=doctor.sessions.filter(s=>s.day===day(date));
 const preferred=visitType==='antenatal'?sessions.filter(s=>s.kind==='ANC'):visitType==='paediatric'||visitType==='baby_vaccine'?sessions.filter(s=>s.kind==='Paediatrics'):sessions;
 return preferred.find(s=>minutes(requestedTime)>=minutes(s.start)&&minutes(requestedTime)+doctor.slot_minutes<=minutes(s.end)&&(minutes(requestedTime)-minutes(s.start))%doctor.slot_minutes===0);
}
async function validateBooking(pool,motherId,b,excludeId=0){
 if(!dateValid(b.requested_date)||b.requested_date<today())throw fail('Choose a valid upcoming date');
 if(b.requested_time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.requested_time))throw fail('Choose a valid time');
 const doctors=(await catalogue(pool,motherId)).doctors,doctor=doctors.find(d=>d.id===Number(b.doctor_id));
 if(!doctor)throw fail('Selected doctor is not available');
 if(b.requested_date===today()&&b.requested_time&&b.requested_time<=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()))throw fail('Choose a future request time');
 if(doctor.max_daily_patients){const count=(await pool.query("SELECT COUNT(*)::integer AS n FROM appointments WHERE doctor_id=$1 AND requested_date=$2 AND status IN ('pending','confirmed') AND id<>$3",[b.doctor_id,b.requested_date,excludeId])).rows[0].n;if(count>=doctor.max_daily_patients)throw fail('This doctor’s daily request capacity is full',409);}
 let context={};
 if(doctor.booking_supported){if(!b.requested_time)throw fail('Choose one of the unit’s available appointment times');const session=sessionFor(doctor,b.requested_date,b.requested_time,b.visit_type);if(!session)throw fail('This time does not match the unit’s configured OPD day or request window');
  const taken=await pool.query("SELECT id FROM appointments WHERE doctor_id=$1 AND requested_date=$2 AND requested_time=$3 AND status IN ('pending','confirmed') AND id<>$4",[b.doctor_id,b.requested_date,b.requested_time,excludeId]);if(taken.rows.length)throw fail('This request window is already taken. Please choose another.',409);
  context={facility_uuid:doctor.facility_id,unit_uuid:doctor.unit_id,unit_label:doctor.unit_label,room:session.room,slot_end:time(minutes(b.requested_time)+doctor.slot_minutes)};
 }
 if(b.child_id){const r=await pool.query('SELECT id FROM children WHERE id=$1 AND mother_id=$2',[b.child_id,motherId]);if(!r.rows.length)throw fail('Choose a child from your own records');}
 if(b.milestone_id){const r=await pool.query('SELECT id FROM care_milestones WHERE id=$1 AND mother_id=$2',[b.milestone_id,motherId]);if(!r.rows.length)throw fail('Choose a milestone from your own care plan');}
 return context;
}
async function queueBridge(client,appointmentId){await client.query('INSERT INTO patient_hospital_outbox(appointment_id) VALUES($1) ON CONFLICT(appointment_id) DO UPDATE SET updated_at=NOW(),synced_at=NULL',[appointmentId]);}
async function syncBridge(pool){
 if(process.env.DAI_LOCAL!=='true')return;
 const rows=(await pool.query(`SELECT a.*,o.updated_at AS outbox_version,ml.source_id AS mother_source_id,ml.portal_uuid AS mother_uuid,dl.source_id AS doctor_source_id,dp.full_name AS doctor FROM patient_hospital_outbox o JOIN appointments a ON a.id=o.appointment_id JOIN dai_local_source_link ml ON ml.entity='mother' AND ml.target_id=a.mother_id JOIN dai_local_source_link dl ON dl.entity='doctor' AND dl.target_id=a.doctor_id JOIN doctor_profiles dp ON dp.user_id=a.doctor_id WHERE o.synced_at IS NULL LIMIT 100`)).rows;
 if(!rows.length)return;
 const db=openPortal(false);if(!db)return;
 try{
  db.exec('CREATE TABLE IF NOT EXISTS patient_appointment_bridge(appointment_id TEXT PRIMARY KEY,mother_id TEXT NOT NULL,facility_uuid TEXT,unit_uuid TEXT,doctor TEXT,appointment_date TEXT,start_time TEXT,end_time TEXT,reason TEXT,status TEXT,updated_at TEXT NOT NULL)');
  const upsert=db.prepare('INSERT INTO patient_appointment_bridge VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(appointment_id) DO UPDATE SET facility_uuid=excluded.facility_uuid,unit_uuid=excluded.unit_uuid,doctor=excluded.doctor,appointment_date=excluded.appointment_date,start_time=excluded.start_time,end_time=excluded.end_time,reason=excluded.reason,status=excluded.status,updated_at=excluded.updated_at');
  for(const a of rows){if(!a.facility_uuid)continue;const version=String(a.updated_at);upsert.run('patient:'+a.id,a.mother_source_id,a.facility_uuid,a.unit_uuid,a.doctor,String(a.requested_date).slice(0,10),a.requested_time?.slice(0,5)||'',a.slot_end?.slice(0,5)||'',a.reason||'',a.status,version);await pool.query('UPDATE patient_hospital_outbox SET synced_at=NOW() WHERE appointment_id=$1 AND updated_at<=$2',[a.id,a.outbox_version]);}
 }finally{db.close();}
}
async function readRecords(pool,id){
 const profile=(await pool.query('SELECT full_name,blood_group,allergies,medical_conditions,current_medications,previous_complications,emergency_contact_name,emergency_contact_phone,lmp_date,edd_date,gravida,parity FROM mother_profiles WHERE user_id=$1',[id])).rows[0]||{};
 const db=openPortal(),clinical={visits:[],delivery:null,babies:[],clinician_status:null};
 if(db)try{const found=(await pool.query("SELECT to_regclass('public.dai_local_source_link') AS found")).rows[0]?.found;const link=found?(await pool.query("SELECT * FROM dai_local_source_link WHERE entity='mother' AND target_id=$1",[id])).rows[0]:null;const mother=link?db.prepare('SELECT * FROM mother WHERE id=?').get(link.portal_uuid):null;
  if(mother){const marked=mother.validated_by?db.prepare('SELECT name,verified FROM portal_user WHERE id=?').get(mother.validated_by):null;if(mother.clinician_high_risk&&marked?.verified)clinical.clinician_status={doctor:marked.name,reason:mother.high_risk_reason_by_clinician};const childLinks=(await pool.query("SELECT source_id,target_id FROM dai_local_source_link WHERE entity='child'")).rows;clinical.blood_group=mother.blood_group;clinical.babies=db.prepare('SELECT source_id,birth_order,details FROM child WHERE mother_id=? ORDER BY birth_order').all(mother.id).map(c=>({...c,local_child_id:childLinks.find(x=>x.source_id===c.source_id)?.target_id||null,details:JSON.parse(c.details||'{}')}));
   const sourceFile=path.resolve(process.env.DAI_HOSPITAL_DB||path.join(__dirname,'data/dai-hospital.db'));if(fs.existsSync(sourceFile)){const {DatabaseSync}=require('node:sqlite'),s=new DatabaseSync(sourceFile,{readOnly:true});try{
    clinical.visits=s.prepare('SELECT a.visit_date,a.gestational_week_at_visit,a.bp_systolic,a.bp_diastolic,a.weight_kg,a.hb,a.fundal_height_cm,d.name doctor,h.name facility FROM anc_visits a JOIN pregnancies p USING(pregnancy_id) JOIN doctors d USING(doctor_id) JOIN hospitals h ON h.hospital_id=a.hospital_id WHERE p.mother_id=? ORDER BY a.visit_date DESC').all(mother.source_id);
    clinical.delivery=s.prepare('SELECT d.delivered_at,d.mode,d.complications,d.discharged_at,h.name hospital FROM delivery_records d JOIN pregnancies p USING(pregnancy_id) JOIN hospitals h ON h.hospital_id=d.hospital_id WHERE p.mother_id=? ORDER BY d.delivered_at DESC LIMIT 1').get(mother.source_id)||null;
   }finally{s.close();}}
  }
 }finally{db.close();}
 return {profile,clinical,data_label:'Simulated on synthetic data',provenance:'Clinical source records and separately labelled profile entries. Unknown values are not inferred.'};
}
module.exports=function registerContinuity(app,{pool,authenticateToken,authorizeRole}){
 const own=[authenticateToken,authorizeRole(['mother'])];
 if(process.env.DAI_LOCAL==='true'){const retry=setInterval(()=>syncBridge(pool).catch(e=>console.warn('Hospital mirror retry pending:',e.message)),15000);retry.unref();}
 app.get('/api/patient/booking-options',...own,async(req,res)=>{try{await syncBridge(pool).catch(e=>console.warn('Appointment mirror pending:',e.message));res.set('Cache-Control','no-store').json(await catalogue(pool,req.user.id));}catch(e){console.error(e);res.status(500).json({error:'Could not load clinic sessions'});}});
 app.get('/api/patient/booking-slots',...own,async(req,res)=>{try{
  const doctor=(await catalogue(pool,req.user.id)).doctors.find(d=>d.id===Number(req.query.doctor_id));if(!doctor)return res.status(404).json({error:'Doctor unavailable'});
  const start=dateValid(req.query.from)&&req.query.from>=today()?req.query.from:today();const days=[];for(let i=0;i<config.booking_horizon_days;i++){const date=new Date(Date.parse(start+'T00:00:00Z')+i*86400000).toISOString().slice(0,10);for(const s of doctor.sessions||[])if(s.day===day(date)){const slots=[];const taken=(await pool.query("SELECT requested_time FROM appointments WHERE doctor_id=$1 AND requested_date=$2 AND status IN ('pending','confirmed') AND id<>$3",[doctor.id,date,Number(req.query.exclude_id)||0])).rows.map(x=>x.requested_time?.slice(0,5));for(let n=minutes(s.start);n+doctor.slot_minutes<=minutes(s.end);n+=doctor.slot_minutes){const t=time(n);if(!(date===today()&&t<=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()))&&(!doctor.max_daily_patients||taken.length<doctor.max_daily_patients)&&!taken.includes(t)&&sessionFor(doctor,date,t,req.query.visit_type))slots.push(t);}if(slots.length)days.push({date,kind:s.kind,room:s.room,times:slots});}}
  res.set('Cache-Control','no-store').json({doctor_id:doctor.id,days,booking_supported:doctor.booking_supported,note:doctor.slot_note||'No confirmed OPD schedule. Contact the facility for a call-back.'});
 }catch(e){res.status(500).json({error:'Could not load appointment windows'});}});
 app.get('/api/patient/records',...own,async(req,res)=>{try{const records=await readRecords(pool,req.user.id);await pool.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'self_records_view','{}')",[req.user.id]);res.set('Cache-Control','no-store').json(records);}catch(e){console.error('Records:',e.message);res.status(500).json({error:'Could not load your records'});}});
};
Object.assign(module.exports,{catalogue,validateBooking,queueBridge,syncBridge,readRecords,dateValid,sessionFor});
