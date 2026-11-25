'use strict';

const { randomUUID } = require('node:crypto');
const { failure, requireId, endpoint, inTransaction, logEvent } = require('./daicareCommon');
const { registerSignaling } = require('./remoteSignaling');
const { verifiedDoctor } = require('./clinicalDashboard');
const { hasDoctorAccess, revokedSql, logAccess } = require('./accessControl');
const { resolveLocation, haversineKm } = require('./delhiGazetteer');

const ROOT = '/api/instant-consultations';
const CATEGORIES = ['pregnancy', 'medication', 'report', 'general', 'other'];
const OUTCOMES = ['follow_up', 'in_person', 'hospital', 'emergency', 'unable_to_connect'];
const OPEN = "('searching','offered','accepted','in_progress')";
const IN_CALL = ['accepted', 'in_progress'];
const PRESENCE_SECONDS = 90;
const NEARBY_RADIUS_KM = 25;

function setting(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function rankDoctors(rows, location, category, language) {
  const specialties = category === 'general' ? /obstet|gyn[ae]|family|general|internal medicine|primary care/i
    : /obstet|gyn[ae]|maternal|fetal|foetal|midwif|reproductive/i;
  const ranked = rows.map(row => {
    const hasPoint = row.latitude != null && row.longitude != null;
    const distance = location && hasPoint
      ? haversineKm(location.latitude, location.longitude, Number(row.latitude), Number(row.longitude)) : null;
    const languages = Array.isArray(row.languages) ? row.languages : [];
    return {
      ...row, distance,
      specialtyMatch: Number(specialties.test(row.specialization || '')),
      languageMatch: Number(languages.some(x => (language === 'hi' ? /^(hi|hindi|हिन्दी|हिंदी)$/i : language === 'mr' ? /^(mr|marathi|मराठी)$/i : /^(en|english)$/i).test(String(x).trim())))
    };
  }).filter(row => !location || row.distance !== null && row.distance <= NEARBY_RADIUS_KM);
  return ranked.sort((a, b) => b.specialtyMatch - a.specialtyMatch || b.languageMatch - a.languageMatch
    || Number(a.load) - Number(b.load) || (a.distance ?? 0) - (b.distance ?? 0)
    || a.doctor_id - b.doctor_id || a.facility_id - b.facility_id);
}

async function patientLocation(db, motherId) {
  const { rows: [location] } = await db.query(`SELECT p.latitude, p.longitude, p.city, p.pincode
    FROM patient_locations p WHERE p.user_id=$1 AND p.is_primary
    ORDER BY p.updated_at DESC, p.id DESC LIMIT 1`, [motherId]);
  if (!location) return null;
  if (location.latitude != null && location.longitude != null) {
    return { latitude: Number(location.latitude), longitude: Number(location.longitude) };
  }
  const resolved = resolveLocation(location);
  return resolved.ok ? resolved : null;
}

function textField(value, name, limit, required = true) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if ((required && !clean) || clean.length > limit || (value != null && typeof value !== 'string')) {
    failure(400, `Enter a valid ${name} (up to ${limit} characters).`);
  }
  return clean;
}

function followUpDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) failure(400, 'Enter a valid follow-up date.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value.startsWith('0000')) {
    failure(400, 'Enter a valid follow-up date.');
  }
  return value;
}

