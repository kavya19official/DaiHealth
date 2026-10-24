'use strict';
const {context,request}=require('./patientML');
const indianDay=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(now);
function applyQuiet(hour,prefs={}){
 if(!prefs.quiet_hours_enabled)return hour;
 const start=String(prefs.quiet_start||'21:00'),end=String(prefs.quiet_end||'07:00');
 const quiet=h=>{const t=String(h).padStart(2,'0')+':00';return start===end|| (start<end?t>=start&&t<end:t>=start||t<end);};
 if(!quiet(hour))return hour;
 for(let offset=1;offset<=24;offset++){const next=(hour+offset)%24;if(!quiet(next))return next;}
 return null;
}
async function plan(pool,id,now=new Date()){
 const c=await context(pool,id);if(c.prefs.notif_care===false||!c.consent.reminders)return null;
 const day=indianDay(now);
 await pool.query("UPDATE patient_reminder_plans SET state='cancelled' WHERE patient_id=$1 AND plan_date<$2 AND state='scheduled'",[id,day]);
 let existing=(await pool.query('SELECT * FROM patient_reminder_plans WHERE patient_id=$1 AND plan_date=$2',[id,day])).rows[0];
 if(existing?.state==='cancelled')return null;
 if(!existing){
  const open=(await pool.query('SELECT 1 FROM care_milestones WHERE mother_id=$1 AND completed_at IS NULL AND due_date<=$2::date+7 LIMIT 1',[id,day])).rows.length;
  if(!open)return null;
  const result=await request('best-send-time',{patient_id:c.patient_id,consent:c.consent,...(c.features?{features:c.features}:{})});
  const hour=applyQuiet(result.hour,c.prefs);if(hour===null)return null;const due=day+'T'+String(hour).padStart(2,'0')+':00:00+05:30';
  existing=(await pool.query(`INSERT INTO patient_reminder_plans(patient_id,plan_date,hour,reason,source,due_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(patient_id,plan_date) DO NOTHING RETURNING *`,[id,day,hour,result.reason+(hour!==result.hour?' Moved after your quiet hours.':''),result.source,due])).rows[0]||(await pool.query('SELECT * FROM patient_reminder_plans WHERE patient_id=$1 AND plan_date=$2',[id,day])).rows[0];
 }
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(now),start=c.prefs.quiet_start,end=c.prefs.quiet_end;
 const quietNow=c.prefs.quiet_hours_enabled&&(start===end||(start<end?time>=start&&time<end:time>=start||time<end));
 if(existing.state==='scheduled'&&new Date(existing.due_at)<=now&&!quietNow){
  const updated=(await pool.query("UPDATE patient_reminder_plans SET state='ready' WHERE id=$1 AND state='scheduled' RETURNING id",[existing.id])).rows;
  if(updated.length&&c.consent.events)await pool.query("INSERT INTO events(patient_id,event_type,channel,entity_id) VALUES($1,'reminder_sent','app',$2)",[id,'reminder-'+existing.id]);
  existing.state='ready';
 }
 return {...existing,transport:'app inbox only; SMS, WhatsApp and voice delivery are not connected',data_label:existing.source==='ml'?'Simulated on synthetic data':'Rule-based assistance'};
}
module.exports={plan,applyQuiet};
