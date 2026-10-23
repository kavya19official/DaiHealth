'use strict';
const dateKey=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const TASKS=['prescribed','water','rest','care_plan'];
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===value;}
function streak(rows,date=today()){
 const complete=new Set(rows.filter(r=>TASKS.every(k=>r.tasks?.[k]===true)).map(r=>dateKey(r.check_date)));
 const previous=d=>new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 let cursor=complete.has(date)?date:previous(date),count=0;
 while(complete.has(cursor)){count++;cursor=previous(cursor);}return count;
}
module.exports=function(app,{pool,authenticateToken,authorizeRole}){
 const own=[authenticateToken,authorizeRole(['mother'])];
 app.get('/api/patient/home',...own,async(req,res)=>{
  try{
   const date=today();const [daily,journal,logs]=await Promise.all([
    pool.query("SELECT check_date,tasks,mood FROM patient_daily_checkins WHERE mother_id=$1 AND check_date>=($2::date-366) ORDER BY check_date DESC",[req.user.id,date]),
    pool.query('SELECT j.id,j.entry_date,j.note,j.created_at,CASE WHEN d.deleted_at IS NULL THEN d.id END AS photo_document_id,d.mime_type AS photo_mime_type FROM patient_journal j LEFT JOIN patient_documents d ON d.id=j.photo_document_id AND d.mother_id=j.mother_id WHERE j.mother_id=$1 ORDER BY j.entry_date DESC,j.id DESC LIMIT 30',[req.user.id]),
    pool.query('SELECT id,child_id,event_type,started_at,duration_min FROM patient_baby_logs WHERE mother_id=$1 ORDER BY started_at DESC LIMIT 100',[req.user.id])
   ]);
   res.set('Cache-Control','no-store').json({date,daily:daily.rows.find(r=>dateKey(r.check_date)===date)||{tasks:{},mood:null},streak:streak(daily.rows,date),journal:journal.rows,baby_logs:logs.rows,label:'Self-reported personal notes; not a medical assessment'});
  }catch(e){console.error('Patient home:',e.message);res.status(500).json({error:'Could not load your personal check-ins'});}
 });
 app.put('/api/patient/home/checkin',...own,async(req,res)=>{
  const {date,tasks,mood}=req.body||{};
  if(date!==today()||(!tasks&&mood===undefined))return res.status(400).json({error:'Check-ins can only be saved for today'});
  if(tasks&&(typeof tasks!=='object'||Array.isArray(tasks)||Object.entries(tasks).some(([k,v])=>!TASKS.includes(k)||typeof v!=='boolean')))return res.status(400).json({error:'Choose a valid checklist item'});
  if(mood!==undefined&&!['good','okay','low','worried'].includes(mood))return res.status(400).json({error:'Choose a mood from the list'});
  try{
   const row=(await pool.query(`INSERT INTO patient_daily_checkins(mother_id,check_date,tasks,mood) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(mother_id,check_date) DO UPDATE SET tasks=patient_daily_checkins.tasks||EXCLUDED.tasks,mood=COALESCE(EXCLUDED.mood,patient_daily_checkins.mood),updated_at=NOW() RETURNING *`,[req.user.id,date,JSON.stringify(tasks||{}),mood||null])).rows[0];
   res.json({daily:row});
  }catch(e){res.status(500).json({error:'Your check-in was not saved'});}
 });
 app.post('/api/patient/home/journal',...own,async(req,res)=>{
  const {date,note='',photo_document_id=null}=req.body||{};
  if(!validDate(date)||date>today()||typeof note!=='string'||note.length>2000||(!note.trim()&&!photo_document_id))return res.status(400).json({error:'Add a note or photo and a valid date up to today'});
  try{
   if(photo_document_id){const photo=await pool.query("SELECT id FROM patient_documents WHERE id=$1 AND mother_id=$2 AND deleted_at IS NULL AND mime_type LIKE 'image/%'",[photo_document_id,req.user.id]);if(!photo.rows.length)return res.status(404).json({error:'Photo not found in your records'});}
   const result=await pool.query('INSERT INTO patient_journal(mother_id,entry_date,note,photo_document_id) VALUES($1,$2,$3,$4) RETURNING *',[req.user.id,date,note.trim(),photo_document_id]);res.status(201).json({entry:result.rows[0]});
  }catch(e){res.status(500).json({error:'Your journal entry was not saved'});}
 });
 app.post('/api/patient/home/baby-log',...own,async(req,res)=>{
  const {child_id,event_type,started_at,duration_min=null}=req.body||{},date=new Date(started_at);
  if(!Number.isInteger(child_id)||!['feed','sleep'].includes(event_type)||typeof started_at!=='string'||Number.isNaN(date.getTime())||date.getTime()>Date.now()+300000||(duration_min!==null&&(typeof duration_min!=='number'||!Number.isFinite(duration_min)||duration_min<=0||duration_min>1440)))return res.status(400).json({error:'Choose a baby, a past or current time and a valid duration'});
  try{
   const child=await pool.query('SELECT id,date_of_birth FROM children WHERE id=$1 AND mother_id=$2',[child_id,req.user.id]);if(!child.rows.length)return res.status(404).json({error:'Child not found in your account'});
   if(date.toISOString().slice(0,10)<dateKey(child.rows[0].date_of_birth))return res.status(400).json({error:'A baby log cannot be dated before birth'});
   const row=(await pool.query('INSERT INTO patient_baby_logs(mother_id,child_id,event_type,started_at,duration_min) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.id,child_id,event_type,started_at,duration_min])).rows[0];res.status(201).json({log:row});
  }catch(e){res.status(500).json({error:'Baby log was not saved'});}
 });
};
module.exports.streak=streak;module.exports.validDate=validDate;
