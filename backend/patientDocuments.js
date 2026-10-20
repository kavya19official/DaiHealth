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
    can_delete: r.verification_status !== 'locked' && r.verification_status !== 'verified',
  };
}

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
           ON s.document_id = d.id AND s.doctor_id = $2 AND s.revoked_at IS NULL
        WHERE d.id = $1 AND d.deleted_at IS NULL`,
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
        `SELECT id, title, doc_type, original_filename, mime_type, size_bytes,
                verification_status, notes, uploaded_at
           FROM patient_documents
          WHERE mother_id = $1 AND deleted_at IS NULL
          ORDER BY uploaded_at DESC, id DESC`,
        [req.user.id]
      );
      res.json({ documents: r.rows.map(docRow) });
    } catch (err) {
      console.error('GET /api/documents', err.message);
      res.status(500).json({ error: 'Failed to load documents' });
    }
  });

  // Upload (JSON + base64 — no multer dependency)
  app.post('/api/documents', ...motherOnly, async (req, res) => {
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

      const storageKey = `${req.user.id}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
      const diskPath = path.join(UPLOAD_DIR, storageKey);
      fs.writeFileSync(diskPath, buffer);

      const r = await pool.query(
        `INSERT INTO patient_documents
           (mother_id, title, doc_type, original_filename, mime_type, size_bytes, storage_key, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, title, doc_type, original_filename, mime_type, size_bytes,
                   verification_status, notes, uploaded_at`,
        [req.user.id, title, docType, filename, mime, buffer.length, storageKey, notes]
      );
      const doc = r.rows[0];
      await logEvent(pool, doc.id, req.user.id, 'upload', {
        filename,
        mime_type: mime,
        size_bytes: buffer.length,
        doc_type: docType,
      });
      res.status(201).json({ message: 'Document uploaded', document: docRow(doc) });
    } catch (err) {
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
          `SELECT s.doctor_id, s.shared_at, dp.full_name AS doctor_name
             FROM patient_document_shares s
             LEFT JOIN doctor_profiles dp ON dp.user_id = s.doctor_id
            WHERE s.document_id = $1 AND s.revoked_at IS NULL
            ORDER BY s.shared_at DESC`,
          [id]
        );
        shares = s.rows;
      }
      res.json({ document: docRow(row), shares });
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

      const diskPath = path.join(UPLOAD_DIR, row.storage_key);
      if (!fs.existsSync(diskPath)) {
        return res.status(404).json({ error: 'File missing from storage' });
      }

      await logEvent(pool, id, req.user.id, 'download', {
        by_role: req.user.role,
      });

      res.setHeader('Content-Type', row.mime_type);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeFilename(row.original_filename)}"`
      );
      res.setHeader('Cache-Control', 'private, no-store');
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
      // Allow share even if no appointment yet (authorised provider list still includes all doctors)

      await pool.query(
        `INSERT INTO patient_document_shares (document_id, doctor_id, shared_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (document_id, doctor_id) DO UPDATE
           SET revoked_at = NULL, shared_at = NOW(), shared_by = EXCLUDED.shared_by`,
        [id, doctorId, req.user.id]
      );
      await logEvent(pool, id, req.user.id, 'share', {
        doctor_id: doctorId,
        had_appointment: linked.rows.length > 0,
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

  // Doctor: list documents shared with me
  app.get('/api/doctor/documents', ...doctorOnly, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT d.id, d.title, d.doc_type, d.original_filename, d.mime_type, d.size_bytes,
                d.verification_status, d.notes, d.uploaded_at, d.mother_id,
                mp.full_name AS mother_name, s.shared_at
           FROM patient_documents d
           INNER JOIN patient_document_shares s
             ON s.document_id = d.id AND s.doctor_id = $1 AND s.revoked_at IS NULL
           LEFT JOIN mother_profiles mp ON mp.user_id = d.mother_id
          WHERE d.deleted_at IS NULL
          ORDER BY s.shared_at DESC`,
        [req.user.id]
      );
      res.json({
        documents: r.rows.map((row) => ({
          ...docRow(row),
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
