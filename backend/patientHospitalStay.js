'use strict';
const kinds=new Set(['vitals','medicine','feeding','weight','phototherapy','kangaroo','handover','next_check','followup']);
// Allow-list measurements only. Scores, internal comments and risk labels are never serialized.
const fields=['bp_systolic','bp_diastolic','pulse','temperature_c','weight_kg','minutes','due_at','followup_date'];
function releasedUpdate(row){return {id:row.id,child_id:row.child_id,kind:row.kind,recorded_at:row.recorded_at,recorded_by:row.recorded_by,text:row.patient_text,values:Object.fromEntries(fields.filter(k=>row.values_json?.[k]!=null).map(k=>[k,row.values_json[k]])),verified_at:row.verified_at,verified_by:row.verified_by,released_at:row.released_at,released_by:row.released_by,status:'released',updated:!!row.supersedes_id,supersedes_id:row.supersedes_id};}
function register(app,{pool,authenticateToken,authorizeRole}){
 const own=[authenticateToken,authorizeRole(['mother'])];
 app.get('/api/patient/hospital-stay',...own,async(req,res)=>{
  try{
   res.set('Cache-Control','no-store');
   const stays=(await pool.query(`SELECT * FROM patient_hospital_stays WHERE mother_id=$1 AND admitted_at<=now() AND (discharged_at IS NULL OR discharged_at+visible_days_after_discharge*INTERVAL '1 day'>=now()) ORDER BY admitted_at DESC`,[req.user.id])).rows;
   const preference=(await pool.query('SELECT caregiver_sharing FROM patient_stay_preferences WHERE mother_id=$1',[req.user.id])).rows[0];
   const result=[];
   for(const stay of stays){
    const updates=(await pool.query(`SELECT u.* FROM patient_stay_updates u WHERE u.stay_id=$1 AND u.recorded_at<=now() AND u.verified_at<=now() AND u.released_at<=now() AND u.verified_by IS NOT NULL AND u.released_by IS NOT NULL AND (u.child_id IS NULL OR EXISTS(SELECT 1 FROM children c WHERE c.id=u.child_id AND c.mother_id=$2)) ORDER BY u.recorded_at,u.id`,[stay.id,req.user.id])).rows;
    const children=(await pool.query('SELECT id,name FROM children WHERE mother_id=$1 ORDER BY id',[req.user.id])).rows.filter(c=>updates.some(u=>u.child_id===c.id));
    result.push({...stay,status:stay.discharged_at?'discharged':'admitted',children,updates:updates.filter(u=>kinds.has(u.kind)).map(releasedUpdate),notes:(await pool.query('SELECT id,note,created_at FROM patient_stay_notes WHERE stay_id=$1 AND mother_id=$2 ORDER BY created_at DESC',[stay.id,req.user.id])).rows});
   }
   await pool.query("INSERT INTO patient_stay_access_log(mother_id,action) VALUES($1,'read_released_stay')",[req.user.id]);
   res.json({stays:result,caregiver_sharing:!!preference?.caregiver_sharing,caregiver_access_connected:false});
  }catch(e){console.error('Hospital stay:',e.message);res.status(500).json({error:'Could not load hospital stay updates'});}
 });
 app.put('/api/patient/hospital-stay/sharing',...own,async(req,res)=>{
  if(typeof req.body?.caregiver_sharing!=='boolean')return res.status(400).json({error:'Choose whether to share hospital stay updates'});
  try{await pool.query('INSERT INTO patient_stay_preferences(mother_id,caregiver_sharing) VALUES($1,$2) ON CONFLICT(mother_id) DO UPDATE SET caregiver_sharing=EXCLUDED.caregiver_sharing,updated_at=now()',[req.user.id,req.body.caregiver_sharing]);await pool.query("INSERT INTO patient_stay_access_log(mother_id,action) VALUES($1,$2)",[req.user.id,req.body.caregiver_sharing?'sharing_preference_on':'sharing_preference_off']);res.json({caregiver_sharing:req.body.caregiver_sharing,caregiver_access_connected:false});}catch{res.status(500).json({error:'Could not save sharing preference'});}
 });
 app.post('/api/patient/hospital-stay/:id/questions',...own,async(req,res)=>{
  const note=typeof req.body?.note==='string'?req.body.note.trim():'';
  if(!/^\d+$/.test(req.params.id)||!note||note.length>1000)return res.status(400).json({error:'Write a question of up to 1,000 characters'});
  try{const stay=(await pool.query(`SELECT id FROM patient_hospital_stays WHERE id=$1 AND mother_id=$2 AND admitted_at<=now() AND (discharged_at IS NULL OR discharged_at+visible_days_after_discharge*INTERVAL '1 day'>=now())`,[req.params.id,req.user.id])).rows[0];if(!stay)return res.sendStatus(404);
   const row=(await pool.query('INSERT INTO patient_stay_notes(stay_id,mother_id,note) VALUES($1,$2,$3) RETURNING id,note,created_at',[stay.id,req.user.id,note])).rows[0];res.status(201).json({question:row,message:'Saved for your next conversation. This is not an urgent nurse-call channel.'});
  }catch{res.status(500).json({error:'Could not save your question'});}
 });
}
module.exports=register;module.exports.releasedUpdate=releasedUpdate;
