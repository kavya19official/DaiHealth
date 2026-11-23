'use strict';

const { randomBytes, createHash } = require('node:crypto');
const QRCode = require('qrcode');
const Access = require('./accessControl');
const Clinical = require('./clinicalDashboard');
const { canAccessDoc } = require('./patientDocuments');

const hash = token => createHash('sha256').update(token).digest('hex');
const validId = id => Number.isInteger(id) && id > 0 && id <= 2147483647;
const maxReports = 8;
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function packetLink(req, token, env) {
  const configured = env.DAI_PUBLIC_ORIGIN;
  const origin = configured || req.get('origin');
  if (!origin) return null;
  try {
    const base = new URL(origin);
    const loopback = localHosts.has(base.hostname);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) return null;
    if (!configured && base.host !== (req.get('x-forwarded-host') || req.get('host'))) return null;
    const url = new URL('/record-packet.html', base.origin);
    url.hash = token;
    return url.href;
  } catch {
    return null;
  }
}

async function grant(pool, mother, doctor) {
  const result = await pool.query(`
    SELECT c.include_history, dp.full_name AS doctor_name
    FROM clinical_dashboard_consent c JOIN doctor_profiles dp ON dp.user_id=c.doctor_id
    WHERE c.mother_id=$1 AND c.doctor_id=$2 AND c.revoked_at IS NULL AND c.expires_at>NOW()
      AND COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean
                    FROM patient_preferences WHERE user_id=c.mother_id), TRUE)
      AND NOT ${Access.revokedSql('c.mother_id','c.doctor_id')}`, [mother, doctor]);
  const consent = result.rows[0];
  if (consent && await Clinical.verifiedDoctor(pool, doctor) && await Access.hasDoctorAccess(pool, doctor, mother)) {
    return consent;
  }
  return null;
}

async function selectedReports(pool, mother, doctor, ids) {
  const documents = await Promise.all(ids.map(id => canAccessDoc(pool, id, { id: doctor, role: 'doctor' })));
  return documents.filter(doc => doc && Number(doc.mother_id) === mother && doc.child_id == null && !doc.is_sensitive &&
    doc.verification_status !== 'rejected').map(doc => ({
    id: doc.id, title: doc.title, type: doc.doc_type, filename: doc.original_filename, mime: doc.mime_type
  }));
}

function profile(chart, includeHistory) {
  return {
    name: chart.patient.name,
    stage: chart.patient.stage?.label,
    measurements: chart.metrics.map(metric => ({
      label: metric.label, unit: metric.unit,
      clinical: (metric.readings || []).slice(-3).map(({ date, value, diastolic }) => ({ date, value, diastolic })),
      patient_reported: (metric.self_readings || []).slice(-3).map(({ date, value, diastolic }) => ({ date, value, diastolic }))
    })),
    care_plans: chart.carePlan.slice(0, 12).map(({ title, description, created_at }) => ({ title, description, created_at })),
    history: includeHistory ? {
      fields: chart.history.profile,
      visits: chart.history.visits.slice(0, 10).map(({ visit_date, facility, doctor }) => ({ visit_date, facility, doctor }))
    } : null
  };
}

