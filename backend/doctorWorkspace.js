'use strict';
const fs=require('node:fs'),path=require('node:path'),access=require('./accessControl');
const M=require('../frontend/js/patient-model'),{verifiedDoctor}=require('./clinicalDashboard');
const iso=value=>value instanceof Date?value.toISOString().slice(0,10):value?String(value).slice(0,10):null;
const json=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
function hospitalSnapshot(doctorLink,motherLinks,shared,date){
 const file=process.env.DAI_PORTAL_DB||path.join(__dirname,'../.local/portal.db');
 if(!doctorLink||!fs.existsSync(file))return null;
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file,{readOnly:true});
 try{
  const doctor=db.prepare('SELECT * FROM portal_user WHERE id=? AND verified=1').get(doctorLink.portal_uuid);if(!doctor)return null;
  const facility=db.prepare('SELECT id,name FROM facility WHERE id=?').get(doctor.facility_id);
  const unit=doctor.unit_id?db.prepare('SELECT code,anc_day,gynae_day,ot_day,room FROM unit WHERE id=?').get(doctor.unit_id):null;
  if(unit)for(const key of ['anc_day','gynae_day','ot_day'])if(typeof unit[key]==='number')unit[key]=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][unit[key]];
  const patients={},sourceIds=new Map();
  for(const link of motherLinks){const m=db.prepare('SELECT * FROM mother WHERE id=?').get(link.portal_uuid);if(!m)continue;sourceIds.set(m.id,link.target_id);
   const flagger=m.validated_by?db.prepare('SELECT name,verified,registration_no FROM portal_user WHERE id=?').get(m.validated_by):null;
   const canRead=shared.has(Number(link.target_id));
   const patientUnit=m.assigned_unit_id?db.prepare('SELECT code FROM unit WHERE id=?').get(m.assigned_unit_id):null;
   patients[link.target_id]={uhid:m.uhid,abha:m.abha_id,age:m.age,unit:patientUnit?.code||null,
    clinicianRisk:canRead&&m.clinician_high_risk&&flagger?.verified&&flagger.registration_no?{reviewer:flagger.name,reason:m.high_risk_reason_by_clinician,recorded_on:null}:null,
    clinical_shared:canRead};
  }
  const beds=db.prepare(`SELECT w.care_area,COUNT(*) AS total,SUM(CASE WHEN b.status='AVAILABLE' THEN 1 ELSE 0 END) AS available,MAX(b.status_since) AS reported_at FROM bed b JOIN ward w ON w.id=b.ward_id WHERE w.facility_id=? GROUP BY w.care_area`).all(doctor.facility_id);
  const blood=db.prepare('SELECT blood_group,component,units,snapshot_at FROM blood_stock_snapshot WHERE facility_id=? ORDER BY snapshot_at DESC').all(doctor.facility_id);const latest=new Map();for(const b of blood){const key=b.blood_group+':'+b.component;if(!latest.has(key))latest.set(key,b);}
  const onCall=db.prepare(`SELECT u.name,u.details,o.day,o.start_time,o.end_time FROM on_call_entry o JOIN portal_user u ON u.id=o.user_id WHERE u.facility_id=? AND u.verified=1`).all(doctor.facility_id).filter(o=>o.day===new Date(date+'T12:00:00Z').toLocaleDateString('en',{weekday:'long',timeZone:'Asia/Kolkata'}));
  const roster=db.prepare(`SELECT u.name,u.details,r.roster_date,r.start_time,r.end_time FROM roster_entry r JOIN portal_user u ON u.id=r.user_id WHERE r.facility_id=? AND u.verified=1 ORDER BY r.roster_date DESC,r.start_time LIMIT 6`).all(doctor.facility_id).map(o=>({...o,specialty:json(o.details).specialty,details:undefined}));
  const incoming=[];for(const r of db.prepare('SELECT id,mother_id,status,created_at,details FROM referral WHERE to_facility_id=? ORDER BY created_at DESC LIMIT 100').all(doctor.facility_id)){if(sourceIds.has(r.mother_id)&&!['completed','rejected','cancelled'].includes(r.status))incoming.push({id:r.id,patient_id:sourceIds.get(r.mother_id),type:'Referral',status:r.status,created_at:r.created_at,eta:null});}
  for(const s of db.prepare('SELECT id,mother_id,status,trigger_time FROM sos_request WHERE accepted_facility_id=? AND auth_layer_1_ok=1 AND auth_layer_2_ok=1 ORDER BY trigger_time DESC LIMIT 100').all(doctor.facility_id)){if(sourceIds.has(s.mother_id)&&!['resolved','rejected','closed','completed'].includes(s.status))incoming.push({id:s.id,patient_id:sourceIds.get(s.mother_id),type:'SOS',status:s.status,created_at:s.trigger_time,eta:null});}
  const alerts=db.prepare("SELECT id,type,severity,reason_text,created_at FROM alert WHERE facility_id=? AND status='open' ORDER BY created_at DESC LIMIT 12").all(doctor.facility_id);
  const wardTiles=db.prepare(`SELECT w.id,w.name,w.care_area,w.capacity,b.id AS bed_id,b.label,b.type,b.status,b.has_oxygen,b.has_monitor,b.has_ventilator,b.status_since FROM ward w JOIN bed b ON b.ward_id=w.id WHERE w.facility_id=? ORDER BY w.name,b.label`).all(doctor.facility_id);
  const clinics=unit?db.prepare('SELECT name,day,start_time,end_time,room FROM clinic WHERE facility_id=? AND unit_id=?').all(doctor.facility_id,doctor.unit_id):[];
  return {facility,unit,role:doctor.role,patients,beds,wardTiles,blood:[...latest.values()],roster,onCall:onCall.filter(o=>{const now=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());return o.start_time<=now&&o.end_time>now;}).map(o=>({...o,specialty:json(o.details).specialty,details:undefined})),incoming,alerts,clinics};
 }finally{db.close();}
}
function assemble({profile,patients,milestones,appointments,reports,postpartum,shared,snapshot,date}){
 const rows=patients.map(p=>{const source=snapshot?.patients[p.id]||{},post=postpartum.find(r=>r.mother_id===p.id),st=M.stage(p,post?{active:true,delivery:{date:iso(post.delivery_date)}}:{},[],date);const items=milestones.filter(m=>m.mother_id===p.id),relevant=M.gaps(items,st,date);return {id:p.id,name:p.full_name,phone:p.phone||null,age:source.age||null,uhid:source.uhid||null,abha:source.abha||null,unit:source.unit||snapshot?.unit?.code||null,stage:st,edd:st.delivered?null:iso(p.edd_date)||st.edd,clinical_shared:shared.has(p.id),clinicianRisk:shared.has(p.id)?source.clinicianRisk||null:null,open_items:relevant.length,overdue:relevant.filter(m=>M.status(m,date)==='overdue').length,readiness:null,has_child_visit:appointments.some(a=>a.mother_id===p.id&&a.child_id&&a.status!=='cancelled'),status:appointments.some(a=>a.mother_id===p.id&&iso(a.requested_date)===date&&a.status==='confirmed')?'Visit confirmed':'Assigned'};});
 const worklist=[];for(const p of rows)for(const m of M.gaps(milestones.filter(m=>m.mother_id===p.id),p.stage,date)){if(iso(m.due_date)>date)continue;worklist.push({id:m.id,patient_id:p.id,name:p.name,title:m.title,due_date:iso(m.due_date),days_overdue:Math.max(0,M.days(date,iso(m.due_date))),reason:'Expected '+iso(m.due_date)+'; completion is not recorded.',status:'overdue'});}
 worklist.sort((a,b)=>b.days_overdue-a.days_overdue||a.id-b.id);
 const completed=milestones.filter(m=>m.completed_at),closedWeek=completed.filter(m=>M.days(date,iso(m.completed_at))>=0&&M.days(date,iso(m.completed_at))<7).length;
 return {date,label:'Simulated on synthetic data',refreshed_at:new Date().toISOString(),doctor:{id:profile.user_id,name:profile.full_name,registration_number:profile.medical_license_number||null,specialty:profile.specialization,facility:snapshot?.facility?.name||profile.facility_name||null,unit:snapshot?.unit||null,role:snapshot?.role||'doctor',verified:true},patients:rows,appointments:appointments.map(a=>({...a,requested_date:iso(a.requested_date),requested_time:a.requested_time||null})),milestones:milestones.map(m=>({...m,due_date:iso(m.due_date),completed_at:iso(m.completed_at)})),worklist,reports:reports.map(r=>({id:r.id,mother_id:r.mother_id,reviewed:!!r.reviewed_by,uploaded_at:iso(r.uploaded_at),private:!!r.is_sensitive})),summary:{assigned:rows.length,open_gaps:rows.reduce((s,p)=>s+p.open_items,0),completed:completed.length,total:milestones.length,closed_this_week:closedWeek,high_risk:rows.filter(p=>p.clinicianRisk).length,risk_not_shared:rows.filter(p=>!p.clinical_shared).length,pending_reviews:reports.filter(r=>!r.reviewed_by).length},hospital:snapshot?{facility:snapshot.facility,beds:snapshot.beds,blood:snapshot.blood,onCall:snapshot.onCall,roster:snapshot.roster||[],incoming:snapshot.incoming,alerts:snapshot.alerts,clinics:snapshot.clinics,wardTiles:snapshot.wardTiles||[],source:'Hospital database · reported snapshot; not a live readiness guarantee'}:null,methodology:'Counts use your assigned patients and recorded events. Worklist order is deterministic: longest overdue first. No ML ranking, clinical risk inference, or live ETA is calculated.'};
}
module.exports=function(app,{pool,authenticateToken,authorizeRole}){
 app.get('/api/doctor/workspace',authenticateToken,authorizeRole(['doctor']),async(req,res)=>{try{
  if(!await verifiedDoctor(pool,req.user.id))return res.status(403).json({error:'Verified clinician credentials are required.'});
  const id=req.user.id,date=M.today();
  const [profile,patients,milestones,appointments,reports,postpartum,consents]=await Promise.all([
   pool.query('SELECT user_id,full_name,specialization,facility_name,medical_license_number FROM doctor_profiles WHERE user_id=$1',[id]),
   pool.query(`SELECT mp.user_id AS id,mp.full_name,mp.phone,mp.care_start_date,mp.lmp_date,mp.edd_date,mp.pregnancy_status FROM mother_profiles mp WHERE ${access.activeRelationshipSql('mp.user_id','$1::int')} ORDER BY mp.full_name`,[id]),
   pool.query(`SELECT cm.id,cm.mother_id,cm.title,cm.category,cm.stage,cm.due_date,cm.completed_at,CASE WHEN cm.completed_at IS NOT NULL THEN 'completed' ELSE 'upcoming' END AS status FROM care_milestones cm WHERE ${access.activeRelationshipSql('cm.mother_id','$1::int')} ORDER BY cm.due_date`,[id]),
   pool.query(`SELECT a.id,a.mother_id,a.requested_date,a.requested_time,a.status,a.unit_label,a.room,a.child_id,a.reason FROM appointments a WHERE a.doctor_id=$1 AND NOT ${access.revokedSql('a.mother_id','a.doctor_id','a.facility_uuid')} ORDER BY a.requested_date`,[id]),
   pool.query(`SELECT d.id,d.mother_id,d.reviewed_by,d.uploaded_at,d.is_sensitive FROM patient_documents d JOIN patient_document_shares s ON s.document_id=d.id WHERE s.doctor_id=$1 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>NOW()) AND d.deleted_at IS NULL AND NOT ${access.revokedSql('d.mother_id','s.doctor_id')} AND COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean FROM patient_preferences WHERE user_id=d.mother_id),TRUE)`,[id]),
   pool.query(`SELECT p.mother_id,p.delivery_date FROM postpartum_profile p WHERE ${access.activeRelationshipSql('p.mother_id','$1::int')}`,[id]),
   pool.query(`SELECT c.mother_id FROM clinical_dashboard_consent c WHERE c.doctor_id=$1 AND c.revoked_at IS NULL AND c.expires_at>NOW() AND NOT ${access.revokedSql('c.mother_id','c.doctor_id')}`,[id])]);
  // Date-only strings keep all aggregates independent of host timezone.
  for(const p of patients.rows)for(const k of ['care_start_date','lmp_date','edd_date'])p[k]=iso(p[k]);
  const shared=new Set(consents.rows.map(r=>r.mother_id));let snapshot=null;
  if(process.env.DAI_LOCAL==='true'&&(await pool.query("SELECT to_regclass('public.dai_local_source_link') AS found")).rows[0]?.found){const links=(await pool.query(`SELECT l.entity,l.target_id,l.portal_uuid FROM dai_local_source_link l WHERE (l.entity='doctor' AND l.target_id=$1) OR (l.entity='mother' AND ${access.activeRelationshipSql('l.target_id','$1::int')})`,[id])).rows;snapshot=hospitalSnapshot(links.find(l=>l.entity==='doctor'),links.filter(l=>l.entity==='mother'),shared,date);}
  // Every roster read is audited; record contents and private result values are not logged.
  await pool.query(`INSERT INTO patient_access_events(mother_id,event_type,details) SELECT DISTINCT a.mother_id,'doctor_workspace_read',jsonb_build_object('doctor_id',$1::int,'scope','assigned roster and care coordination') FROM appointments a WHERE a.doctor_id=$1 AND NOT ${access.revokedSql('a.mother_id','a.doctor_id','a.facility_uuid')}`,[id]);
  const assignedIds=new Set(patients.rows.map(p=>p.id));
  for(const motherId of new Set(reports.rows.map(r=>r.mother_id)))if(!assignedIds.has(motherId))await pool.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'doctor_workspace_read',jsonb_build_object('doctor_id',$2::int,'scope','explicitly shared report metadata'))",[motherId,id]);
  const response=assemble({profile:profile.rows[0],patients:patients.rows,milestones:milestones.rows,appointments:appointments.rows,reports:reports.rows,postpartum:postpartum.rows,shared,snapshot,date});
  const [queue,actions]=await Promise.all([pool.query(`SELECT q.* FROM doctor_queue_state q JOIN appointments a ON a.id=q.appointment_id WHERE q.doctor_id=$1 AND a.doctor_id=q.doctor_id AND NOT ${access.revokedSql('a.mother_id','a.doctor_id','a.facility_uuid')}`,[id]),pool.query(`SELECT w.* FROM doctor_worklist_action w JOIN care_milestones cm ON cm.id=w.milestone_id WHERE w.doctor_id=$1 AND ${access.activeRelationshipSql('cm.mother_id','w.doctor_id')}`,[id])]);
  response.queue=queue.rows;response.worklistActions=actions.rows;
  response.demo={enabled:process.env.DAI_LOCAL==='true'&&!!snapshot,synthetic_only:process.env.DAI_LOCAL==='true'&&!!snapshot};
  response.label=response.demo.enabled?'Simulated on synthetic data':'Recorded care data';
  res.set('Cache-Control','no-store').json(response);
 }catch(e){console.error('Doctor workspace:',e.message);res.status(500).json({error:'Could not load your assigned workspace.'});}});
};
Object.assign(module.exports,{assemble,hospitalSnapshot});
