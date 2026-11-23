'use strict';
// Explicit fictional showcase records. Does not edit any imported mother or clinician record.
const {randomUUID}=require('node:crypto');
async function seedDoctorShowcase(db,{local=process.env.DAI_LOCAL==='true',demo=process.env.DAI_DEMO==='true',date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date())}={}){
 if(!local||!demo)return {disabled:true};
 const version='doctor-showcase-v1';if((await db.query('SELECT 1 FROM dai_local_seed WHERE version=$1',[version])).rows.length)return {alreadySeeded:true};
 const doctor=(await db.query("SELECT u.id FROM users u JOIN doctor_profiles p ON p.user_id=u.id WHERE u.email='doctor@dai-synthetic.invalid' AND p.full_name LIKE '%Hemangini Batra%'")).rows[0];
 const template=(await db.query("SELECT id,password_hash FROM users WHERE email='mother@dai-synthetic.invalid'")).rows[0];if(!doctor||!template)return {skipped:true};
 const add=n=>new Date(new Date(date+'T12:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
 await db.query('BEGIN');try{
  // Reserved accounts are never overwritten, even if the marker was removed manually.
  if((await db.query("SELECT 1 FROM users WHERE email LIKE 'showcase-due-%@dai-synthetic.invalid'")).rows.length){await db.query('ROLLBACK');return {skipped:true};}
  const ids=[];
  for(const [i,name] of ['Aarohi Mehra','Kavini Sethi','Nivika Batra'].entries()){
   const id=(await db.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'mother') RETURNING id",['showcase-due-'+(i+1)+'@dai-synthetic.invalid',template.password_hash])).rows[0].id;ids.push(id);
   await db.query("INSERT INTO mother_profiles(user_id,full_name,care_start_date,lmp_date,edd_date,pregnancy_status) VALUES($1,$2,$3::date-280,$3::date-280,$3,'pregnant')",[id,'SYNTHETIC '+name+' · Demo case '+(i+1),add(2+i*2)]);
   const a=(await db.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,requested_time,status,reason,visit_type) VALUES($1,$2,$3,$4,'confirmed','Synthetic showcase: birth preparation review','ANC') RETURNING id",[id,doctor.id,date,(16+i)+':00:00'])).rows[0];
   await db.query("INSERT INTO doctor_queue_state(appointment_id,doctor_id,state) VALUES($1,$2,'booked')",[a.id,doctor.id]);
   // These consents belong solely to newly created fictional showcase accounts.
   await db.query("INSERT INTO clinical_dashboard_consent(mother_id,doctor_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')",[id,doctor.id]);
   await db.query("INSERT INTO patient_daily_consent(mother_id,doctor_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')",[id,doctor.id]);
   for(const key of ['facility_selected','transport_arranged','emergency_contact','documents_ready'])await db.query('INSERT INTO birth_readiness_items(mother_id,item_key,completed,updated_by) VALUES($1,$2,$3,$1)',[id,key,i!==1||key==='emergency_contact']);
  }
  const log=async(id,kind,payload,offset)=>db.query('INSERT INTO patient_daily_entries(mother_id,mutation_id,log_date,kind,data,logged_at) VALUES($1,$2,$3,$4,$5,$6)',[id,randomUUID(),add(offset),kind,payload,add(offset)+'T09:00:00+05:30']);
  await log(ids[0],'blood_pressure',{systolic:132,diastolic:86},-3);await log(ids[0],'blood_pressure',{systolic:148,diastolic:96},-1);
  await log(ids[0],'weight',{kg:65.2},-6);await log(ids[0],'weight',{kg:65.6},-1);
  await log(ids[1],'symptom',{codes:['reduced_movement'],severity:'unspecified',note:'Fictional patient-reported demonstration entry.'},0);
  await db.query("INSERT INTO supplement_logs(mother_id,log_date,supplement,taken) VALUES($1,$2,'iron',TRUE)",[ids[2],add(-6)]);
  for(const [i,id]of [template.id,ids[2]].entries()){
   const a=(await db.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,requested_time,status,reason,visit_type) VALUES($1,$2,$3,$4,'completed','Synthetic showcase: completed follow-up demonstration','Follow-up') RETURNING id",[id,doctor.id,date,(9+i)+':00:00'])).rows[0];
   await db.query("INSERT INTO doctor_queue_state(appointment_id,doctor_id,state,completed_at) VALUES($1,$2,'done',$3::date+INTERVAL '5 hours')",[a.id,doctor.id,date]);
  }
  await db.query('INSERT INTO dai_local_seed(version,source_sha256,counts) VALUES($1,$2,$3)',[version,'explicit-fictional-showcase',JSON.stringify({new_demo_patients:3,completed_demo_visits:2,date})]);await db.query('COMMIT');return {patients:3,completed:2};
 }catch(e){await db.query('ROLLBACK');throw e;}
}
module.exports={seedDoctorShowcase};