function register(app, { pool, authenticateToken, authorizeRole, env = process.env }) {
  const patient = [authenticateToken, authorizeRole(['mother'])];
  const doctor = [authenticateToken, authorizeRole(['doctor'])];
  const unavailable = res => res.status(404).json({ error: 'Packet unavailable. Check the recipient, consent and expiry.' });
  const fail = res => res.status(500).json({ error: 'Could not complete the record packet request.' });
  function protect(res) {
    res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  }

  app.get('/api/patient/record-packets', ...patient, async (req, res) => {
    protect(res);
    try {
      const mother = req.user.id;
      const candidates = (await pool.query(`SELECT doctor_id FROM clinical_dashboard_consent
        WHERE mother_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY expires_at DESC`, [mother])).rows;
      const recipients = [];
      for (const { doctor_id: id } of candidates) {
        const allowed = await grant(pool, mother, id);
        if (allowed) recipients.push({ id, name: allowed.doctor_name, include_history: allowed.include_history });
      }
      const packets = (await pool.query(`SELECT p.id, p.expires_at, dp.full_name AS doctor_name
        FROM patient_record_packets p JOIN doctor_profiles dp ON dp.user_id=p.doctor_id
        WHERE p.mother_id=$1 AND p.revoked_at IS NULL AND p.expires_at>NOW() ORDER BY p.id DESC`, [mother])).rows;
      res.json({ recipients, packets, max_reports: maxReports });
    } catch { fail(res); }
  });

  app.get('/api/patient/record-packets/reports/:doctorId', ...patient, async (req, res) => {
    protect(res);
    const recipient = Number(req.params.doctorId);
    try {
      if (!validId(recipient) || !await grant(pool, req.user.id, recipient)) return unavailable(res);
      const result = await pool.query(`
        SELECT d.id,d.title,d.doc_type AS type
        FROM patient_documents d
        WHERE d.mother_id=$1 AND d.child_id IS NULL AND d.deleted_at IS NULL AND NOT COALESCE(d.is_sensitive,false)
          AND d.verification_status <> 'rejected'
          AND ((d.uploaded_by_role='doctor' AND d.uploaded_by=$2)
            OR EXISTS (SELECT 1 FROM patient_document_shares s WHERE s.document_id=d.id AND s.doctor_id=$2
              AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>NOW())))
        ORDER BY d.uploaded_at DESC, d.id DESC`, [req.user.id, recipient]);
      res.json({ reports: result.rows });
    } catch { fail(res); }
  });

  app.post('/api/patient/record-packets', ...patient, async (req, res) => {
    protect(res);
    const { doctor_id: recipient, document_ids: ids, confirmed } = req.body || {};
    if (confirmed !== true || !validId(recipient) || !Array.isArray(ids) || ids.length > maxReports ||
        ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'Confirm the recipient and select up to eight reports.' });
    }
    try {
      const mother = req.user.id;
      if (!await grant(pool, mother, recipient)) return unavailable(res);
      if ((await selectedReports(pool, mother, recipient, ids)).length !== ids.length) return unavailable(res);
      const token = randomBytes(32).toString('base64url');
      const code = 'dai-record:v1:' + token;
      const link = packetLink(req, token, env);
      if (!link) return res.status(503).json({ error: 'Open DaiHealth on its HTTPS address to create a phone-scannable QR.' });
      const qr = await QRCode.toDataURL(link, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
      const result = await pool.query(`
        INSERT INTO patient_record_packets(mother_id,doctor_id,token_hash,document_ids,expires_at)
        VALUES ($1,$2,$3,$4,NOW()+INTERVAL '10 minutes') RETURNING id,expires_at`, [mother, recipient, hash(token), ids]);
      res.status(201).json({ ...result.rows[0], code, qr, phone_reachable: !localHosts.has(new URL(link).hostname) });
    } catch { fail(res); }
  });

  app.delete('/api/patient/record-packets/:id', ...patient, async (req, res) => {
    protect(res);
    const id = Number(req.params.id);
    if (!validId(id)) return unavailable(res);
    try {
      const { rows } = await pool.query(`UPDATE patient_record_packets SET revoked_at=COALESCE(revoked_at,NOW())
        WHERE id=$1 AND mother_id=$2 RETURNING id`, [id, req.user.id]);
      if (!rows.length) return unavailable(res);
      res.json({ revoked: true });
    } catch { fail(res); }
  });

  app.post('/api/doctor/record-packets/redeem', ...doctor, async (req, res) => {
    protect(res);
    const code = req.body?.code;
    const match = typeof code === 'string' && /^dai-record:v1:([A-Za-z0-9_-]{43})$/.exec(code);
    if (!match) return unavailable(res);
    let db;
    try {
      db = await pool.connect();
      await db.query('BEGIN');
      await db.query(`LOCK TABLE patient_access_controls, clinical_dashboard_consent, patient_preferences,
        patient_documents, patient_document_shares, doctor_profiles IN SHARE MODE`);
      const { rows } = await db.query(`SELECT mother_id,document_ids,expires_at FROM patient_record_packets
        WHERE token_hash=$1 AND doctor_id=$2 AND expires_at>clock_timestamp() AND revoked_at IS NULL FOR SHARE`,
      [hash(match[1]), req.user.id]);
      const packet = rows[0];
      const consent = packet && await grant(db, packet.mother_id, req.user.id);
      if (!consent) {
        await db.query('ROLLBACK');
        return unavailable(res);
      }
      const chart = await Clinical.dashboard(db, packet.mother_id);
      const reports = await selectedReports(db, packet.mother_id, req.user.id, packet.document_ids);
      if (new Date(packet.expires_at).getTime() <= Date.now()) {
        await db.query('ROLLBACK');
        return unavailable(res);
      }
      await Access.logAccess(db, packet.mother_id, req.user.id, 'patient_record_packet', true);
      await db.query('COMMIT');
      res.json({ captured_at: new Date().toISOString(), expires_at: packet.expires_at,
        profile: profile(chart, consent.include_history), reports, omitted_reports: packet.document_ids.length - reports.length });
    } catch {
      if (db) await db.query('ROLLBACK').catch(() => {});
      fail(res);
    } finally { db?.release(); }
  });
}

module.exports = { register, profile, selectedReports };
