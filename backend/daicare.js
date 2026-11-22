'use strict';

const { randomUUID } = require('node:crypto');
const access = require('./accessControl');
const { registerSignaling } = require('./remoteSignaling');
const { logEvent, requireId, failure, endpoint, inTransaction, activeDoctor } = require('./daicareCommon');

const modes = ['home', 'audio', 'video'];
const PIN = /^[1-9]\d{5}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const visitPath = '/api/daicare/visits';
const networkPath = '/api/daicare';
const openDoctor = `JOIN doctor_profiles dp ON dp.user_id = d.doctor_id
 JOIN users du ON du.id=d.doctor_id AND du.role='doctor' AND du.closed_at IS NULL`;
const credential = 'd.suspended_at IS NULL AND dp.credential_verified AND lower(dp.medical_license_number)=lower(d.registration_number)';
const booked = "NOT EXISTS (SELECT 1 FROM daicare_visits taken WHERE taken.slot_id=s.id AND taken.status<>'cancelled')";
const fields = `d.doctor_id,dp.full_name,dp.specialization,d.city,d.state,d.qualification,d.council,d.registration_number,
 d.public_contact,d.languages,d.modes,d.mental_health,d.verified_at`;
const visitFields = `v.id,v.status,v.follow_up_on,v.follow_up,v.follow_up_seen_at,v.revoked_at,v.patient_consent_at,
 s.starts_at,s.mode,s.doctor_id,v.mother_id,dp.full_name AS doctor_name`;

function parseSlot(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:(00|30):00\.000Z$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(+date) || date.toISOString() !== value) return null;
  return date;
}

const legacyOverlap = (doctor,start) => `SELECT 1 FROM appointments a
  WHERE a.doctor_id=${doctor} AND a.status<>'cancelled' AND a.requested_time IS NOT NULL
    AND (a.requested_date+a.requested_time) AT TIME ZONE 'Asia/Kolkata' < ${start}+interval '30 minutes'
    AND (a.requested_date+COALESCE(a.slot_end,a.requested_time+interval '30 minutes')) AT TIME ZONE 'Asia/Kolkata' > ${start}
  LIMIT 1`;
const openSlot = `${booked} AND NOT EXISTS (${legacyOverlap('s.doctor_id','s.starts_at')})`;

async function legacyConflict(db, doctor, start) {
  return (await db.query(legacyOverlap('$1','$2::timestamptz'),[doctor,start])).rowCount>0;
}

