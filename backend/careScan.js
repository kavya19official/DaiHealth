'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { dateValid } = require('./patientContinuity');
const { extractPages, parsePages, validateSource, MAX_CANDIDATES } = require('./careScanExtraction');

const DOCUMENT_TYPES = {
  mcp_card: ['medical_report', 'documents', 'MCP card'],
  prescription: ['prescription', 'general', 'Prescription'],
  vaccination_card: ['medical_report', 'vaccination', 'Vaccination card'],
  lab_report: ['lab_report', 'general', 'Lab report'],
  medical_document: ['medical_report', 'documents', 'Medical document']
};
const KINDS = new Set(['medicine', 'vaccination', 'lab_result', 'antenatal_visit', 'other']);
const MAX_MANUAL = 12;
const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONS = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const IN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

function upload(body, readUpload) {
  if (typeof body.document_type !== 'string' || !Object.hasOwn(DOCUMENT_TYPES, body.document_type)) {
    throw fail(400, 'Choose a document type.');
  }
  const [docType, category, title] = DOCUMENT_TYPES[body.document_type];
  const base64 = body.content_base64;
  if (typeof base64 !== 'string' || base64.length > 4 * Math.ceil(MAX_BYTES / 3) ||
      !base64.length || base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64)) {
    throw fail(400, 'Choose a file up to 5 MB.');
  }
  const parsed = readUpload({ ...body, title, doc_type: docType, notes: undefined });
  if (parsed.error) throw fail(400, parsed.error.error);
  if (parsed.buffer.toString('base64') !== base64) throw fail(400, 'File content could not be read.');
  const childId = body.child_id ?? null;
  if (childId !== null && (!Number.isInteger(childId) || childId <= 0 || childId > 2147483647)) {
    throw fail(400, 'Choose a patient profile.');
  }
  validateSource(parsed.buffer, parsed.mime);
  const filename = (parsed.filename.replace(/\.[^.]+$/, '') || 'document') + EXTENSIONS[parsed.mime];
  return { ...parsed, filename, category, childId, documentType: body.document_type, hash: sha256(parsed.buffer) };
}

function field(row, key, max, required = false) {
  const value = row[key] ?? '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value) ||
      (required && !value.trim())) {
    throw fail(400, 'Check the required fields and lengths on each entry you confirmed.');
  }
  return value.trim() || null;
}

function decisionRows(rows, count, today, childId) {
  if (!Array.isArray(rows) || rows.length < count || rows.length > count + MAX_MANUAL) {
    throw fail(400, 'Verify or reject each extracted entry before saving.');
  }
  const accepted = [];
  for (const [index, row] of rows.entries()) {
    if (!row || row.candidate_id !== (index < count ? index + 1 : null) ||
        !['verify', 'reject'].includes(row.decision)) {
      throw fail(400, 'Verify or reject each extracted entry before saving.');
    }
    if (row.decision === 'reject') continue;
    if (!KINDS.has(row.kind) || (childId && row.kind === 'antenatal_visit')) {
      throw fail(400, 'Choose an entry type that belongs to this patient.');
    }
    if (!dateValid(row.occurred_on) || row.occurred_on < '1900-01-01' || row.occurred_on > today) {
      throw fail(400, 'Each confirmed entry needs a date from the original, up to today.');
    }
    accepted.push({
      kind: row.kind,
      occurred_on: row.occurred_on,
      label: field(row, 'label', 160, true),
      dosage: row.kind === 'medicine' || row.kind === 'vaccination' ? field(row, 'dosage', 120) : null,
      result: row.kind === 'lab_result' ? field(row, 'result', 160, true) : null,
      unit: row.kind === 'lab_result' ? field(row, 'unit', 40) : null,
      notes: field(row, 'notes', 300)
    });
  }
  return accepted;
}

