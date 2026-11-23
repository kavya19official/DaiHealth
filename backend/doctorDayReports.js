'use strict';
const access=require('./accessControl'),Daily=require('../shared/daily-tracking');
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
async function doctorDayReports(pool,doctor,date){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query('LOCK TABLE patient_daily_consent,clinical_dashboard_consent,patient_access_controls,patient_preferences IN SHARE MODE');
  const shared=(await db.query(`SELECT c.mother_id,c.expires_at FROM patient_daily_consent c WHERE c.doctor_id=$1 AND c.expires_at>NOW()
   AND ${access.activeRelationshipSql('c.mother_id','$1::int')}
   AND COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean FROM patient_preferences WHERE user_id=c.mother_id),TRUE)`,[doctor])).rows;
  const ids=shared.map(r=>r.mother_id);
  let entries=[],supplements=[],requests=[];
  if(ids.length){
   entries=(await db.query(`SELECT mother_id,kind,data,log_date,logged_at FROM patient_daily_entries WHERE mother_id=ANY($1::int[]) AND log_date BETWEEN $2::date-6 AND $2::date AND kind IN ('blood_pressure','weight','symptom') ORDER BY logged_at`,[ids,date])).rows;
   supplements=(await db.query(`SELECT mother_id,MAX(log_date) AS last_log FROM supplement_logs WHERE mother_id=ANY($1::int[]) AND log_date<=$2::date GROUP BY mother_id`,[ids,date])).rows;
  }
  // A standard check-in's answers and scores are never included in the overview.
  requests=(await db.query(`SELECT DISTINCT r.id,r.mother_id,r.created_at FROM clinical_review_requests r JOIN postpartum_wellbeing_screens s ON s.review_id=r.id AND s.mother_id=r.mother_id
   JOIN clinical_dashboard_consent c ON c.mother_id=r.mother_id AND c.doctor_id=$1 AND c.revoked_at IS NULL AND c.expires_at>NOW()
   WHERE s.shared_at IS NOT NULL AND r.state IN ('pending','escalated') AND (r.reviewer_id IS NULL OR r.reviewer_id=$1)
   AND r.created_at >= ($2::date-6)::timestamptz AND r.created_at < ($2::date+1)::timestamptz
   AND ${access.activeRelationshipSql('r.mother_id','$1::int')}
   AND COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean FROM patient_preferences WHERE user_id=r.mother_id),TRUE)`,[doctor,date])).rows;
  const patients=shared.map(c=>{
   const logs=entries.filter(e=>e.mother_id===c.mother_id).map(e=>({...e,data:Daily.clean(e.kind,e.data)})).filter(e=>e.data);
   const bp=logs.filter(e=>e.kind==='blood_pressure'),weight=logs.filter(e=>e.kind==='weight'),symptoms=logs.filter(e=>e.kind==='symptom');
   const last=supplements.find(s=>s.mother_id===c.mother_id)?.last_log;
   return {mother_id:c.mother_id,consent_expires_at:c.expires_at,bp:bp.map(e=>({systolic:e.data.systolic,diastolic:e.data.diastolic,at:e.logged_at})),weight:weight.map(e=>({kg:e.data.kg,at:e.logged_at})),reduced_movement:symptoms.filter(e=>e.data.codes.includes('reduced_movement')).map(e=>({at:e.logged_at})),supplement_last_log:last?iso(last):null};
  });
  for(const id of new Set([...ids,...requests.map(r=>r.mother_id)]))await db.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'doctor_day_report_read',jsonb_build_object('doctor_id',$2::int,'through',$3::text))",[id,doctor,date]);
  await db.query('COMMIT');return {patients,review_requests:requests,from:iso(new Date(new Date(date+'T12:00:00Z').getTime()-6*86400000)),through:date,source:'Patient-reported · active sharing only'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={doctorDayReports};
