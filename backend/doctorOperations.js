'use strict';
const {verifiedDoctor}=require('./clinicalDashboard'),M=require('../frontend/js/patient-model');
const iso=x=>x instanceof Date?x.toISOString().slice(0,10):String(x).slice(0,10);
const transitions={booked:['waiting','no_show'],waiting:['in_consult','no_show','booked'],in_consult:['done','waiting'],no_show:['waiting'],done:[]};
module.exports=function(app,{pool,authenticateToken,authorizeRole}){
 const guards=[authenticateToken,authorizeRole(['doctor'])];

 app.get('/api/doctor/activity',...guards,async(req,res)=>{
  try{if(!await verifiedDoctor(pool,req.user.id))return res.status(403).json({error:'Verified doctor required'});
   const [reads,changes]=await Promise.all([pool.query(`SELECT event_type,created_at FROM patient_access_events WHERE details->>'doctor_id'=$1 ORDER BY created_at DESC LIMIT 60`,[String(req.user.id)]),pool.query('SELECT action,created_at FROM doctor_operations_event WHERE doctor_id=$1 ORDER BY created_at DESC LIMIT 60',[req.user.id])]);
   res.set('Cache-Control','no-store').json({reads:reads.rows,changes:changes.rows,label:'Your recorded activity only'});
  }catch{res.status(500).json({error:'Could not load your activity'});}
 });

 app.post('/api/doctor/queue/:id',...guards,async(req,res)=>{
  if(!await verifiedDoctor(pool,req.user.id))return res.status(403).json({error:'Verified doctor required'});
  const b=req.body||{},id=Number(req.params.id);if(!Number.isInteger(id)||!Number.isInteger(b.version)||b.version<0||!Object.hasOwn(transitions,b.state))return res.status(400).json({error:'Choose a valid queue state and version'});
  const c=await pool.connect();let appointment;
  try{await c.query('BEGIN');await c.query('SELECT user_id FROM doctor_profiles WHERE user_id=$1 FOR UPDATE',[req.user.id]);
   appointment=(await c.query('SELECT * FROM appointments WHERE id=$1 AND doctor_id=$2 FOR UPDATE',[id,req.user.id])).rows[0];
   if(!appointment)throw Object.assign(Error('Appointment not found'),{status:404});
   if(appointment.status==='cancelled')throw Object.assign(Error('Cancelled appointments cannot enter the queue'),{status:409});
   const old=(await c.query('SELECT * FROM doctor_queue_state WHERE appointment_id=$1',[id])).rows[0],state=old?.state||(appointment.status==='completed'?'done':'booked');
   if((old?.version||0)!==b.version)throw Object.assign(Error('Queue changed. Refresh before retrying.'),{status:409});
   if(iso(appointment.requested_date)!==M.today())throw Object.assign(Error('Queue changes require today’s appointment. Use scheduling for other dates.'),{status:409});
   if(!transitions[state].includes(b.state))throw Object.assign(Error('This queue transition is not allowed'),{status:409});
   if(b.state==='in_consult'&&(await c.query("SELECT 1 FROM doctor_queue_state WHERE doctor_id=$1 AND state='in_consult' AND appointment_id<>$2",[req.user.id,id])).rows.length)throw Object.assign(Error('Finish or return the current consultation before starting another.'),{status:409});
   const row=(await c.query(`INSERT INTO doctor_queue_state(appointment_id,doctor_id,state,checked_in_at,consultation_started_at,completed_at) VALUES($1,$2,$3,CASE WHEN $3='waiting' THEN NOW() END,CASE WHEN $3='in_consult' THEN NOW() END,CASE WHEN $3='done' THEN NOW() END) ON CONFLICT(appointment_id) DO UPDATE SET state=EXCLUDED.state,version=doctor_queue_state.version+1,updated_at=NOW(),checked_in_at=CASE WHEN EXCLUDED.state='waiting' THEN NOW() ELSE doctor_queue_state.checked_in_at END,consultation_started_at=CASE WHEN EXCLUDED.state='in_consult' THEN NOW() ELSE doctor_queue_state.consultation_started_at END,completed_at=CASE WHEN EXCLUDED.state='done' THEN NOW() ELSE doctor_queue_state.completed_at END RETURNING *`,[id,req.user.id,b.state])).rows[0];
   if(b.state==='done'){if(b.note!=null&&(typeof b.note!=='string'||b.note.length>2000))throw Object.assign(Error('Visit note must be at most 2,000 characters'),{status:400});await c.query("UPDATE appointments SET status='completed',doctor_notes=COALESCE($1,doctor_notes),updated_at=NOW() WHERE id=$2",[b.note?.trim()||null,id]);await require('./patientContinuity').queueBridge(c,id);}
   await c.query('INSERT INTO doctor_operations_event(doctor_id,mother_id,action,entity_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)',[req.user.id,appointment.mother_id,'queue_'+b.state,id,JSON.stringify({from:state,to:b.state,version:row.version})]);
   await c.query('COMMIT');res.json({queue:row});
  }catch(e){await c.query('ROLLBACK');res.status(e.status||500).json({error:e.status?e.message:'Queue update failed'});}finally{c.release();}
 });
 app.post('/api/doctor/worklist/:id',...guards,async(req,res)=>{
  if(!await verifiedDoctor(pool,req.user.id))return res.status(403).json({error:'Verified doctor required'});
  const b=req.body||{},id=Number(req.params.id);if(!Number.isInteger(id)||!['reviewed','dismissed','reopened'].includes(b.state)||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>1000)return res.status(400).json({error:'Choose an action and enter a reason (3–1,000 characters)'});
  const c=await pool.connect();try{await c.query('BEGIN');const m=(await c.query('SELECT cm.* FROM care_milestones cm WHERE cm.id=$1 AND EXISTS(SELECT 1 FROM appointments a WHERE a.mother_id=cm.mother_id AND a.doctor_id=$2)',[id,req.user.id])).rows[0];if(!m)throw Object.assign(Error('Assigned care item not found'),{status:404});
   await c.query(`INSERT INTO doctor_worklist_action(doctor_id,milestone_id,state,reason) VALUES($1,$2,$3,$4) ON CONFLICT(doctor_id,milestone_id) DO UPDATE SET state=EXCLUDED.state,reason=EXCLUDED.reason,updated_at=NOW()`,[req.user.id,id,b.state,b.reason.trim()]);
   await c.query('INSERT INTO doctor_operations_event(doctor_id,mother_id,action,entity_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)',[req.user.id,m.mother_id,'worklist_'+b.state,id,JSON.stringify({reason:b.reason.trim()})]);await c.query('COMMIT');res.json({saved:true,message:'Worklist review saved. The clinical care gap remains unchanged.'});
  }catch(e){await c.query('ROLLBACK');res.status(e.status||500).json({error:e.status?e.message:'Worklist action failed'});}finally{c.release();}
 });
};
module.exports.transitions=transitions;
