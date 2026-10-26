'use strict';
const crypto=require('node:crypto'),access=require('./accessControl');
const {verifiedDoctor}=require('./clinicalDashboard');
const KINDS=['pregnancy_risk','clinical_recommendation','document_interpretation'];
async function requestReview(db,mother,kind,summary,documentId=null,refresh=false,replaceSummary=false){
 // The partial unique index also prevents concurrent duplicate risk-log requests.
 const row=(await db.query(`INSERT INTO clinical_review_requests(id,mother_id,kind,summary,document_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *`,[crypto.randomUUID(),mother,kind,summary,documentId])).rows[0];
 if(row){await db.query("INSERT INTO clinical_review_events(request_id,actor_id,action,note) VALUES($1,$2,'requested',$3)",[row.id,mother,summary]);return row;}
 const existing=(await db.query("SELECT * FROM clinical_review_requests WHERE mother_id=$1 AND kind=$2 AND COALESCE(document_id,0)=COALESCE($3::int,0) AND state IN ('pending','escalated') FOR UPDATE",[mother,kind,documentId])).rows[0];
 if(replaceSummary&&existing&&existing.summary!==summary){const updated=(await db.query('UPDATE clinical_review_requests SET summary=$2,version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *',[existing.id,summary])).rows[0];await db.query("INSERT INTO clinical_review_events(request_id,actor_id,action,note) VALUES($1,$2,'patient_update',$3)",[existing.id,mother,summary]);return updated;}
 if(refresh&&existing){const updated=(await db.query('UPDATE clinical_review_requests SET version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *',[existing.id])).rows[0];await db.query("INSERT INTO clinical_review_events(request_id,actor_id,action,note) VALUES($1,$2,'context_updated',$3)",[existing.id,mother,'A new measurement was logged. Recheck the relevant original record before clinical sign-off.']);return updated;}
 return existing;
}
async function docAccess(db,row,doctor){
 if(!row.document_id)return true;
 return !!await require('./patientDocuments').canAccessDoc(db,row.document_id,{id:doctor,role:'doctor'});
}
function register(app,{pool,authenticateToken,authorizeRole}){
 const own=[authenticateToken,authorizeRole(['mother'])],doctor=[authenticateToken,authorizeRole(['doctor'])];
 const handle=fn=>async(req,res)=>{res.set('Cache-Control','private, no-store');try{await fn(req,res);}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Clinical review unavailable. Contact your care team directly; do not wait here for urgent help.'});}};
 const error=(status,message)=>Object.assign(Error(message),{status});
 app.post('/api/patient/clinical-reviews',...own,handle(async(req,res)=>{
  const b=req.body||{};
  if(Object.keys(b).some(k=>!['kind','summary','document_id'].includes(k))||!KINDS.includes(b.kind)||typeof b.summary!=='string'||b.summary.trim().length<5||b.summary.length>1000)throw error(400,'Choose a review type and a short relevant summary (5–1000 characters). Do not paste a full history.');
  const doc=b.document_id??null;
  if(b.kind==='document_interpretation'){
   if(!Number.isSafeInteger(doc)||doc<1||!(await pool.query('SELECT id FROM patient_documents WHERE id=$1 AND mother_id=$2 AND deleted_at IS NULL',[doc,req.user.id])).rows.length)throw error(404,'Choose a document from your own Records. Share it with your clinician separately.');
  }else if(doc!==null)throw error(400,'Document references are accepted only for document review.');
  const db=await pool.connect();try{await db.query('BEGIN');const row=await requestReview(db,req.user.id,b.kind,b.summary.trim(),doc,false,true);await db.query('COMMIT');res.status(201).json({request:row,notice:'Queued for human review. This is not a diagnosis, emergency dispatch or confirmation that a clinician has seen it.'});}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }));
 app.get('/api/patient/clinical-reviews',...own,handle(async(req,res)=>{
  const rows=(await pool.query('SELECT r.*,dp.full_name AS reviewer_name FROM clinical_review_requests r LEFT JOIN doctor_profiles dp ON dp.user_id=r.reviewer_id WHERE r.mother_id=$1 ORDER BY r.created_at DESC LIMIT 100',[req.user.id])).rows;
  for(const r of rows)r.history=(await pool.query('SELECT action,note,evidence_ref,created_at FROM clinical_review_events WHERE request_id=$1 ORDER BY id',[r.id])).rows;
  res.json({requests:rows});
 }));
 app.get('/api/doctor/clinical-reviews',...doctor,handle(async(req,res)=>{
  if(!await verifiedDoctor(pool,req.user.id))throw error(403,'Verified clinical credentials are required.');
  const rows=(await pool.query(`SELECT r.*,m.full_name AS patient_name,dp.full_name AS reviewer_name FROM clinical_review_requests r JOIN mother_profiles m ON m.user_id=r.mother_id LEFT JOIN doctor_profiles dp ON dp.user_id=r.reviewer_id WHERE ${access.activeRelationshipSql('r.mother_id','$1::int')} ORDER BY r.created_at DESC LIMIT 100`,[req.user.id])).rows,out=[];
  for(const r of rows)if(await docAccess(pool,r,req.user.id)){await access.logAccess(pool,r.mother_id,req.user.id,'clinical_review_queue',true);r.history=(await pool.query('SELECT action,note,evidence_ref,created_at FROM clinical_review_events WHERE request_id=$1 ORDER BY id',[r.id])).rows;out.push(r);}
  res.json({requests:out});
 }));
 app.post('/api/doctor/clinical-reviews/:id/decision',...doctor,handle(async(req,res)=>{
  const b=req.body||{};
  if(!/^[\da-f-]{36}$/i.test(req.params.id)||Object.keys(b).some(k=>!['version','action','note','evidence_ref','confirmed'].includes(k))||!Number.isInteger(b.version)||!['review_recorded','escalate','close'].includes(b.action)||b.confirmed!==true||typeof b.note!=='string'||b.note.trim().length<10||b.note.length>2000||typeof b.evidence_ref!=='string'||b.evidence_ref.trim().length<5||b.evidence_ref.length>300)throw error(400,'Confirm review of the relevant original record, record a decision/reason and evidence reference.');
  const db=await pool.connect();try{
   await db.query('BEGIN');
   // Keep revocations, relationships and credential changes from racing sign-off.
   await db.query('LOCK TABLE patient_access_controls,appointments,doctor_profiles,patient_document_shares,patient_preferences IN SHARE MODE');
   if(!await verifiedDoctor(db,req.user.id))throw error(403,'Verified clinical credentials are required.');
   const row=(await db.query('SELECT * FROM clinical_review_requests WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
   if(!row||!await access.hasDoctorAccess(db,req.user.id,row.mother_id)||!await docAccess(db,row,req.user.id))throw error(404,'Review not found or access was revoked.');
   if(row.version!==b.version)throw error(409,'Review changed. Refresh and review the latest state.');
   if(row.state==='closed'||row.state==='review_recorded'||row.state==='pending'&&b.action==='close'||row.state==='escalated'&&(row.reviewer_id!==req.user.id||b.action!=='close'))throw error(409,'Only the named escalation owner can close an escalated review. Completed decisions are retained.');
   const state={review_recorded:'review_recorded',escalate:'escalated',close:'closed'}[b.action];
   const updated=(await db.query('UPDATE clinical_review_requests SET state=$2,reviewer_id=$3,review_note=$4,evidence_ref=$5,version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *',[row.id,state,req.user.id,b.note.trim(),b.evidence_ref.trim()])).rows[0];
   await db.query('INSERT INTO clinical_review_events(request_id,actor_id,action,note,evidence_ref) VALUES($1,$2,$3,$4,$5)',[row.id,req.user.id,state,b.note.trim(),b.evidence_ref.trim()]);
   await access.logAccess(db,row.mother_id,req.user.id,'clinical_review_'+state,true);
   await db.query('COMMIT');res.json({request:updated});
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }));
}
module.exports={register,requestReview};