function register(app, { pool, authenticateToken, authorizeRole, env = process.env, startScheduler = true }) {
  const mother = [authenticateToken, authorizeRole(['mother'])];
  const doctor = [authenticateToken, authorizeRole(['doctor'])];
  const both = [authenticateToken, authorizeRole(['mother', 'doctor'])];
  const offerSeconds = setting(env.DAI_INSTANT_OFFER_SECONDS, 30, 5, 120);
  const searchSeconds = setting(env.DAI_INSTANT_SEARCH_SECONDS, 180, offerSeconds, 900);
  const maxVisitSeconds = setting(env.DAI_INSTANT_SESSION_SECONDS, 7200, 60, 28800);
  const capacity = setting(env.DAI_INSTANT_DOCTOR_CAPACITY, 1, 1, 5);

  // A PostgreSQL transaction lock serializes dispatch and capacity changes across server processes.
  // It does not cover read-only polling or the WebRTC media transport.
  const transition = work => inTransaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('dai_instant_consultation_dispatch'))");
    return work(db);
  });

  async function requireDoctor(db, id) {
    if (!await verifiedDoctor(db, id)) failure(403, 'A verified clinician account is required.');
  }

  const doctorAffiliations = `FROM doctor_facilities df
    JOIN facilities f ON f.id=df.facility_id AND f.active
    JOIN doctor_profiles dp ON dp.user_id=df.doctor_id
    JOIN users u ON u.id=dp.user_id AND u.role='doctor' AND u.closed_at IS NULL
    WHERE df.active AND df.qualification_verified AND df.accepts_new_patients`;
  const assignedAccess = `NOT ${revokedSql('ic.mother_id','ic.doctor_id','ic.facility_id')}`;
  const offerAccess = `NOT ${revokedSql('ic.mother_id','o.doctor_id','o.facility_id')}`;
  const candidateAccess = `NOT ${revokedSql('ic.mother_id','choices.doctor_id','choices.facility_id')}`;

  const doctorLoad = id => `(SELECT count(*) FROM instant_consultations c
    WHERE c.doctor_id=${id} AND c.status IN ('accepted','in_progress'))
    + (SELECT count(*) FROM instant_consultation_offers o
      WHERE o.doctor_id=${id} AND o.status='offered')`;

  async function candidates(db, visit) {
    const location = await patientLocation(db, visit.mother_id);
    const { rows } = await db.query(`SELECT choices.*,
        ${doctorLoad('choices.doctor_id')} AS load
      FROM (
        SELECT df.doctor_id, df.facility_id, COALESCE(df.specialization,dp.specialization) AS specialization,
          df.languages, f.latitude, f.longitude
        ${doctorAffiliations}
      ) choices
      JOIN instant_doctor_availability av ON av.doctor_id=choices.doctor_id
      JOIN instant_consultations ic ON ic.id=$1
      WHERE av.status='available' AND av.last_seen>clock_timestamp()-make_interval(secs=>$2)
        AND ${candidateAccess}
        AND NOT EXISTS(SELECT 1 FROM instant_consultation_offers o
          WHERE o.consultation_id=ic.id AND o.doctor_id=choices.doctor_id)`, [visit.id, PRESENCE_SECONDS]);
    const free = rows.filter(row => Number(row.load) < capacity);
    // Doctor Connect is audio-only, so when nobody is inside the nearby radius (or a clinic has no
    // coordinates recorded) we widen the search instead of leaving the patient with no doctor.
    const nearby = rankDoctors(free, location, visit.category, visit.language);
    return nearby.length || !location ? nearby : rankDoctors(free, null, visit.category, visit.language);
  }

  async function offerNext(db, visit) {
    for (const row of await candidates(db, visit)) {
      if (!await verifiedDoctor(db, row.doctor_id)) continue;
      await db.query(`INSERT INTO instant_consultation_offers(consultation_id,doctor_id,facility_id,status,expires_at)
        SELECT id,$2,$3,'offered',LEAST(search_until, clock_timestamp()+make_interval(secs=>$4))
        FROM instant_consultations WHERE id=$1`, [visit.id, row.doctor_id, row.facility_id, offerSeconds]);
      await db.query("UPDATE instant_consultations SET status='offered' WHERE id=$1", [visit.id]);
      break;
    }
  }

  async function dispatch(db) {
    await db.query(`UPDATE instant_consultation_offers o SET status=CASE
        WHEN o.expires_at<=clock_timestamp() THEN 'timed_out' ELSE 'withdrawn' END, responded_at=clock_timestamp()
      FROM instant_consultations ic WHERE ic.id=o.consultation_id AND o.status='offered'
      AND (o.expires_at<=clock_timestamp() OR NOT ${offerAccess}
        OR NOT EXISTS (SELECT 1 FROM instant_doctor_availability av
          WHERE av.doctor_id=o.doctor_id AND av.status='available'
          AND av.last_seen>clock_timestamp()-make_interval(secs=>$1)))`, [PRESENCE_SECONDS]);
    await db.query(`UPDATE instant_consultations ic SET status='searching' WHERE status='offered'
      AND NOT EXISTS (SELECT 1 FROM instant_consultation_offers o WHERE o.consultation_id=ic.id AND o.status='offered')`);
    await db.query(`UPDATE instant_consultations SET status='unavailable',ended_at=clock_timestamp()
      WHERE status='searching' AND search_until<=clock_timestamp()`);
    const expired = await db.query(`UPDATE instant_consultations ic SET status='expired',ended_at=clock_timestamp()
      WHERE status IN ('accepted','in_progress') AND
        (accepted_at<=clock_timestamp()-make_interval(secs=>$1)
          OR NOT ${assignedAccess}
          OR EXISTS (SELECT 1 FROM users d WHERE d.id=ic.doctor_id AND d.closed_at IS NOT NULL))
      RETURNING id`, [maxVisitSeconds]);
    for (const visit of expired.rows) clearSignals(visit.id);
    const queue = await db.query(`SELECT id,mother_id,category,language FROM instant_consultations ic
      WHERE status='searching' AND search_until>clock_timestamp()
        AND EXISTS (SELECT 1 FROM users m WHERE m.id=ic.mother_id AND m.closed_at IS NULL)
      ORDER BY created_at,id LIMIT 100`);
    for (const visit of queue.rows) await offerNext(db, visit);
  }

  async function room(req, db = pool) {
    const id = requireId(req.params.id);
    const { rows: [visit] } = await db.query(`SELECT id,mother_id,doctor_id,status FROM instant_consultations ic
      WHERE id=$1 AND (CASE WHEN $3='mother' THEN mother_id=$2 ELSE doctor_id=$2 END)
        AND accepted_at>clock_timestamp()-make_interval(secs=>$4)
        AND ${assignedAccess}
        AND EXISTS (SELECT 1 FROM users d WHERE d.id=ic.doctor_id AND d.closed_at IS NULL)`, [id, req.user.id, req.user.role, maxVisitSeconds]);
    if (!visit || !IN_CALL.includes(visit.status)) failure(404, 'This consultation is no longer open for calling.');
    if (req.user.role === 'doctor') await requireDoctor(db, req.user.id);
    return { ...visit, mode: 'audio' };
  }

  const clearSignals = registerSignaling(app, ROOT, both, room, env);

  function keepDispatching() {
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const pending = await pool.query(`SELECT 1 FROM instant_consultations WHERE status IN ${OPEN} LIMIT 1`);
        if (pending.rows.length) await transition(dispatch);
      } catch (error) {
        if (error.code !== '42P01') console.error('Instant consultation dispatch:', error.code || error.name);
      } finally { busy = false; }
    }, 2500);
    timer.unref();
    return () => clearInterval(timer);
  }

  app.post(ROOT, ...mother, endpoint(async (req, res) => {
    const body = req.body || {};
    const concern = textField(body.concern, 'concern', 1000);
    const category = body.category || 'other';
    if (!CATEGORIES.includes(category) || !['en','hi','mr'].includes(body.language) || body.consent !== true
        || (body.emergency_warning !== undefined && typeof body.emergency_warning !== 'boolean')) {
      failure(400, 'Choose a language and confirm sharing for this consultation.');
    }
    const id = await transition(async db => {
      const current = await db.query(`SELECT id FROM instant_consultations WHERE mother_id=$1 AND status IN ${OPEN}`, [req.user.id]);
      if (current.rows.length) return current.rows[0].id;
      const id = randomUUID();
      await db.query(`INSERT INTO instant_consultations(id,mother_id,concern,category,language,emergency_warning,search_until)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+make_interval(secs=>$7))`,
      [id, req.user.id, concern, category, body.language, body.emergency_warning === true, searchSeconds]);
      await logEvent(db, req.user.id, 'instant_consultation_requested', { consultation_id: id });
      await dispatch(db);
      return id;
    });
    res.status(202).json({ id });
  }));

  const details = `SELECT ic.id, ic.concern, ic.category, ic.language, ic.status, ic.emergency_warning,
      ic.created_at, ic.accepted_at, ic.started_at, ic.ended_at, ic.search_until, ic.doctor_id,
      dp.full_name AS doctor_name, COALESCE(df.specialization,dp.specialization) AS specialization,
      COALESCE(d.qualification,df.verification_details->>'qualification') AS qualification,
      df.role AS clinician_role, f.name AS facility_name,
      r.reason,r.observations,r.guidance,r.outcome,to_char(r.follow_up_on,'YYYY-MM-DD') AS follow_up_on,
      rf.name AS recommended_facility, rf.address AS recommended_address, rf.phone AS recommended_phone
    FROM instant_consultations ic
    LEFT JOIN doctor_profiles dp ON dp.user_id=ic.doctor_id
    LEFT JOIN doctor_facilities df ON df.doctor_id=ic.doctor_id AND df.facility_id=ic.facility_id
    LEFT JOIN facilities f ON f.id=ic.facility_id
    LEFT JOIN daicare_directory d ON d.doctor_id=ic.doctor_id AND d.suspended_at IS NULL
    LEFT JOIN instant_consultation_records r ON r.consultation_id=ic.id
    LEFT JOIN facilities rf ON rf.id=r.recommended_facility_id`;

  app.get(ROOT + '/mine', ...mother, endpoint(async (req, res) => {
    const { rows } = await pool.query(details + ` WHERE ic.mother_id=$1
      ORDER BY (ic.status IN ${OPEN}) DESC, ic.created_at DESC LIMIT 30`, [req.user.id]);
    const { rows: [presence] } = await pool.query(`SELECT
      count(DISTINCT df.doctor_id)::int AS online_doctors,
      (count(DISTINCT df.doctor_id) FILTER (WHERE av.status='available' AND
        ${doctorLoad('df.doctor_id')} < $2))::int AS available_doctors
      FROM (SELECT DISTINCT df.doctor_id ${doctorAffiliations}) df
      JOIN instant_doctor_availability av ON av.doctor_id=df.doctor_id
      WHERE av.status IN ('available','busy')
        AND av.last_seen>clock_timestamp()-make_interval(secs=>$1)`, [PRESENCE_SECONDS, capacity]);
    res.json({ items: rows, ...presence });
  }));

  app.post(ROOT + '/:id/cancel', ...mother, endpoint(async (req, res) => {
    const id = requireId(req.params.id);
    await transition(async db => {
      const result = await db.query(`UPDATE instant_consultations SET status='cancelled',ended_at=clock_timestamp()
        WHERE id=$1 AND mother_id=$2 AND status IN ${OPEN} RETURNING id`, [id, req.user.id]);
      if (!result.rows.length) failure(404, 'No open consultation to cancel.');
      await db.query(`UPDATE instant_consultation_offers SET status='withdrawn',responded_at=clock_timestamp()
        WHERE consultation_id=$1 AND status='offered'`, [id]);
      await logEvent(db, req.user.id, 'instant_consultation_cancelled', { consultation_id: id });
      await dispatch(db);
    });
    clearSignals(id);
    res.json({ cancelled: true });
  }));

  app.put(ROOT + '/availability', ...doctor, endpoint(async (req, res) => {
    const status = req.body?.status;
    if (!['available','busy','offline'].includes(status)) failure(400, 'Choose an availability status.');
    await transition(async db => {
      await requireDoctor(db, req.user.id);
      if (status === 'available' && !(await db.query(`SELECT 1 ${doctorAffiliations} AND df.doctor_id=$1 LIMIT 1`, [req.user.id])).rows.length) {
        failure(409, 'An active, verified Nearby Care affiliation accepting new patients is required.');
      }
      await db.query(`INSERT INTO instant_doctor_availability(doctor_id,status) VALUES($1,$2)
        ON CONFLICT(doctor_id) DO UPDATE SET status=excluded.status,last_seen=clock_timestamp()`, [req.user.id, status]);
      await dispatch(db);
    });
    res.json({ status });
  }));

  app.post(ROOT + '/presence', ...doctor, endpoint(async (req, res) => {
    await requireDoctor(pool, req.user.id);
    await pool.query(`UPDATE instant_doctor_availability SET last_seen=clock_timestamp()
      WHERE doctor_id=$1 AND status<>'offline'`, [req.user.id]);
    res.json({ updated: true });
  }));

  app.get(ROOT + '/inbox', ...doctor, endpoint(async (req, res) => {
    const id = req.user.id;
    await requireDoctor(pool, id);
    const { rows: [av] } = await pool.query('SELECT status FROM instant_doctor_availability WHERE doctor_id=$1', [id]);
    const { rows: offers } = await pool.query(`SELECT o.consultation_id AS id,o.expires_at,ic.category,
        ic.language,ic.emergency_warning,ic.created_at,f.name AS facility_name
      FROM instant_consultation_offers o JOIN instant_consultations ic ON ic.id=o.consultation_id
      JOIN facilities f ON f.id=o.facility_id
      WHERE o.doctor_id=$1 AND o.status='offered' AND ic.status='offered' AND o.expires_at>clock_timestamp()
        AND ${offerAccess}
      ORDER BY o.offered_at`, [id]);
    const { rows: visits } = await pool.query(details + ` WHERE ic.doctor_id=$1
      AND ic.status IN ('accepted','in_progress','completed')
      AND ${assignedAccess}
      ORDER BY (ic.status IN ('accepted','in_progress')) DESC, ic.created_at DESC LIMIT 25`, [id]);
    const active = visits.filter(v => IN_CALL.includes(v.status)).length;
    res.json({ status: av?.status || 'offline', effective_status: active && av?.status !== 'offline' ? 'busy' : av?.status || 'offline',
      capacity, offers, visits });
  }));

  app.post(ROOT + '/:id/respond', ...doctor, endpoint(async (req, res) => {
    const id = requireId(req.params.id);
    const action = req.body?.action;
    if (!['accept','decline'].includes(action)) failure(400, 'Choose accept or decline.');
    await transition(async db => {
      await requireDoctor(db, req.user.id);
      const { rows: [offer] } = await db.query(`SELECT o.facility_id,ic.mother_id
        FROM instant_consultation_offers o JOIN instant_consultations ic ON ic.id=o.consultation_id
        JOIN instant_doctor_availability av ON av.doctor_id=o.doctor_id
        WHERE o.consultation_id=$1 AND o.doctor_id=$2 AND o.status='offered' AND ic.status='offered'
        AND av.status='available' AND av.last_seen>clock_timestamp()-make_interval(secs=>$3)
        AND o.expires_at>clock_timestamp() AND ${offerAccess}`,
      [id, req.user.id, PRESENCE_SECONDS]);
      if (!offer) failure(409, 'This offer has expired or is no longer assigned to you.');
      if (action === 'accept' && !(await db.query(`SELECT 1 ${doctorAffiliations} AND df.doctor_id=$1 AND df.facility_id=$2`,
        [req.user.id, offer.facility_id])).rows.length) failure(409, 'This Nearby Care affiliation is no longer eligible.');
      await db.query(`UPDATE instant_consultation_offers SET status=$3,responded_at=clock_timestamp()
        WHERE consultation_id=$1 AND doctor_id=$2`, [id, req.user.id, action === 'accept' ? 'accepted' : 'declined']);
      if (action === 'accept') {
        await db.query(`UPDATE instant_consultations SET status='accepted',doctor_id=$2,facility_id=$3,accepted_at=clock_timestamp()
          WHERE id=$1`, [id, req.user.id, offer.facility_id]);
        await logEvent(db, offer.mother_id, 'instant_consultation_accepted', { consultation_id: id, doctor_id: req.user.id });
      } else {
        await db.query("UPDATE instant_consultations SET status='searching' WHERE id=$1", [id]);
        await dispatch(db);
      }
    });
    res.json({ status: action === 'accept' ? 'accepted' : 'declined' });
  }));

  app.get(ROOT + '/:id/context', ...doctor, endpoint(async (req, res) => {
    const visit = await room(req);
    const allowed = await hasDoctorAccess(pool, req.user.id, visit.mother_id);
    const { rows: [profile] } = await pool.query(`SELECT full_name, pregnancy_status,
      CASE WHEN pregnancy_confirmed_at IS NOT NULL AND pregnancy_status='pregnant'
        AND care_start_date::date BETWEEN (CURRENT_DATE-315) AND CURRENT_DATE
        THEN (CURRENT_DATE-care_start_date::date)/7 END AS gestational_week
      FROM mother_profiles WHERE user_id=$1`, [visit.mother_id]);
    if (allowed) await logAccess(pool, visit.mother_id, req.user.id, 'instant_consultation_context', true);
    res.json({ patient_id: visit.mother_id, patient_name: profile?.full_name || 'Patient',
      existing_record_access: allowed, pregnancy_status: allowed ? profile?.pregnancy_status : null,
      gestational_week: allowed ? profile?.gestational_week : null });
  }));

  async function referralFacilities(db, visit) {
    const location = await patientLocation(db, visit.mother_id);
    const { rows } = await db.query(`SELECT f.id,f.name,f.address,f.phone,f.latitude,f.longitude,
      f.id=ic.facility_id AS assigned FROM facilities f CROSS JOIN instant_consultations ic
      WHERE f.active AND ic.id=$1`, [visit.id]);
    const facilities = rows.map(f => ({ id:f.id, name:f.name, address:f.address, phone:f.phone, assigned:f.assigned,
      distance:location && f.latitude != null && f.longitude != null
        ? haversineKm(location.latitude, location.longitude, Number(f.latitude), Number(f.longitude)) : null }))
      .filter(f => f.assigned || f.distance !== null && f.distance <= NEARBY_RADIUS_KM)
      .sort((a,b) => Number(b.assigned)-Number(a.assigned) || a.distance-b.distance || a.id-b.id);
    return facilities.slice(0, 12);
  }

  app.get(ROOT + '/:id/facilities', ...doctor, endpoint(async (req, res) => {
    const visit = await room(req);
    res.json({ facilities: await referralFacilities(pool, visit) });
  }));

  app.post(ROOT + '/:id/connected', ...both, endpoint(async (req, res) => {
    const id = await transition(async db => {
      const visit = await room(req, db);
      const column = req.user.role === 'mother' ? 'patient_connected_at' : 'doctor_connected_at';
      await db.query(`UPDATE instant_consultations SET ${column}=COALESCE(${column},clock_timestamp()) WHERE id=$1`, [visit.id]);
      await db.query(`UPDATE instant_consultations SET status='in_progress',started_at=clock_timestamp()
        WHERE id=$1 AND status='accepted' AND patient_connected_at IS NOT NULL AND doctor_connected_at IS NOT NULL`, [visit.id]);
      return visit.id;
    });
    res.json({ id });
  }));

  app.post(ROOT + '/:id/complete', ...doctor, endpoint(async (req, res) => {
    const body = req.body || {};
    const reason = textField(body.reason, 'reason', 1000);
    const observations = textField(body.observations, 'observations', 4000, false);
    const guidance = textField(body.guidance, 'guidance', 4000);
    const followUp = followUpDate(body.follow_up_on);
    const facility = body.facility_id ?? null;
    if (!OUTCOMES.includes(body.outcome) || (facility !== null && (!Number.isInteger(facility) || facility < 1))) {
      failure(400, 'Choose a consultation outcome and a valid facility if applicable.');
    }
    const id = await transition(async db => {
      const visit = await room(req, db);
      if (visit.status !== 'in_progress' && body.outcome !== 'unable_to_connect') {
        failure(409, 'Complete a connected call or choose “Unable to connect”.');
      }
      if (facility !== null && !(await referralFacilities(db, visit)).some(option => option.id === facility)) {
        failure(400, 'Choose a facility listed for this consultation.');
      }
      await db.query(`INSERT INTO instant_consultation_records(consultation_id,doctor_id,reason,observations,guidance,outcome,follow_up_on,recommended_facility_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [visit.id, req.user.id, reason, observations, guidance, body.outcome, followUp, facility]);
      await db.query("UPDATE instant_consultations SET status='completed',ended_at=clock_timestamp() WHERE id=$1", [visit.id]);
      await logEvent(db, visit.mother_id, 'instant_consultation_completed', { consultation_id: visit.id, doctor_id: req.user.id });
      await dispatch(db);
      return visit.id;
    });
    clearSignals(id);
    res.json({ completed: true });
  }));

  return startScheduler ? keepDispatching() : () => {};
}

module.exports = Object.assign(register, { rankDoctors });
