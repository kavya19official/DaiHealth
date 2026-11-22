'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function failure(status,message) { throw Object.assign(new Error(message),{status}); }
function requireId(value) {
  if (typeof value!=='string' || !UUID.test(value)) failure(400,'Invalid reference.');
  return value;
}
function endpoint(fn) {
  return async (req,res) => {
    res.set('Cache-Control','private, no-store');
    try { await fn(req,res); }
    catch (error) {
      if (!error.status) console.error('DaiCare operation failed',error.code || error.name);
      res.status(error.status || 500).json({ error:error.status?error.message:'DaiCare is temporarily unavailable.' });
    }
  };
}
async function inTransaction(pool, work) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { db.release(); }
}
async function logEvent(db,motherId,type,details) {
  await db.query(`INSERT INTO patient_access_events(mother_id,event_type,details,created_at)
    VALUES($1,$2,$3::jsonb || jsonb_build_object('transaction_id',txid_current()::text),clock_timestamp())`,
    [motherId,type,JSON.stringify(details)]);
}
async function activeDoctor(db,id) {
  const row = (await db.query(`SELECT d.* FROM daicare_directory d JOIN doctor_profiles dp ON dp.user_id=d.doctor_id
    JOIN users u ON u.id=d.doctor_id WHERE d.doctor_id=$1 AND d.suspended_at IS NULL
    AND u.role='doctor' AND u.closed_at IS NULL AND dp.credential_verified
    AND lower(dp.medical_license_number)=lower(d.registration_number)`,[id])).rows[0];
  if (!row) failure(403,'An active, verified DaiCare listing is required.');
  return row;
}
module.exports = { logEvent, requireId, failure, endpoint, inTransaction, activeDoctor };
