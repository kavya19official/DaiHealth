'use strict';

const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { revokedSql, logAccess } = require('./accessControl');
const { verifiedDoctor } = require('./clinicalDashboard');

const FORMATS = ['image/png', 'image/jpeg', 'image/webp'];
const SCAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rawImage = express.raw({ type: FORMATS, limit: '12mb', inflate: false });

function id(value) {
  const result = /^[0-9]+$/.test(String(value)) ? Number(value) : 0;
  return Number.isSafeInteger(result) && result > 0 && result <= 2147483647 ? result : null;
}

function activeAppointments() {
  return `a.status IN ('confirmed','completed')
          AND NOT ${revokedSql('a.mother_id', 'a.doctor_id', 'a.facility_uuid')}`;
}

module.exports = function register(app, {pool, authenticateToken, authorizeRole, env = process.env, fetcher = fetch,
  verifyDoctor = verifiedDoctor}) {
  const enabled = env.DAI_ULTRASOUND_ENABLED === 'true';
  const key = env.DAI_ULTRASOUND_GATEWAY_TOKEN;
  const path = '/internal/ultrasound-workspace/scans';

  function guard(handler) {
    return async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      if (!enabled) return res.status(503).json({error:'Ultrasound is disabled on this deployment.'});
      try { await handler(req, res); }
      catch { if (!res.headersSent) res.status(503).json({error:'Ultrasound is temporarily unavailable. Try again.'}); }
    };
  }

  async function forward(res, grant, suffix = '', method = 'GET', payload, media = 'application/json') {
    const origin = new URL(env.DAI_PORTAL_API_ORIGIN || 'http://127.0.0.1:8100');
    if (!key || key.length < 32 || origin.username || origin.password || origin.pathname !== '/' ||
        origin.search || origin.hash || !(origin.protocol === 'https:' ||
        origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))) {
      throw new Error('Private ultrasound gateway is not configured');
    }
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload === undefined ? '' : JSON.stringify(payload));
    const target = path + suffix;
    const token = jwt.sign({...grant, method, path:target, sha256:crypto.createHash('sha256').update(bytes).digest('hex')},
      key, { algorithm:'HS256', issuer:'dai-workspace', audience:'dai-ultrasound-workspace', expiresIn:60 });
    const reply = await fetcher(new URL(target, origin), {
      method, headers:{'x-dai-ultrasound-workspace':token, 'content-type':media},
      body:method === 'GET' ? undefined : bytes, redirect:'error', signal:AbortSignal.timeout(35000),
    });
    const type = reply.headers.get('content-type')?.split(';')[0];
    if (reply.ok && type === 'image/png' && suffix.endsWith('/image')) {
      res.set('X-Content-Type-Options','nosniff');
      return res.type('png').send(Buffer.from(await reply.arrayBuffer()));
    }
    if (type !== 'application/json') throw new Error('Unexpected ultrasound response');
    const body = await reply.json();
    return reply.ok ? res.status(reply.status).json(body) :
      res.status(reply.status).json({error:typeof body.detail === 'string' ? body.detail : 'Check the scan request and try again.'});
  }

  async function appointmentScopes(patient, doctor) {
    return (await pool.query(`SELECT COALESCE(a.facility_uuid::text,'') AS facility
      FROM appointments a JOIN users u ON u.id=a.doctor_id AND u.role='doctor' AND u.closed_at IS NULL
      WHERE a.mother_id=$1 AND a.doctor_id=$2 AND ${activeAppointments()}
      GROUP BY a.facility_uuid ORDER BY MAX(a.requested_date) DESC, facility LIMIT 100`, [patient,doctor])).rows.map(r=>r.facility);
  }

  async function context(patient) {
    const profile = (await pool.query(`SELECT pregnancy_status AS stage, lmp_date::text AS lmp,
      edd_date::text AS edd, pregnancy_confirmed_at::date::text AS confirmed
      FROM mother_profiles WHERE user_id=$1`,[patient])).rows[0];
    if (!profile) return {};
    // LMP is preferred as an episode anchor so changing the due date alone does not create a new episode.
    return {context:{stage:profile.stage, lmp:profile.lmp, edd:profile.edd},
      episode:profile.stage === 'pregnant' ? profile.lmp || profile.confirmed || profile.edd : null};
  }

  async function grantDoctor(req,res) {
    const patient = id(req.params.motherId);
    if (!patient) {res.status(400).json({error:'Choose a patient.'}); return null;}
    const doctor = req.user.id;
    const facilities = await verifyDoctor(pool, doctor) ? await appointmentScopes(patient, doctor) : [];
    await logAccess(pool, patient, doctor, 'ultrasound_workspace', facilities.length > 0);
    if (!facilities.length) {
      res.status(403).json({error:'A verified clinician and an active, authorized care-team relationship are required.'});
      return null;
    }
    const grant = {role:'doctor',actor:doctor,doctor,patient,facilities,facility:facilities[0]};
    if (env.DAI_DEMO === 'true' && env.DAI_LOCAL === 'true' &&
        !(await pool.query(`SELECT 1 FROM patient_access_controls
          WHERE mother_id=$1 AND grantee_type='facility' AND state='revoked' LIMIT 1`,[patient])).rows.length &&
        (await pool.query("SELECT to_regclass('public.dai_local_source_link') AS found")).rows[0]?.found) {
      const linked = (await pool.query(`SELECT entity,portal_uuid FROM dai_local_source_link
        WHERE (entity='mother' AND target_id=$1) OR (entity='doctor' AND target_id=$2)`,[patient,doctor])).rows;
      grant.portal_patient = linked.find(row=>row.entity === 'mother')?.portal_uuid;
      grant.portal_doctor = linked.find(row=>row.entity === 'doctor')?.portal_uuid;
    }
    return grant;
  }

  function offset(req) {
    const n = Number(req.query.offset || 0);
    return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : 0;
  }

  function parseImage(req, res, next) {
    if (!enabled) return res.status(503).json({error:'Ultrasound is disabled on this deployment.'});
    if ((req.get('sec-fetch-site') || '') === 'cross-site' || req.get('x-dai-ultrasound') !== 'upload') {
      return res.status(403).json({error:'Upload from the signed-in ultrasound workspace.'});
    }
    if (!FORMATS.includes(req.get('content-type'))) return res.status(415).json({error:'Choose a PNG, JPEG, or WebP image.'});
    rawImage(req,res,error => {
      if (error) return res.status(error.status === 413 ? 413 : 400).json({error:'The image is too large or could not be read.'});
      if (!req.body?.length) return res.status(400).json({error:'Choose an image.'});
      next();
    });
  }

  const mother = [authenticateToken,authorizeRole(['mother'])];
  const doctor = [authenticateToken,authorizeRole(['doctor'])];
  const patientPath = '/api/patient/ultrasound';
  const doctorPath = '/api/doctor/patients/:motherId/ultrasound';
  const patientGrant = req => ({role:'mother',actor:req.user.id,patient:req.user.id});

  app.get(patientPath, ...mother, guard(async (req,res) => {
    await forward(res,{...patientGrant(req),offset:offset(req)});
  }));
  app.get(patientPath+'/options', ...mother, guard(async (req,res) => {
    const patient = req.user.id;
    const candidates = (await pool.query(`SELECT DISTINCT a.doctor_id AS id, dp.full_name AS name
      FROM appointments a JOIN doctor_profiles dp ON dp.user_id=a.doctor_id
      JOIN users u ON u.id=a.doctor_id AND u.role='doctor' AND u.closed_at IS NULL
      WHERE a.mother_id=$1 AND ${activeAppointments()} ORDER BY dp.full_name, a.doctor_id`,[patient])).rows;
    const clinicians = [];
    for (const candidate of candidates) {
      if (await verifyDoctor(pool,candidate.id)) clinicians.push(candidate);
    }
    res.json({doctors:clinicians, can_upload:Boolean((await context(patient)).episode)});
  }));
  app.post(patientPath, ...mother, parseImage, guard(async (req,res) => {
    const grant = patientGrant(req);
    const selected = id(req.query.doctor);
    if (!selected || req.get('x-dai-ultrasound-consent') !== 'yes' || !await verifyDoctor(pool,selected)) {
      return res.status(422).json({error:'Choose a verified care-team doctor and confirm sharing.'});
    }
    const facilities = await appointmentScopes(grant.patient,selected);
    if (!facilities.length) return res.status(403).json({error:'This doctor no longer has care-team access.'});
    await forward(res,{...grant,...await context(grant.patient),doctor:selected, facilities,facility:facilities[0]},
      '', 'POST',req.body,req.get('content-type'));
  }));
  app.get(patientPath+'/:scanId/image', ...mother,guard(async (req,res) => {
    if (!SCAN_ID.test(req.params.scanId)) return res.status(404).json({error:'Scan not available.'});
    await forward(res, patientGrant(req), '/'+req.params.scanId+'/image');
  }));
  app.get('/api/doctor/ultrasound/patients', ...doctor, guard(async (req,res) => {
    if (!await verifyDoctor(pool,req.user.id)) return res.status(403).json({error:'A verified clinician account is required.'});
    const patients = (await pool.query(`SELECT DISTINCT a.mother_id AS id, mp.full_name AS name
      FROM appointments a JOIN mother_profiles mp ON mp.user_id=a.mother_id
      WHERE a.doctor_id=$1 AND ${activeAppointments()} ORDER BY mp.full_name, a.mother_id`,[req.user.id])).rows;
    res.json({patients});
  }));
  app.get(doctorPath,...doctor,guard(async (req,res) => {
    const grant = await grantDoctor(req,res);
    if (grant) await forward(res,{...grant,offset:offset(req)});
  }));
  app.post(doctorPath,...doctor,parseImage,guard(async (req,res) => {
    const grant = await grantDoctor(req,res);
    if (!grant) return;
    if (req.get('x-dai-ultrasound-consent') !== 'yes') {
      return res.status(422).json({error:'Confirm the patient agreed to share this image.'});
    }
    await forward(res,{...grant,...await context(grant.patient)},'', 'POST',req.body,req.get('content-type'));
  }));
  app.get(doctorPath+'/:scanId/image',...doctor,guard(async (req,res) => {
    if (!SCAN_ID.test(req.params.scanId)) return res.status(404).json({error:'Scan not available.'});
    const grant = await grantDoctor(req,res);
    if (grant) await forward(res,grant,'/'+req.params.scanId+'/image');
  }));
  app.post(doctorPath+'/:scanId/:action',...doctor,guard(async (req,res) => {
    if (!SCAN_ID.test(req.params.scanId) || !['start','review','release','retry'].includes(req.params.action)) {
      return res.status(404).json({error:'Action not available.'});
    }
    if ((req.get('sec-fetch-site') || '') === 'cross-site' || !req.is('application/json') ||
        req.get('x-dai-ultrasound') !== 'review') return res.status(403).json({error:'Use the signed-in review workspace.'});
    if (JSON.stringify(req.body || {}).length > 10000) return res.status(413).json({error:'Review text is too long.'});
    const grant = await grantDoctor(req,res);
    if (grant) await forward(res,grant,'/'+req.params.scanId+'/'+req.params.action,'POST',req.body);
  }));
};