module.exports = function daicare(app, dependencies) {
  const { pool, authenticateToken, authorizeRole, env=process.env } = dependencies;
  const mother = [authenticateToken, authorizeRole(['mother'])];
  const doctor = [authenticateToken, authorizeRole(['doctor'])];
  const participants = [authenticateToken, authorizeRole(['mother','doctor'])];

  require('./daicareWellbeing')(app, { ...dependencies, mother, doctor });

  app.get(networkPath + '/directory', ...mother, endpoint(async (req, res) => {
    const mode = req.query.mode || 'video';
    const pin = req.query.pin || '';
    const search = req.query.q || '';
    const city = req.query.city || '';
    const state = req.query.state || '';
    if (!modes.includes(mode) || typeof pin !== 'string' || (pin && !PIN.test(pin)) ||
      (mode === 'home' && !PIN.test(pin)) || [search,city,state].some(value => typeof value !== 'string' || value.length > 80)) {
      failure(400, 'Choose a consultation type. For home visits, enter a six-digit PIN code.');
    }
    const { rows } = await pool.query(`SELECT ${fields}, next_slot.starts_at AS next_available
      FROM daicare_directory d ${openDoctor}
      LEFT JOIN LATERAL (SELECT s.starts_at FROM daicare_slots s WHERE s.doctor_id=d.doctor_id AND s.mode=$1
        AND s.starts_at>clock_timestamp() AND ${openSlot} ORDER BY s.starts_at LIMIT 1) next_slot ON TRUE
      WHERE ${credential} AND d.modes ? $1 AND ($1 <> 'home' OR d.pincodes ? $2)
        AND ($3='' OR strpos(lower(dp.specialization || ' ' || dp.full_name),lower($3))>0)
        AND ($4='' OR lower(d.city)=lower($4)) AND ($5='' OR lower(d.state)=lower($5))
      ORDER BY (d.pincodes ? $2) DESC,next_slot.starts_at NULLS LAST,dp.full_name,d.doctor_id LIMIT 40`,
      [mode, pin, search.trim(),city.trim(),state.trim()]);
    res.json({ doctors: rows });
  }));

  app.get(networkPath + '/doctors/:id/slots', ...mother, endpoint(async (req, res) => {
    const id = Number(req.params.id);
    const { mode, pin = '' } = req.query;
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || !modes.includes(mode) ||
      (typeof pin!=='string' || (mode === 'home' && !PIN.test(pin)))) failure(400, 'Choose a clinician, consultation type and any required PIN code.');
    const { rows } = await pool.query(`SELECT s.id,s.starts_at,s.mode FROM daicare_slots s JOIN daicare_directory d USING(doctor_id)
      ${openDoctor} WHERE s.doctor_id=$1 AND s.mode=$2 AND d.modes ? $2 AND ($2<>'home' OR d.pincodes ? $3)
      AND ${credential} AND s.starts_at>clock_timestamp() AND ${openSlot} ORDER BY s.starts_at LIMIT 60`, [id,mode,String(pin)]);
    res.json({ slots: rows });
  }));

  app.get(networkPath + '/schedule', ...doctor, endpoint(async (req, res) => {
    const profile = await activeDoctor(pool, req.user.id);
    const { rows } = await pool.query(`SELECT s.id,s.starts_at,s.mode,NOT (${booked}) AS booked FROM daicare_slots s
      WHERE s.doctor_id=$1 AND s.starts_at>clock_timestamp() ORDER BY s.starts_at LIMIT 150`, [req.user.id]);
    res.json({ modes: profile.modes, slots: rows });
  }));

  app.post(networkPath + '/schedule', ...doctor, endpoint(async (req, res) => {
    const { starts_at, mode } = req.body || {};
    const start = parseSlot(starts_at);
    if (!start || +start <= Date.now() || +start > Date.now() + 90*86400000 || !modes.includes(mode)) {
      failure(400, 'Choose a future 30-minute start within the next 90 days.');
    }
    const slot = await inTransaction(pool, async db => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
      const profile = await activeDoctor(db, req.user.id);
      if (!profile.modes.includes(mode)) failure(400, 'This consultation type is unavailable for your verified listing.');
      if (await legacyConflict(db, req.user.id, start)) failure(409, 'That time overlaps an existing appointment.');
      const { rows } = await db.query(`INSERT INTO daicare_slots(id,doctor_id,starts_at,mode)
         VALUES($1,$2,$3,$4) ON CONFLICT(doctor_id,starts_at) DO NOTHING RETURNING id,starts_at,mode`,
      [randomUUID(),req.user.id,start,mode]);
      if (!rows.length) failure(409, 'That time already has a DaiCare slot.');
      return rows[0];
    });
    res.status(201).json({ slot });
  }));

  app.delete(networkPath + '/schedule/:id', ...doctor, endpoint(async (req, res) => {
    const id = requireId(req.params.id);
    await activeDoctor(pool, req.user.id);
    const removed = await inTransaction(pool, async db => {
      await db.query('SELECT id FROM daicare_slots WHERE id=$1 AND doctor_id=$2 FOR UPDATE',[id,req.user.id]);
      const exists = await db.query('SELECT 1 FROM daicare_visits WHERE slot_id=$1',[id]);
      if (exists.rowCount) failure(409, 'This slot has booking history and cannot be removed.');
      return (await db.query('DELETE FROM daicare_slots WHERE id=$1 AND doctor_id=$2 RETURNING id',[id,req.user.id])).rowCount;
    });
    if (!removed) failure(404, 'Slot not found.');
    res.status(204).end();
  }));

  app.post(visitPath, ...mother, endpoint(async (req,res) => {
    const body = req.body || {};
    const slotId = requireId(body.slot_id);
    if (body.consent !== true) failure(400, 'Confirm sharing the booking details with the selected clinician.');
    const visit = await inTransaction(pool, async db => {
      const assignment = (await db.query('SELECT doctor_id FROM daicare_slots WHERE id=$1',[slotId])).rows[0];
      if (!assignment) failure(404, 'Slot not found.');
      // Use the same clinician lock as the legacy appointment creator.
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [assignment.doctor_id]);
      const slot = (await db.query(`SELECT s.* FROM daicare_slots s WHERE s.id=$1 AND s.starts_at>clock_timestamp()
        AND ${booked} FOR UPDATE`, [slotId])).rows[0];
      if (!slot || await legacyConflict(db, assignment.doctor_id, slot.starts_at)) failure(409, 'That time is no longer available.');
      const profile = await activeDoctor(db, slot.doctor_id);
      if (!profile.modes.includes(slot.mode)) failure(409, 'This consultation type is no longer available.');
      if ((await db.query(`SELECT 1 WHERE ${access.revokedSql('$1::int','$2::int')}`, [req.user.id,slot.doctor_id])).rowCount) {
        failure(403, 'Update your access preferences before contacting this clinician.');
      }
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      if ((await db.query(`SELECT 1 FROM daicare_visits v JOIN daicare_slots s ON s.id=v.slot_id
        WHERE v.mother_id=$1 AND v.status IN ('requested','confirmed') AND s.starts_at=$2 LIMIT 1`,
        [req.user.id,slot.starts_at])).rowCount) failure(409,'You already have a DaiCare request at that time.');
      const { pin, address } = body;
      if (slot.mode==='home' && (typeof pin!=='string' || !PIN.test(pin) || !profile.pincodes.includes(pin) ||
        typeof address!=='string' || address.trim().length<8 || address.length>300)) failure(400, 'Enter an address in the verified home-visit PIN code.');
      const { rows } = await db.query(`INSERT INTO daicare_visits(id,slot_id,mother_id,pincode,address)
        VALUES($1,$2,$3,$4,$5) RETURNING id,status`, [randomUUID(),slot.id,req.user.id,slot.mode==='home'?pin:null,slot.mode==='home'?address.trim():null]);
      await logEvent(db,req.user.id,'daicare_booking_consent',{ visit_id:rows[0].id,doctor_id:slot.doctor_id,actor_id:req.user.id });
      return rows[0];
    });
    res.status(201).json({ visit });
  }));

  async function visit(db, req, lock = false) {
    const id = requireId(req.params.id);
    const isMother = req.user.role==='mother';
    const row = (await db.query(`SELECT ${visitFields},v.pincode,v.address,mp.full_name AS patient_name,
        s.starts_at <= clock_timestamp() AS started, s.starts_at < clock_timestamp()+interval '10 minutes'
          AND s.starts_at > clock_timestamp()-interval '75 minutes' AS on_time
      FROM daicare_visits v JOIN daicare_slots s ON s.id=v.slot_id
      JOIN doctor_profiles dp ON dp.user_id=s.doctor_id JOIN mother_profiles mp ON mp.user_id=v.mother_id
      WHERE v.id=$1 AND ${isMother?'v.mother_id':'s.doctor_id'}=$2 ${lock?'FOR UPDATE OF v':''}`, [id,req.user.id])).rows[0];
    if (!row) failure(404, 'Visit not found.');
    if (!isMother) await activeDoctor(db,req.user.id);
    row.access_blocked = Boolean((await db.query(`SELECT 1 WHERE ${access.revokedSql('$1::int','$2::int')}`,
      [row.mother_id,row.doctor_id])).rowCount);
    if (!isMother && (row.revoked_at || row.access_blocked || row.status==='cancelled')) failure(404, 'Visit no longer shared.');
    return row;
  }

  app.get(visitPath, ...participants, endpoint(async (req, res) => {
    const isMother = req.user.role==='mother';
    if (!isMother) await activeDoctor(pool,req.user.id);
    const { rows } = await pool.query(`SELECT ${visitFields}, ${isMother?'NULL':'mp.full_name'} AS patient_name,
        CASE WHEN v.status='confirmed' AND v.revoked_at IS NULL THEN v.address END AS address,
        CASE WHEN v.revoked_at IS NULL THEN v.pincode END AS pincode
      FROM daicare_visits v JOIN daicare_slots s ON s.id=v.slot_id JOIN doctor_profiles dp ON dp.user_id=s.doctor_id
      JOIN mother_profiles mp ON mp.user_id=v.mother_id
      WHERE ${isMother?'v.mother_id':'s.doctor_id'}=$1
       ${isMother?'':`AND v.revoked_at IS NULL AND v.status<>'cancelled' AND NOT ${access.revokedSql('v.mother_id','s.doctor_id')}`}
      ORDER BY s.starts_at DESC LIMIT 80`, [req.user.id]);
    if (!isMother) for (const row of rows) await access.logAccess(pool,row.mother_id,req.user.id,'daicare_visit',true);
    res.json({ visits: rows });
  }));

  app.get(visitPath + '/:id', ...participants, endpoint(async (req,res) => {
    const row = await visit(pool,req);
    if (req.user.role==='doctor') await access.logAccess(pool,row.mother_id,req.user.id,'daicare_visit',true);
    res.json({ visit:{id:row.id,status:row.status,mode:row.mode,starts_at:row.starts_at,consent_at:row.patient_consent_at,
      revoked_at:row.access_blocked ? row.revoked_at || true : row.revoked_at},
      notice:'Calls open ten minutes before the scheduled time. Audio or video requires browser permission. DaiHealth does not record calls.' });
  }));

  app.patch(visitPath + '/:id', ...participants, endpoint(async (req,res) => {
    const b = req.body || {};
    const result = await inTransaction(pool, async db => {
      const row = await visit(db,req,true);
      if (req.user.role==='mother') {
        if (b.action==='acknowledge_follow_up' && row.follow_up_on && !row.revoked_at) {
          await db.query('UPDATE daicare_visits SET follow_up_seen_at=COALESCE(follow_up_seen_at,clock_timestamp()) WHERE id=$1',[row.id]);
          return {status:row.status};
        }
        if (b.action!=='cancel' || row.revoked_at) failure(409,'This consent cannot be withdrawn again.');
        await db.query(`UPDATE daicare_visits SET status=CASE WHEN status='completed' THEN status ELSE 'cancelled' END,
          revoked_at=clock_timestamp() WHERE id=$1`, [row.id]);
        await logEvent(db,row.mother_id,'daicare_booking_revoked',{visit_id:row.id,doctor_id:row.doctor_id,actor_id:req.user.id});
        return { status: row.status==='completed'?'completed':'cancelled' };
      }
      const next = { confirm:'confirmed', decline:'cancelled', complete:'completed', follow_up:'completed' }[b.action];
      if (!(b.action==='confirm' && row.status==='requested' && !row.started ||
        b.action==='decline' && ['requested','confirmed'].includes(row.status) ||
        b.action==='complete' && row.status==='confirmed' && row.started ||
        b.action==='follow_up' && row.status==='completed')) failure(409,'That action is unavailable for this visit.');
      const hasFollow = b.follow_up != null || b.follow_up_on != null;
      if (hasFollow && (next!=='completed' || !validFollowUp(b.follow_up_on,b.follow_up))) {
        failure(400,'Enter a current or future follow-up date and a note up to 800 characters.');
      }
      await db.query(`UPDATE daicare_visits SET status=$2,follow_up_on=COALESCE($3,follow_up_on),
        follow_up=COALESCE($4,follow_up),follow_up_seen_at=CASE WHEN $4::text IS NULL THEN follow_up_seen_at ELSE NULL END WHERE id=$1`, [row.id,next,b.follow_up_on||null,b.follow_up?.trim()||null]);
      await logEvent(db,row.mother_id,'daicare_visit_status',{visit_id:row.id,doctor_id:row.doctor_id,actor_id:req.user.id,status:next});
      return { status: next };
    });
    if (result.status!=='confirmed') clearSignals(req.params.id);
    res.json(result);
  }));

  const clearSignals = registerSignaling(app, visitPath, participants, async req => {
    const row = await visit(pool,req);
    if (row.status!=='confirmed' || row.revoked_at || row.access_blocked || row.mode==='home' || !row.on_time) {
      failure(409,'Calling requires a confirmed remote visit, active consent, and the scheduled call window.');
    }
    return row;
  },env);
};

function validFollowUp(date, note) {
  if (typeof date!=='string' || !DATE.test(date) || typeof note!=='string' || !note.trim() || note.length>800) return false;
  const when = new Date(date);
  return Number.isFinite(+when) && when.toISOString().slice(0,10)===date &&
    date>=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
}
