/**
 * Patient documents API
 *
 * Mother:
 *   GET    /api/documents
 *   POST   /api/documents              { title, doc_type, filename, mime_type, content_base64, notes? }
 *   GET    /api/documents/:id          metadata
 *   GET    /api/documents/:id/download binary file (authorised)
 *   DELETE /api/documents/:id          soft-delete when policy allows
 *   POST   /api/documents/:id/share    { doctor_id }
 *   DELETE /api/documents/:id/share/:doctorId
 *   GET    /api/documents/:id/history  upload/share/download events
 *
 * Doctor (shared only):
 *   GET    /api/doctor/documents
 *   GET    /api/documents/:id/download
 *
 * Files on disk under backend/data/patient-documents/<storage_key>
 * Max 5 MB. Allowed MIME: PDF + common images.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const DOC_TYPES = new Set([
  'medical_report',
  'prescription',
  'lab_report',
  'discharge_summary',
  'scan_imaging',
  'other',
]);

const UPLOAD_DIR =
  process.env.PATIENT_DOCS_DIR ||
  path.join(__dirname, 'data', 'patient-documents');

function ensureDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function cleanStr(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function safeFilename(name) {
  return path
    .basename(String(name || 'document'))
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-100) || 'document';
}

function docRow(r) {
  return {
    id: r.id,
    title: r.title,
    doc_type: r.doc_type,
    original_filename: r.original_filename,
    mime_type: r.mime_type,
    size_bytes: r.size_bytes,
    verification_status: r.verification_status,
    notes: r.notes,
    uploaded_at: r.uploaded_at,
    report_category:r.report_category,report_date:r.report_date,facility_name:r.facility_name,child_id:r.child_id,milestone_id:r.milestone_id,appointment_id:r.appointment_id,is_sensitive:!!r.is_sensitive,viewed_at:r.viewed_at,reviewed_by:r.reviewed_by,doctor_note:r.doctor_note,source:'self_uploaded',
    can_delete: r.verification_status !== 'locked' && r.verification_status !== 'verified',
  };
}

function redact(row){return row.is_sensitive?{...row,title:row.report_category==='documents'?'Private document':'Private screening report',original_filename:'Private file',notes:null,doctor_note:null}:row;}

async function logEvent(pool, documentId, actorId, eventType, detail) {
  await pool.query(
    `INSERT INTO patient_document_events (document_id, actor_id, event_type, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [documentId, actorId || null, eventType, JSON.stringify(detail || {})]
  );
}

async function motherOwnsDoc(pool, docId, motherId) {
  const r = await pool.query(
    `SELECT * FROM patient_documents
      WHERE id = $1 AND mother_id = $2 AND deleted_at IS NULL`,
    [docId, motherId]
  );
  return r.rows[0] || null;
}

async function canAccessDoc(pool, docId, user) {
  if (!user) return null;
  if (user.role === 'mother') {
    return motherOwnsDoc(pool, docId, user.id);
  }
  if (user.role === 'doctor') {
    const r = await pool.query(
      `SELECT d.* FROM patient_documents d
         INNER JOIN patient_document_shares s
           ON s.document_id = d.id AND s.doctor_id = $2 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>NOW())
        WHERE d.id = $1 AND d.deleted_at IS NULL
          AND COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean FROM patient_preferences WHERE user_id=d.mother_id),TRUE)`,
      [docId, user.id]
    );
    return r.rows[0] || null;
  }
  return null;
}

module.exports = function registerPatientDocuments(app, { pool, authenticateToken, authorizeRole }) {
  ensureDir();

  const motherOnly = [authenticateToken, authorizeRole(['mother'])];
  const doctorOnly = [authenticateToken, authorizeRole(['doctor'])];
  const anyAuth = [authenticateToken];

  // List own documents
  app.get('/api/documents', ...motherOnly, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT *
           FROM patient_documents
          WHERE mother_id = $1 AND deleted_at IS NULL
          ORDER BY uploaded_at DESC, id DESC`,
        [req.user.id]
      );
      await Promise.all(r.rows.map(row=>logEvent(pool,row.id,req.user.id,'metadata_read',{list:true})));
      res.set('Cache-Control','no-store').json({ documents: r.rows.map(row=>redact(docRow(row))) });
    } catch (err) {
      console.error('GET /api/documents', err.message);
      res.status(500).json({ error: 'Failed to load documents' });
    }
  });

  // Upload (JSON + base64 — no multer dependency)
  app.post('/api/documents', ...motherOnly, async (req, res) => {
    let writtenFile;
    try {
      const b = req.body || {};
      const title = cleanStr(b.title, 200);
      const docType = cleanStr(b.doc_type, 40);
      const filename = safeFilename(b.filename || b.original_filename || 'document.pdf');
      const mime = cleanStr(b.mime_type, 120).toLowerCase();
      const notes = cleanStr(b.notes, 2000) || null;
      const b64 = typeof b.content_base64 === 'string' ? b.content_base64.replace(/^data:[^;]+;base64,/, '') : '';

      if (!title) return res.status(400).json({ error: 'Title is required' });
      if (!DOC_TYPES.has(docType)) {
        return res.status(400).json({
          error: 'Invalid document type',
          allowed: Array.from(DOC_TYPES),
        });
      }
      if (!ALLOWED_MIME.has(mime)) {
        return res.status(400).json({
          error: 'Unsupported file type. Use PDF, JPEG, PNG or WebP.',
        });
      }
      if (!b64) return res.status(400).json({ error: 'File content is required' });

      let buffer;
      try {
        buffer = Buffer.from(b64, 'base64');
      } catch {
        return res.status(400).json({ error: 'Invalid file encoding' });
      }
      if (!buffer.length || buffer.length > MAX_BYTES) {
        return res.status(400).json({ error: 'File must be between 1 byte and 5 MB' });
      }

      const dateValid=require('./patientContinuity').dateValid;
      if(b.report_date&&(!dateValid(b.report_date)||b.report_date>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})))return res.status(400).json({error:'Choose a valid report date, up to today'});
      if(b.child_id&&!(await pool.query('SELECT id FROM children WHERE id=$1 AND mother_id=$2',[b.child_id,req.user.id])).rows.length)return res.status(400).json({error:'Child must belong to your own records'});
      if(b.milestone_id&&b.child_id)return res.status(400).json({error:'Keep mother milestones and baby reports separate'});
      if(b.milestone_id){const milestone=(await pool.query('SELECT id,completion_verification FROM care_milestones WHERE id=$1 AND mother_id=$2',[b.milestone_id,req.user.id])).rows[0];if(!milestone)return res.status(400).json({error:'Milestone must belong to your own care plan'});if(milestone.completion_verification==='verified')return res.status(400).json({error:'This milestone already has a clinician-verified result. Upload the file without replacing that result.'});}
      if(b.appointment_id&&!(await pool.query('SELECT id FROM appointments WHERE id=$1 AND mother_id=$2 AND child_id IS NOT DISTINCT FROM $3',[b.appointment_id,req.user.id,b.child_id||null])).rows.length)return res.status(400).json({error:'Visit must belong to the same patient record'});
      const storageKey = `${req.user.id}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
      const diskPath = path.join(UPLOAD_DIR, storageKey);
      fs.writeFileSync(diskPath, buffer);writtenFile=diskPath;
      const client=await pool.connect();let doc;try{await client.query('BEGIN');

      const r = await client.query(
        `INSERT INTO patient_documents
           (mother_id, title, doc_type, original_filename, mime_type, size_bytes, storage_key, notes,report_date,facility_name,child_id,milestone_id,appointment_id,is_sensitive,report_category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [req.user.id, title, docType, filename, mime, buffer.length, storageKey, notes,b.report_date||null,cleanStr(b.facility_name,200)||null,b.child_id||null,b.milestone_id||null,b.appointment_id||null,b.is_sensitive===true||/\b(hiv|vdrl|syphilis)\b/i.test(title+' '+notes),['blood','urine','screening','vaccination','documents','general'].includes(b.report_category)?b.report_category:null]
      );
      doc = r.rows[0];
      if(doc.milestone_id)await client.query("UPDATE care_milestones SET result_id=$1,completed_at=COALESCE(completed_at,NOW()),completion_verification='awaiting_verification',verified_facility_name=NULL WHERE id=$2 AND mother_id=$3 AND completion_verification IS DISTINCT FROM 'verified'",[doc.id,doc.milestone_id,req.user.id]);
      await logEvent(client, doc.id, req.user.id, 'upload', {
        filename,
        mime_type: mime,
        size_bytes: buffer.length,
        doc_type: docType,
      });
      await client.query('COMMIT');writtenFile=null;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      res.status(201).json({ message: 'Self-uploaded report saved; awaiting clinician verification', document: redact(docRow(doc)) });
    } catch (err) {
      if(writtenFile)try{fs.unlinkSync(writtenFile);}catch{}
      console.error('POST /api/documents', err.message);
      res.status(500).json({ error: 'Failed to upload document' });
    }
  });

  // Metadata
  app.get('/api/documents/:id', ...anyAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const row = await canAccessDoc(pool, id, req.user);
      if (!row) return res.status(404).json({ error: 'Document not found' });

      let shares = [];
      if (req.user.role === 'mother' && row.mother_id === req.user.id) {
        const s = await pool.query(
          `SELECT s.doctor_id, s.shared_at,s.expires_at, dp.full_name AS doctor_name
             FROM patient_document_shares s
             LEFT JOIN doctor_profiles dp ON dp.user_id = s.doctor_id
            WHERE s.document_id = $1 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>NOW())
            ORDER BY s.shared_at DESC`,
          [id]
        );
        shares = s.rows;
      }
      const reveal=req.query.reveal==='1';
      await logEvent(pool,id,req.user.id,reveal&&row.is_sensitive?'reveal':'metadata_read',{by_role:req.user.role});
      if(req.user.role==='mother')await pool.query('UPDATE patient_documents SET viewed_at=NOW() WHERE id=$1',[id]);
      res.set('Cache-Control','no-store').json({ document: reveal?docRow(row):redact(docRow(row)), shares });
    } catch (err) {
      console.error('GET /api/documents/:id', err.message);
      res.status(500).json({ error: 'Failed to load document' });
    }
  });

  // Download
  app.get('/api/documents/:id/download', ...anyAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const row = await canAccessDoc(pool, id, req.user);
      if (!row) return res.status(404).json({ error: 'Document not found' });

      if(row.is_sensitive&&req.query.reveal!=='1')return res.status(403).json({error:'Confirm that you want to reveal this private report before opening it'});
      const diskPath = path.join(UPLOAD_DIR, row.storage_key);
      if (!fs.existsSync(diskPath)) {
        return res.status(404).json({ error: 'File missing from storage' });
      }

      await logEvent(pool, id, req.user.id, req.query.inline==='1'?'preview':'download', {
        by_role: req.user.role,
      });

      res.setHeader('Content-Type', row.mime_type);
      res.setHeader(
        'Content-Disposition',
        `${req.query.inline==='1'?'inline':'attachment'}; filename="${safeFilename(row.original_filename)}"`
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
      fs.createReadStream(diskPath).pipe(res);
    } catch (err) {
      console.error('GET /api/documents/:id/download', err.message);
      res.status(500).json({ error: 'Failed to download document' });
    }
  });

  // Soft-delete (policy: owner only; not when locked/verified)
  app.delete('/api/documents/:id', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const row = await motherOwnsDoc(pool, id, req.user.id);
      if (!row) return res.status(404).json({ error: 'Document not found' });
      if (row.verification_status === 'locked' || row.verification_status === 'verified') {
        return res.status(403).json({
          error: 'This document cannot be deleted under current policy (verified or locked).',
        });
      }

      await pool.query(
        `UPDATE patient_documents SET deleted_at = NOW() WHERE id = $1 AND mother_id = $2`,
        [id, req.user.id]
      );
      await pool.query("UPDATE care_milestones SET result_id=NULL,completed_at=NULL,completion_verification=NULL WHERE result_id=$1 AND completion_verification='awaiting_verification'",[id]);
      await logEvent(pool, id, req.user.id, 'delete', {});

      // Best-effort remove file
      try {
        const diskPath = path.join(UPLOAD_DIR, row.storage_key);
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
      } catch (_) {}

      res.json({ message: 'Document deleted' });
    } catch (err) {
      console.error('DELETE /api/documents/:id', err.message);
      res.status(500).json({ error: 'Failed to delete document' });
    }
  });

  // Share with authorised doctor (must be a doctor user; preferably already linked via appointments)
  app.post('/api/documents/:id/share', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const doctorId = parseInt(req.body && req.body.doctor_id, 10);
      if (Number.isNaN(id) || Number.isNaN(doctorId)) {
        return res.status(400).json({ error: 'document id and doctor_id are required' });
      }
      const row = await motherOwnsDoc(pool, id, req.user.id);
      if (!row) return res.status(404).json({ error: 'Document not found' });

      const docUser = await pool.query(
        `SELECT u.id FROM users u WHERE u.id = $1 AND u.role = 'doctor'`,
        [doctorId]
      );
      if (!docUser.rows.length) return res.status(400).json({ error: 'Doctor not found' });

      if(row.is_sensitive&&req.body?.sensitive_consent!==true)return res.status(400).json({error:'Explicit consent is required to share this private report'});
      const expiresAt=req.body?.expires_at?new Date(req.body.expires_at):new Date(Date.now()+86400000);
      if(Number.isNaN(expiresAt.getTime())||expiresAt<=new Date()||expiresAt.getTime()>Date.now()+30*86400000)return res.status(400).json({error:'Choose a share expiry within the next 30 days'});
      // Prefer doctors the mother has already requested appointments with
   const linked = await pool.query(
  `SELECT 1
     FROM appointments
    WHERE mother_id = $1
      AND doctor_id = $2
      AND status IN ('pending', 'confirmed', 'completed')
    LIMIT 1`,
  [req.user.id, doctorId]
);

if (!linked.rows.length) {
  return res.status(403).json({
    error: 'You can only share documents with a doctor connected to your care.'
  });
}
      // Sharing is limited to connected care providers and expires at the requested time.

      await pool.query(
        `INSERT INTO patient_document_shares (document_id, doctor_id, shared_by,expires_at)
         VALUES ($1, $2, $3,$4)
         ON CONFLICT (document_id, doctor_id) DO UPDATE
           SET revoked_at = NULL, shared_at = NOW(), shared_by = EXCLUDED.shared_by,expires_at=EXCLUDED.expires_at`,
        [id, doctorId, req.user.id,expiresAt.toISOString()]
      );
      await logEvent(pool, id, req.user.id, 'share', {
        doctor_id: doctorId,
        had_appointment: linked.rows.length > 0,expires_at:expiresAt.toISOString(),sensitive_consent:row.is_sensitive===true,
      });
      res.json({ message: 'Document shared with provider' });
    } catch (err) {
      console.error('POST /api/documents/:id/share', err.message);
      res.status(500).json({ error: 'Failed to share document' });
    }
  });

  app.delete('/api/documents/:id/share/:doctorId', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const doctorId = parseInt(req.params.doctorId, 10);
      if (Number.isNaN(id) || Number.isNaN(doctorId)) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      const row = await motherOwnsDoc(pool, id, req.user.id);
      if (!row) return res.status(404).json({ error: 'Document not found' });

      const r = await pool.query(
        `UPDATE patient_document_shares
            SET revoked_at = NOW()
          WHERE document_id = $1 AND doctor_id = $2 AND revoked_at IS NULL
          RETURNING id`,
        [id, doctorId]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Share not found' });
      await logEvent(pool, id, req.user.id, 'revoke_share', { doctor_id: doctorId });
      res.json({ message: 'Share revoked' });
    } catch (err) {
      console.error('DELETE share', err.message);
      res.status(500).json({ error: 'Failed to revoke share' });
    }
  });

  // Upload / share / download history
  app.get('/api/documents/:id/history', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const row = await motherOwnsDoc(pool, id, req.user.id);
      if (!row) return res.status(404).json({ error: 'Document not found' });

      const r = await pool.query(
        `SELECT e.id, e.event_type, e.detail, e.created_at, e.actor_id,
                COALESCE(mp.full_name, dp.full_name, u.email) AS actor_name
           FROM patient_document_events e
           LEFT JOIN users u ON u.id = e.actor_id
           LEFT JOIN mother_profiles mp ON mp.user_id = e.actor_id
           LEFT JOIN doctor_profiles dp ON dp.user_id = e.actor_id
          WHERE e.document_id = $1
          ORDER BY e.created_at DESC
          LIMIT 100`,
        [id]
      );
      res.json({ history: r.rows });
    } catch (err) {
      console.error('GET history', err.message);
      res.status(500).json({ error: 'Failed to load history' });
    }
  });

  app.post('/api/documents/:id/problem',...motherOnly,async(req,res)=>{
    try{const row=await motherOwnsDoc(pool,Number(req.params.id),req.user.id);if(!row)return res.status(404).json({error:'Report not found'});
      const reason=cleanStr(req.body?.reason,1000);if(!reason)return res.status(400).json({error:'Tell the care team what needs checking'});
      await pool.query('INSERT INTO patient_record_issues(mother_id,document_id,reason) VALUES($1,$2,$3)',[req.user.id,row.id,reason]);await logEvent(pool,row.id,req.user.id,'problem_report',{});res.status(201).json({message:'Issue recorded for care-team review. For urgent help, contact your care team directly.'});
    }catch(e){res.status(500).json({error:'Could not record this issue'});}
  });
  app.patch('/api/documents/:id/review',...doctorOnly,async(req,res)=>{
    try{const row=await canAccessDoc(pool,Number(req.params.id),req.user);if(!row)return res.status(404).json({error:'Shared report not found'});
      const credentials=(await pool.query('SELECT medical_license_number,facility_name FROM doctor_profiles WHERE user_id=$1',[req.user.id])).rows[0];if(!credentials?.medical_license_number)return res.status(403).json({error:'A registered clinical account is required'});
      const note=cleanStr(req.body?.doctor_note,2000);if(!note)return res.status(400).json({error:'Enter your review note'});
      const client=await pool.connect();try{await client.query('BEGIN');await client.query("UPDATE patient_documents SET reviewed_by=$1,doctor_note=$2,verification_status='verified' WHERE id=$3",[req.user.id,note,row.id]);if(row.milestone_id)await client.query("UPDATE care_milestones SET completion_verification='verified',verified_facility_name=$1 WHERE id=$2 AND mother_id=$3 AND result_id=$4",[credentials.facility_name||null,row.milestone_id,row.mother_id,row.id]);await logEvent(client,row.id,req.user.id,'verify',{});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      res.json({message:'Clinician review recorded'});
    }catch(e){res.status(500).json({error:'Could not save the review'});}
  });

  // Doctor: list documents shared with me
  app.get('/api/doctor/documents', ...doctorOnly, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT d.id, d.title, d.doc_type, d.original_filename, d.mime_type, d.size_bytes,
                d.verification_status, d.notes, d.uploaded_at,d.report_category,d.report_date,d.facility_name,d.child_id,d.milestone_id,d.appointment_id,d.is_sensitive,d.viewed_at,d.reviewed_by,d.doctor_note, d.mother_id,
                mp.full_name AS mother_name, s.shared_at
           FROM patient_documents d
           INNER JOIN patient_document_shares s
             ON s.document_id = d.id AND s.doctor_id = $1 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>NOW())
           LEFT JOIN mother_profiles mp ON mp.user_id = d.mother_id
          WHERE d.deleted_at IS NULL
            AND COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean FROM patient_preferences WHERE user_id=d.mother_id),TRUE)
          ORDER BY s.shared_at DESC`,
        [req.user.id]
      );
      await Promise.all(r.rows.map(row=>logEvent(pool,row.id,req.user.id,'metadata_read',{list:true,by_role:'doctor'})));
      res.set('Cache-Control','no-store').json({
        documents: r.rows.map((row) => ({
          ...redact(docRow(row)),
          mother_id: row.mother_id,
          mother_name: row.mother_name,
          shared_at: row.shared_at,
        })),
      });
    } catch (err) {
      console.error('GET /api/doctor/documents', err.message);
      res.status(500).json({ error: 'Failed to load shared documents' });
    }
  });
};
