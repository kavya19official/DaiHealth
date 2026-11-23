'use strict';
const access=require('./accessControl'),{verifiedDoctor}=require('./clinicalDashboard'),{dateValid}=require('./patientContinuity');
module.exports=function(app,{pool,authenticateToken,authorizeRole}){
 app.post('/api/doctor/followups',authenticateToken,authorizeRole(['doctor']),async(req,res)=>{
  const b=req.body||{},id=Number(b.mother_id),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date()),end=new Date(Date.now()+365*86400000).toISOString().slice(0,10);
  if(Object.keys(b).some(k=>!['mother_id','date','time','reason'].includes(k))||!Number.isSafeInteger(id)||id<1||!dateValid(b.date)||b.date<today||b.date>end||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time||'')||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>500)return res.status(400).json({error:'Choose a patient, future date, time and visit reason.'});
  if(new Date(b.date+'T'+b.time+':00+05:30')<=new Date())return res.status(400).json({error:'Choose a future appointment time (IST).'});
  let c;try{
   if(!await verifiedDoctor(pool,req.user.id))return res.status(403).json({error:'Verified doctor required.'});
   c=await pool.connect();await c.query('BEGIN');await c.query('SELECT user_id FROM doctor_profiles WHERE user_id=$1 FOR UPDATE',[req.user.id]);await c.query('LOCK TABLE patient_access_controls IN SHARE MODE');
   if(!await access.hasDoctorAccess(c,req.user.id,id))throw Object.assign(Error('Patient connection unavailable.'),{status:403});
   const same=(await c.query(`SELECT a.id FROM appointments a WHERE a.mother_id=$1 AND a.doctor_id=$2 AND a.requested_date=$3 AND a.requested_time=$4::time AND a.reason=$5 AND a.status IN ('confirmed','scheduled') AND NOT ${access.revokedSql('a.mother_id','a.doctor_id','a.facility_uuid')}`,[id,req.user.id,b.date,b.time,b.reason.trim()])).rows[0];
   if(same){await c.query('COMMIT');return res.json({saved:true,id:same.id});}
   if((await c.query(`SELECT 1 FROM appointments a WHERE a.doctor_id=$1 AND a.requested_date=$2 AND a.status NOT IN ('cancelled','completed','no_show') AND a.requested_time IS NOT NULL AND ABS(EXTRACT(EPOCH FROM a.requested_time-$3::time))<1800 AND NOT ${access.revokedSql('a.mother_id','a.doctor_id','a.facility_uuid')}`,[req.user.id,b.date,b.time])).rows.length)throw Object.assign(Error('This time overlaps a recorded appointment. Choose another time.'),{status:409});
   const a=(await c.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,requested_time,status,reason,visit_type) VALUES($1,$2,$3,$4,'confirmed',$5,'Follow-up') RETURNING id",[id,req.user.id,b.date,b.time,b.reason.trim()])).rows[0];
   await c.query("INSERT INTO doctor_queue_state(appointment_id,doctor_id,state) VALUES($1,$2,'booked')",[a.id,req.user.id]);
   await c.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'doctor_followup_booked',jsonb_build_object('doctor_id',$2::int,'appointment_id',$3::int))",[id,req.user.id,a.id]);
   await c.query('COMMIT');res.status(201).json({saved:true,id:a.id});
  }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});res.status(e.status||500).json({error:e.status?e.message:'Could not book the visit. Your choices are preserved.'});}finally{c?.release();}
 });
};
