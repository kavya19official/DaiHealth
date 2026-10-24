'use strict';
const path=require('node:path');
const fs=require('node:fs');
const bcrypt=require('bcrypt');
function clinicalSnapshot(visits,limit=2){
 const valid=visits.filter(v=>v.doctor_verified && v.doctor_id && v.visit_date).sort((a,b)=>String(b.visit_date).localeCompare(String(a.visit_date)));
 return [
  {type:'weight',unit:'kg',field:'weight_kg'},
  {type:'blood_pressure',unit:'mmHg',field:'bp_systolic'},
  {type:'haemoglobin',unit:'g/dL',field:'hb'}
 ].map(metric=>{
  const rows=valid.filter(v=>v[metric.field]!=null).slice(0,limit);
  return {...metric,readings:rows.map(v=>({value:Number(v[metric.field]),diastolic:metric.type==='blood_pressure'?Number(v.bp_diastolic):undefined,date:v.visit_date,doctor:v.doctor_name,source:'clinician_record'}))};
 }).concat([{type:'blood_glucose',unit:'mg/dL',readings:[]}]);
}
function sourceOverview(link,limit=2){
 const portal=path.resolve(__dirname,'../.local/portal.db'),source=path.resolve(process.env.DAI_HOSPITAL_DB||path.join(__dirname,'data/dai-hospital.db'));
 if(!link||!fs.existsSync(portal)||!fs.existsSync(source))return null;
 const {DatabaseSync}=require('node:sqlite');let p,s;
 try{
  p=new DatabaseSync(portal,{readOnly:true});s=new DatabaseSync(source,{readOnly:true});
  const mother=p.prepare('SELECT * FROM mother WHERE id=?').get(link.portal_uuid);if(!mother)return null;
  const staff=p.prepare("SELECT source_id,name FROM portal_user WHERE verified=1 AND role IN ('consultant','resident','hospital_admin')").all();
  const verified=new Set(staff.map(d=>d.source_id));
  const visits=s.prepare('SELECT a.*,d.name AS doctor_name FROM anc_visits a JOIN pregnancies pr ON pr.pregnancy_id=a.pregnancy_id JOIN doctors d ON d.doctor_id=a.doctor_id WHERE pr.mother_id=? ORDER BY a.visit_date DESC LIMIT 50').all(mother.source_id).map(v=>({...v,doctor_verified:verified.has(v.doctor_id)}));
  const validating=mother.validated_by?p.prepare('SELECT name,verified,role FROM portal_user WHERE id=?').get(mother.validated_by):null;
  const marked=!!(mother.clinician_high_risk&&validating?.verified&&['consultant','resident','hospital_admin'].includes(validating.role));
  const facilities=p.prepare('SELECT id,name,tier,address,lat,lng,emergency_24x7,capabilities FROM facility ORDER BY name').all().map(f=>({...f,capabilities:JSON.parse(f.capabilities||'{}')}));
  const doctor=p.prepare('SELECT name,verified FROM portal_user WHERE id=?').get(mother.assigned_doctor_id);
  const unit=mother.assigned_unit_id?p.prepare('SELECT code,anc_day FROM unit WHERE id=?').get(mother.assigned_unit_id):null;
  const care_team={doctor_name:doctor?.verified?doctor.name:null,unit:unit?.code||null,anc_day:unit?.anc_day||null,asha_name:null};
  const readiness={status:'unconfirmed',message:'Hospital readiness has not been confirmed for this case.'};
  return {care_team,readiness,metrics:clinicalSnapshot(visits,limit),clinician_status:marked?{marked_by_doctor:true,doctor:validating.name,reason:mother.high_risk_reason_by_clinician}:null,registered_facility:facilities.find(f=>f.id===mother.registered_facility_id)||null,facilities,assigned_doctor_uuid:mother.assigned_doctor_id,data_label:'Simulated on synthetic data'};
 }finally{p?.close();s?.close();}
}
module.exports=function registerPatientExperience(app,{pool,authenticateToken,authorizeRole}){
 const own=[authenticateToken,authorizeRole(['mother'])];
 app.get('/api/patient/overview',...own,async(req,res)=>{
  try{
   let source=null;
   if(process.env.DAI_LOCAL==='true'&&(await pool.query("SELECT to_regclass('public.dai_local_source_link') AS found")).rows[0]?.found){
    const link=(await pool.query("SELECT portal_uuid FROM dai_local_source_link WHERE entity='mother' AND target_id=$1",[req.user.id])).rows[0];
    source=sourceOverview(link);
    if(source?.assigned_doctor_uuid){const row=(await pool.query("SELECT target_id FROM dai_local_source_link WHERE entity='doctor' AND portal_uuid=$1",[source.assigned_doctor_uuid])).rows[0];source.assigned_doctor_id=row?.target_id||null;delete source.assigned_doctor_uuid;}
   }
   await pool.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'self_view','{}')",[req.user.id]);
   res.set('Cache-Control','no-store').json(source||{metrics:clinicalSnapshot([]),clinician_status:null,registered_facility:null,facilities:[]});
  }catch(e){console.error('Patient overview:',e.message);res.status(500).json({error:'Could not load clinician-shared information'});}
 });
 app.patch('/api/patient/appointments/:id',...own,async(req,res)=>{
  const id=Number(req.params.id),b=req.body||{};
  if(!Number.isInteger(id)||!['cancel','reschedule'].includes(b.action))return res.status(400).json({error:'Choose an appointment and action'});
  const client=await pool.connect();let appointment;
  try{
   await client.query('BEGIN');
   const old=(await client.query("SELECT * FROM appointments WHERE id=$1 AND mother_id=$2 AND status IN ('pending','confirmed') FOR UPDATE",[id,req.user.id])).rows[0];
   if(!old)throw Object.assign(new Error('No editable appointment found for your account'),{status:404});
   if(b.action==='reschedule'){
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[old.doctor_id]);
    const ctx=await require('./patientContinuity').validateBooking(client,req.user.id,{...old,...b,doctor_id:old.doctor_id},id);
    appointment=(await client.query("UPDATE appointments SET requested_date=$1,requested_time=$2,status='pending',change_reason=$3,slot_end=$4,facility_uuid=COALESCE($6,facility_uuid),unit_uuid=COALESCE($7,unit_uuid),unit_label=COALESCE($8,unit_label),room=COALESCE($9,room) WHERE id=$5 RETURNING *",[b.requested_date,b.requested_time||null,String(b.change_reason||'').slice(0,500),ctx.slot_end||null,id,ctx.facility_uuid||null,ctx.unit_uuid||null,ctx.unit_label||null,ctx.room||null])).rows[0];
   }else appointment=(await client.query("UPDATE appointments SET status='cancelled',change_reason=$1 WHERE id=$2 RETURNING *",[String(b.change_reason||'').slice(0,500),id])).rows[0];
   await require('./patientContinuity').queueBridge(client,id);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');return res.status(e.status||500).json({error:e.status?e.message:'Could not update the appointment'});}
  finally{client.release();}
  await require('./patientContinuity').syncBridge(pool).catch(e=>console.warn('Hospital mirror queued:',e.message));
  res.json({appointment,message:b.action==='cancel'?'Appointment cancelled':'Reschedule requested; the clinic will confirm'});
 });
 app.get('/api/patient/sharing',...own,async(req,res)=>{
  try{
   const events=(await pool.query(`SELECT event_type,details,created_at FROM (SELECT event_type,details,created_at FROM patient_access_events WHERE mother_id=$1 AND event_type<>'self_view' UNION ALL SELECT e.event_type,jsonb_build_object('document_title',CASE WHEN d.is_sensitive THEN 'Private screening report' ELSE d.title END) AS details,e.created_at FROM patient_document_events e JOIN patient_documents d ON d.id=e.document_id WHERE d.mother_id=$1 AND e.event_type IN ('share','revoke_share')) events ORDER BY created_at DESC LIMIT 30`,[req.user.id])).rows;
   const shares=(await pool.query(`SELECT d.id AS document_id,CASE WHEN d.is_sensitive THEN 'Private screening report' ELSE d.title END AS title,s.doctor_id,dp.full_name AS doctor_name,s.shared_at,s.expires_at FROM patient_documents d JOIN patient_document_shares s ON s.document_id=d.id LEFT JOIN doctor_profiles dp ON dp.user_id=s.doctor_id WHERE d.mother_id=$1 AND d.deleted_at IS NULL AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>NOW())`,[req.user.id])).rows;
   const access=(await pool.query(`SELECT e.event_type,e.created_at,CASE WHEN d.is_sensitive THEN 'Private document' ELSE d.title END AS record_title,COALESCE(dp.full_name,CASE WHEN e.actor_id=$1 THEN 'You' ELSE 'Recorded account' END) AS actor_name FROM patient_document_events e JOIN patient_documents d ON d.id=e.document_id LEFT JOIN doctor_profiles dp ON dp.user_id=e.actor_id WHERE d.mother_id=$1 AND e.event_type IN ('preview','download','doctor_review','share','revoke_share','reveal') ORDER BY e.created_at DESC LIMIT 50`,[req.user.id])).rows;
   res.set('Cache-Control','no-store').json({events,shares,access});
  }catch(e){res.status(500).json({error:'Could not load sharing history'});}
 });
 app.get('/api/patient/export',...own,async(req,res)=>{
  try{
   const [profile,timeline,appointments,children,health,documents,checkins,journal,babyLogs,support,clinicalEntries,clinicalPlan,clinicalConsent,clinicalAdherence]=await Promise.all([
    pool.query('SELECT * FROM mother_profiles WHERE user_id=$1',[req.user.id]),pool.query('SELECT * FROM care_milestones WHERE mother_id=$1',[req.user.id]),pool.query('SELECT * FROM appointments WHERE mother_id=$1',[req.user.id]),pool.query('SELECT * FROM children WHERE mother_id=$1',[req.user.id]),pool.query('SELECT * FROM health_logs WHERE mother_id=$1',[req.user.id]),pool.query('SELECT id,title,doc_type,uploaded_at,verification_status FROM patient_documents WHERE mother_id=$1 AND deleted_at IS NULL',[req.user.id]),pool.query('SELECT check_date,tasks,mood FROM patient_daily_checkins WHERE mother_id=$1',[req.user.id]),pool.query('SELECT * FROM patient_journal WHERE mother_id=$1',[req.user.id]),pool.query('SELECT * FROM patient_baby_logs WHERE mother_id=$1',[req.user.id]),pool.query('SELECT * FROM patient_support_progress WHERE mother_id=$1',[req.user.id]),pool.query('SELECT * FROM clinical_dashboard_entries WHERE mother_id=$1',[req.user.id]),pool.query('SELECT * FROM clinical_dashboard_plan WHERE mother_id=$1',[req.user.id]),pool.query('SELECT * FROM clinical_dashboard_consent WHERE mother_id=$1',[req.user.id]),pool.query('SELECT * FROM clinical_dashboard_adherence WHERE mother_id=$1',[req.user.id])]);
   await pool.query("INSERT INTO patient_access_events(mother_id,event_type) VALUES($1,'data_export')",[req.user.id]);
   res.set({'Cache-Control':'no-store','Content-Disposition':'attachment; filename="dai-my-records.json"'}).json({exported_at:new Date().toISOString(),profile:profile.rows[0],timeline:timeline.rows,appointments:appointments.rows,children:children.rows,self_entered_health_logs:health.rows,documents:documents.rows,personal_checkins:checkins.rows,journal:journal.rows,baby_logs:babyLogs.rows,support_checklists:support.rows,clinical_entries:clinicalEntries.rows,clinical_plan:clinicalPlan.rows,clinical_summary_consent:clinicalConsent.rows,clinical_adherence:clinicalAdherence.rows,document_files:'Download individual documents from Reports and records.'});
  }catch(e){res.status(500).json({error:'Could not export your records'});}
 });
 app.post('/api/patient/deletion-request',...own,async(req,res)=>{
  if(req.body?.confirmation!=='REQUEST DELETION')return res.status(400).json({error:'Type REQUEST DELETION to confirm the request'});
  try{
   const user=(await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.user.id])).rows[0];
   if(!user||typeof req.body.password!=='string'||!await bcrypt.compare(req.body.password,user.password_hash))return res.status(403).json({error:'Your current password is required'});
   await pool.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'deletion_requested',$2)",[req.user.id,JSON.stringify({status:'pending_review'})]);
   res.json({status:'pending_review',message:'Request recorded for review. Your account and legally retained hospital records have not been deleted.'});
  }catch(e){res.status(500).json({error:'Could not record the request'});}
 });
};
module.exports.clinicalSnapshot=clinicalSnapshot;
module.exports.sourceOverview=sourceOverview;
