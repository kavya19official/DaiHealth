'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
module.exports=function(app,{pool,authenticateToken,authorizeRole,canAccessDoc,logEvent,uploadDir}){
 const auth=[authenticateToken],doctor=[authenticateToken,authorizeRole(['doctor'])];
 const file=row=>path.join(uploadDir,row.storage_key);
 async function access(db,req){const row=await canAccessDoc(db,Number(req.params.id),req.user);if(!row)throw Object.assign(Error('Report not found or consent expired'),{status:404});if(row.is_sensitive&&req.query.reveal!=='1')throw Object.assign(Error('Reveal this private report explicitly first'),{status:403});return row;}
 const handle=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Report operation failed. Please retry.'});}};
 app.post('/api/documents/:id/intake',...doctor,handle(async(req,res)=>{
  const row=await access(pool,req);const bytes=await fs.readFile(file(row)),sourceHash=hash(bytes);
  let extracted;try{extracted=await require('./reportExtraction').extract(file(row),row.mime_type);}catch{extracted={source_text:'',candidates:{report_date:'',document_type:row.doc_type,observations:[]},warnings:['Extraction unavailable. Enter a draft manually and verify it against the original.']};}
  const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT id FROM patient_documents WHERE id=$1 FOR UPDATE',[row.id]);await access(db,req);const draft=(await db.query('INSERT INTO document_intake_drafts(id,document_id,created_by,source_sha256,source_text,candidates,warnings) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[crypto.randomUUID(),row.id,req.user.id,sourceHash,extracted.source_text,JSON.stringify(extracted.candidates),JSON.stringify(extracted.warnings)])).rows[0];await logEvent(db,row.id,req.user.id,'metadata_read',{action:'intake_draft',draft_id:draft.id});await db.query('COMMIT');res.status(201).json({draft});}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }));
 app.get('/api/documents/:id/verified-records',...auth,handle(async(req,res)=>{const row=await access(pool,req);const records=(await pool.query('SELECT * FROM verified_report_records WHERE document_id=$1 ORDER BY created_at DESC',[row.id])).rows;await logEvent(pool,row.id,req.user.id,'metadata_read',{action:'verified_records'});res.json({records});}));
 app.post('/api/documents/:id/intake/:draftId/verify',...doctor,handle(async(req,res)=>{
  const b=req.body||{},types=['medical_report','prescription','lab_report','discharge_summary','scan_imaging','other'];
  const validDate=require('./patientContinuity').dateValid;
  const observations=b.observations;
  if(b.confirm_source!==true||!validDate(b.report_date)||b.report_date>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})||!types.includes(b.document_type)||typeof b.review_note!=='string'||b.review_note.trim().length<5||b.review_note.length>2000||!Array.isArray(observations)||observations.length>40||observations.some(x=>x.confirmed!==true||['label','value','unit'].some(k=>typeof x[k]!=='string'||!x[k].trim()||x[k].length>120)))return res.status(400).json({error:'Confirm the original, date, type and each included value with its unit. Add a review note.'});
  const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT id FROM patient_documents WHERE id=$1 FOR UPDATE',[Number(req.params.id)]);const row=await access(db,req);
   // Hold share and privacy rows until the verification commits, so revocation cannot race the write.
   await db.query('SELECT id FROM patient_document_shares WHERE document_id=$1 AND doctor_id=$2 FOR UPDATE',[row.id,req.user.id]);await db.query('SELECT user_id FROM patient_preferences WHERE user_id=$1 FOR UPDATE',[row.mother_id]);await access(db,req);
   const credentials=(await db.query('SELECT medical_license_number FROM doctor_profiles WHERE user_id=$1',[req.user.id])).rows[0];if(!credentials?.medical_license_number)throw Object.assign(Error('A registered clinical account is required'),{status:403});
   const draft=(await db.query('SELECT * FROM document_intake_drafts WHERE id=$1 AND document_id=$2 FOR UPDATE',[req.params.draftId,row.id])).rows[0];if(!draft)throw Object.assign(Error('Draft not found'),{status:404});if(draft.status!=='draft')throw Object.assign(Error('Draft already verified. Create a new draft for a correction.'),{status:409});
   if(hash(await fs.readFile(file(row)))!==draft.source_sha256)throw Object.assign(Error('Original changed. Extract a fresh draft.'),{status:409});
   const clean=observations.map(x=>({label:x.label.trim(),value:x.value.trim(),unit:x.unit.trim()}));
   const record=(await db.query('INSERT INTO verified_report_records(id,draft_id,document_id,mother_id,report_date,document_type,observations,verified_by,review_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[crypto.randomUUID(),draft.id,row.id,row.mother_id,b.report_date,b.document_type,JSON.stringify(clean),req.user.id,b.review_note.trim()])).rows[0];
   await db.query("UPDATE document_intake_drafts SET status='verified' WHERE id=$1",[draft.id]);await db.query("UPDATE patient_documents SET verification_status='verified',reviewed_by=$1,doctor_note=$2 WHERE id=$3",[req.user.id,b.review_note.trim(),row.id]);await logEvent(db,row.id,req.user.id,'verify',{action:'structured_intake',draft_id:draft.id,record_id:record.id,original_candidates:draft.candidates,confirmed:{report_date:b.report_date,document_type:b.document_type,observations:clean}});await db.query('COMMIT');res.status(201).json({record,message:'Verified record saved. Earlier versions remain in history.'});
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }));
};