function fingerprint(entry) {
  const parts = [entry.kind, entry.occurred_on, entry.label, entry.dosage, entry.result, entry.unit, entry.notes];
  return sha256(JSON.stringify(parts.map(part => (part || '').normalize('NFKC').trim().toLowerCase()
    .replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/'))));
}

async function timelineEntries(db, motherId) {
  return (await db.query(`
    SELECT e.id::text, e.document_id, e.child_id, to_char(e.occurred_on,'YYYY-MM-DD') AS occurred_on,
           e.kind, e.label, e.dosage, e.result, e.unit, e.notes, e.patient_confirmed_at
      FROM care_scan_entries e JOIN patient_documents d ON d.id=e.document_id
     WHERE e.mother_id=$1 AND d.deleted_at IS NULL
     ORDER BY e.occurred_on, e.id`, [motherId])).rows;
}

async function findSource(db, motherId, hash) {
  return (await db.query(`
    SELECT d.id, d.child_id,
           (SELECT id::text FROM care_scan_entries WHERE document_id=d.id ORDER BY occurred_on, id LIMIT 1) AS first_entry_id
      FROM care_scan_sources s JOIN patient_documents d ON d.id=s.document_id
     WHERE d.mother_id=$1 AND s.source_sha256=$2 AND d.deleted_at IS NULL`, [motherId, hash])).rows[0];
}

async function checkSubject(db, motherId, childId) {
  if (childId !== null && !(await db.query('SELECT 1 FROM children WHERE id=$1 AND mother_id=$2', [childId, motherId])).rows.length) {
    throw fail(400, 'Choose a child from your own patient profiles.');
  }
}

function register(app, { pool, authenticateToken, authorizeRole, uploadDir, readUpload, logEvent, jwtSecret }) {
  const own = [authenticateToken, authorizeRole(['mother'])];
  // Review tokens and logins use separate keys and a review token contains no medical fields.
  const key = jwtSecret ? crypto.createHmac('sha256', jwtSecret).update('dai-care-scan-review-v1').digest() : crypto.randomBytes(32);
  const tokenOptions = { audience: 'dai-care-scan-review' };
  const extracting = new Set();
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { await fn(req, res); }
    catch (error) {
      if (!error.status) console.error('CareScan operation failed', error.code || error.name);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'CareScan could not finish. Please try again.' });
    }
  };
  function duplicate(res, existing, source) {
    if (existing.child_id !== source.childId) throw fail(409, 'This original is already linked to another profile in your records.');
    return res.json({ already_saved: true, document_id: existing.id, first_entry_id: existing.first_entry_id, child_id: existing.child_id });
  }

  app.post('/api/patient/care-scan/extract', ...own, handle(async (req, res) => {
    const motherId = req.user.id;
    if (extracting.has(motherId) || extracting.size >= 2) {
      throw fail(429, 'CareScan is busy. Wait for the current scan to finish and try again.');
    }
    extracting.add(motherId);
    try {
      const source = upload(req.body || {}, readUpload);
      await checkSubject(pool, motherId, source.childId);
      const existing = await findSource(pool, motherId, source.hash);
      if (existing) return duplicate(res, existing, source);
      const { pages, warnings } = await extractPages(source.buffer, source.mime);
      const { candidates, truncated } = parsePages(pages, source.documentType, IN_DATE.format(new Date()));
      if (truncated) warnings.push('CareScan shows the first 40 entries it detected. You can add entries from the original.');
      if (!candidates.length) warnings.push('No clear entries were detected. You can transcribe readable entries from the original.');
      const reviewToken = jwt.sign({
        source_hash: source.hash, mime: source.mime, document_type: source.documentType,
        child_id: source.childId, candidate_count: candidates.length
      }, key, { ...tokenOptions, subject: String(motherId), expiresIn: '45m', algorithm: 'HS256' });
      res.json({ review_token: reviewToken, warnings, candidates: candidates.map((entry, index) => ({ ...entry, candidate_id: index + 1 })) });
    } finally {
      extracting.delete(motherId);
    }
  }));

  app.post('/api/patient/care-scan/confirm', ...own, handle(async (req, res) => {
    const motherId = req.user.id;
    const body = req.body || {};
    if (body.confirm_source !== true) throw fail(400, 'Confirm that you checked each accepted entry against the original.');
    let review;
    try {
      review = jwt.verify(body.review_token, key, { ...tokenOptions, subject: String(motherId), algorithms: ['HS256'] });
    } catch {
      throw fail(400, 'This review expired or is unavailable. Scan the original again.');
    }
    const source = upload(body, readUpload);
    if (source.hash !== review.source_hash || source.mime !== review.mime ||
        source.childId !== review.child_id || source.documentType !== review.document_type) {
      throw fail(409, 'The original or patient profile changed. Scan the original again.');
    }
    const entries = decisionRows(body.entries, review.candidate_count, IN_DATE.format(new Date()), source.childId);
    if (!entries.length) return res.json({ saved: 0, duplicates: 0 });

    const db = await pool.connect();
    let writtenFile;
    try {
      await db.query('BEGIN');
      // Serialize saves for this owner across instances so duplicate checks and writes are atomic.
      if (!(await db.query('SELECT id FROM users WHERE id=$1 AND closed_at IS NULL FOR UPDATE', [motherId])).rows.length) {
        throw fail(403, 'Account unavailable.');
      }
      await checkSubject(db, motherId, source.childId);
      const existing = await findSource(db, motherId, source.hash);
      if (existing) {
        await db.query('COMMIT');
        return duplicate(res, existing, source);
      }

      const pending = new Map();
      for (const entry of entries) {
        const hash = fingerprint(entry);
        if (!pending.has(hash)) pending.set(hash, entry);
      }
      const matches = (await db.query(`
        SELECT e.fingerprint, e.id::text AS entry_id, e.document_id
          FROM care_scan_entries e JOIN patient_documents d ON d.id=e.document_id
         WHERE e.mother_id=$1 AND e.child_id IS NOT DISTINCT FROM $2 AND d.deleted_at IS NULL
           AND e.fingerprint=ANY($3::text[])
         ORDER BY e.occurred_on,e.id`, [motherId, source.childId, [...pending.keys()]])).rows;
      for (const row of matches) {
        pending.delete(row.fingerprint);
      }
      const duplicates = entries.length - pending.size;
      if (!pending.size) {
        await db.query('COMMIT');
        return res.json({ saved: 0, duplicates, document_id: matches[0]?.document_id,
          first_entry_id: matches[0]?.entry_id, child_id: source.childId });
      }
      const storageKey = 'care-scan-' + crypto.randomUUID();
      const diskPath = path.join(uploadDir, storageKey);
      const original = await fs.open(diskPath, 'wx', 0o600);
      writtenFile = diskPath;
      try {
        await original.writeFile(source.buffer);
      } finally {
        await original.close();
      }
      const { id } = (await db.query(`
        INSERT INTO patient_documents
          (mother_id, title, doc_type, original_filename, mime_type, size_bytes, storage_key,
           child_id, is_sensitive, report_category, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$1)
        RETURNING id`, [motherId, source.title, source.docType, source.filename, source.mime,
        source.buffer.length, storageKey, source.childId, source.category])).rows[0];
      await db.query('INSERT INTO care_scan_sources(document_id,source_sha256) VALUES($1,$2)', [id, source.hash]);
      let firstEntry;
      for (const [hash, entry] of [...pending].sort((a, b) => a[1].occurred_on.localeCompare(b[1].occurred_on))) {
        const { id: entryId } = (await db.query(`
          INSERT INTO care_scan_entries(document_id,mother_id,child_id,occurred_on,kind,label,dosage,result,unit,notes,fingerprint)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id::text`, [
          id, motherId, source.childId, entry.occurred_on, entry.kind, entry.label,
          entry.dosage, entry.result, entry.unit, entry.notes, hash
        ])).rows[0];
        firstEntry ??= entryId;
      }
      await logEvent(db, id, motherId, 'upload', { action: 'care_scan_patient_confirmation', entries: pending.size });
      await db.query('COMMIT');
      writtenFile = null;
      res.status(201).json({ saved: pending.size, duplicates, document_id: id, first_entry_id: firstEntry, child_id: source.childId });
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      if (writtenFile) await fs.rm(writtenFile, { force: true }).catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }));
}

module.exports = { register, timelineEntries };
