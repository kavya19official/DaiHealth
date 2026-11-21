'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const birthPlan=require('../shared/birth-plan'),FIELDS=birthPlan.limits;
// Reference intervals are transcribed from the source, never inferred from a test name.
function patientCandidates(text){
 const candidates=require('./reportExtraction').parseText(text);
 candidates.observations=candidates.observations.map(o=>{
  const m=o.source_line.match(/\b(?:reference(?:\s+(?:range|interval))?|ref\.?\s*range)\s*[:=]?\s*([<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)/i);
  // Do not treat an arbitrary trailing phrase as a platelet unit.
  if(o.label==='Platelets')o.unit=o.unit.match(/^(?:x?\s*10\^?9\s*\/\s*[lL]|(?:x?\s*10\^?3|thousand)\s*\/\s*[uµμ][lL]|\/\s*[uµμ][lL])/i)?.[0]||'';
  return {...o,reference_range:m?.[1]?.trim()||''};
 });
 return candidates;
}
module.exports=function(app,{pool,authenticateToken,authorizeRole,canAccessDoc,logEvent,uploadDir}){
 const mother=[authenticateToken,authorizeRole(['mother'])];
 const handle=fn=>async(req,res)=>{res.set('Cache-Control','private, no-store');try{await fn(req,res);}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Unable to save or load this information. Please retry.'});}};
 async function own(db,req){
  if(!/^\d+$/.test(req.params.id))throw Object.assign(Error('Report not found'),{status:404});
  const row=await canAccessDoc(db,Number(req.params.id),req.user);
  if(!row||Number(row.mother_id)!==req.user.id)throw Object.assign(Error('Report not found'),{status:404});
  if(row.is_sensitive&&req.query.reveal!=='1')throw Object.assign(Error('Reveal this private report first'),{status:403});
  return row;
 }
 app.post('/api/documents/:id/patient-preview',...mother,handle(async(req,res)=>{
  const row=await own(pool,req),file=path.join(uploadDir,row.storage_key),sourceHash=hash(await fs.readFile(file));
  let extraction;try{extraction=await require('./reportExtraction').extract(file,row.mime_type);}catch{extraction={source_text:'',candidates:{report_date:'',observations:[]},warnings:['Extraction unavailable. Read the original and enter values manually.']};}
  const candidates=extraction.source_text?patientCandidates(extraction.source_text):extraction.candidates;
  // No extracted text, draft, or observations are persisted by this endpoint.
  await logEvent(pool,row.id,req.user.id,'metadata_read',{action:'patient_preview'});
  res.json({candidates,source_sha256:sourceHash,warnings:extraction.warnings});
 }));
 app.post('/api/documents/:id/patient-confirm',...mother,handle(async(req,res)=>{
  const b=req.body||{},obs=b.observations,today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  if(b.confirm_source!==true||!require('./patientContinuity').dateValid(b.report_date)||b.report_date>today||!Array.isArray(obs)||obs.length<1||obs.length>40||!/^([a-f0-9]{64})$/.test(b.source_sha256||'')||obs.some(o=>!o||o.confirmed!==true||['label','value'].some(k=>typeof o[k]!=='string'||!o[k].trim()||o[k].length>120)||typeof o.unit!=='string'||o.unit.length>120||(!o.unit.trim()&&o.unit_not_printed!==true)||typeof o.reference_range!=='string'||o.reference_range.length>120))return res.status(400).json({error:'Check the report date and every value, unit and range, then confirm the original.'});
  const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT id FROM patient_documents WHERE id=$1 FOR UPDATE',[Number(req.params.id)]);const row=await own(db,req);
   if(hash(await fs.readFile(path.join(uploadDir,row.storage_key)))!==b.source_sha256)throw Object.assign(Error('The original changed. Preview it again before saving.'),{status:409});
   const clean=obs.map(o=>Object.fromEntries(['label','value','unit','reference_range'].map(k=>[k,o[k].trim()])));
   const result=await db.query('INSERT INTO patient_report_entries(id,document_id,mother_id,report_date,observations,source_sha256) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(document_id,source_sha256,report_date) DO NOTHING RETURNING *',[crypto.randomUUID(),row.id,req.user.id,b.report_date,JSON.stringify(clean),b.source_sha256]);
   if(!result.rows.length)throw Object.assign(Error('This report and date were already saved. Your earlier entry remains in the timeline.'),{status:409});
   await logEvent(db,row.id,req.user.id,'metadata_read',{action:'patient_confirmed_transcription',entry_id:result.rows[0].id});await db.query('COMMIT');res.status(201).json({entry:result.rows[0],message:'Saved as confirmed by you. Clinician verification is separate.'});
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }));
 app.get('/api/patient/report-timeline',...mother,handle(async(req,res)=>{
  const rows=(await pool.query('SELECT e.*,d.title,d.child_id,d.is_sensitive FROM patient_report_entries e JOIN patient_documents d ON d.id=e.document_id WHERE e.mother_id=$1 AND d.deleted_at IS NULL AND (NOT d.is_sensitive OR $2::boolean) ORDER BY e.report_date DESC,e.confirmed_at DESC',[req.user.id,req.query.reveal==='1'])).rows;
  if(req.query.reveal==='1')for(const row of rows.filter(x=>x.is_sensitive))await logEvent(pool,row.document_id,req.user.id,'metadata_read',{action:'patient_timeline_private_reveal'});
  res.json({entries:rows.map(x=>({...x,source:'patient_confirmed',clinical_verification:false}))});
 }));
 app.get('/api/patient/birth-plan',...mother,handle(async(req,res)=>res.json({plan:(await pool.query('SELECT preferences,version,updated_at FROM patient_birth_plans WHERE mother_id=$1',[req.user.id])).rows[0]||{preferences:{},version:0,updated_at:null}})));
 app.put('/api/patient/birth-plan',...mother,handle(async(req,res)=>{
  const b=req.body||{},p=b.preferences;
  if(!p||typeof p!=='object'||Array.isArray(p)||!Number.isInteger(b.version)||b.version<0||Object.keys(p).some(k=>!Object.hasOwn(FIELDS,k))||Object.entries(p).some(([k,v])=>typeof v!=='string'||v.length>FIELDS[k])||!birthPlan.dateValid(p.due_date||''))return res.status(400).json({error:'Check your preferences and reload the latest plan.'});
  const clean=Object.fromEntries(Object.entries(p).map(([k,v])=>[k,v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim()]));
  if(!birthPlan.dateValid(clean.discussion_date||'')||(Object.hasOwn(clean,'discussion_status')&&!birthPlan.discussionStatuses.includes(clean.discussion_status)))return res.status(400).json({error:'Check the discussion status and date.'});
  const previous=b.version?(await pool.query('SELECT preferences FROM patient_birth_plans WHERE mother_id=$1 AND version=$2',[req.user.id,b.version])).rows[0]?.preferences||{}:{};
  const changed=Object.entries(clean).some(([k,v])=>!k.startsWith('discussion_')&&v!==(previous[k]||''));
  // A discussion is patient-reported. Edited preferences require another discussion.
  if(previous.discussion_status==='discussed'&&changed)clean.discussion_status='review_again';
  const discussionDate=clean.discussion_date??previous.discussion_date;
  if((clean.discussion_status??previous.discussion_status)==='discussed'&&(!discussionDate||discussionDate>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})))return res.status(400).json({error:'Enter the date you discussed this plan, no later than today.'});
  const result=b.version===0?await pool.query('INSERT INTO patient_birth_plans(mother_id,preferences) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING preferences,version,updated_at',[req.user.id,JSON.stringify(clean)]):await pool.query('UPDATE patient_birth_plans SET preferences=preferences || $1::jsonb,version=version+1,updated_at=NOW() WHERE mother_id=$2 AND version=$3 RETURNING preferences,version,updated_at',[JSON.stringify(clean),req.user.id,b.version]);
  if(!result.rows.length)return res.status(409).json({error:'This plan changed elsewhere. Reload it before saving.'});res.json({plan:result.rows[0]});
 }));
};
Object.assign(module.exports,{patientCandidates,FIELDS});
