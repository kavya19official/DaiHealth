'use strict';

const { readFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { Pool } = require('../backend/node_modules/pg');
const { inTransaction, activeDoctor } = require('../backend/daicareCommon');

const text = (value,max=160) => typeof value==='string' && value.trim().length>0 && value.length<=max && !/[\u0000-\u001f]/.test(value);
const list = (values,valid,max=100) => Array.isArray(values) && values.length<=max && values.every(valid) && new Set(values).size===values.length;

async function approve(pool,id,file) {
  const p = JSON.parse(await readFile(file,'utf8'));
  if (![p.council,p.qualification,p.city,p.state,p.public_contact,p.registration_number].every(value=>text(value)) ||
    !text(p.verification_ref,300) || typeof p.mental_health!=='boolean' ||
    !list(p.languages,value=>text(value,40),20) || !list(p.pincodes,value=>/^[1-9]\d{5}$/.test(value)) ||
    !list(p.modes,value=>['audio','video','home'].includes(value),3) || !p.modes.length ||
    (p.modes.includes('home') && !p.pincodes.length)) throw Error('Directory listing has missing or invalid fields.');
  await inTransaction(pool,async db=>{
    const q=await db.query(`SELECT dp.medical_license_number FROM doctor_profiles dp JOIN users u ON u.id=dp.user_id
      WHERE u.id=$1 AND u.role='doctor' AND u.closed_at IS NULL FOR UPDATE OF dp`,[id]);
    if (!q.rows.length || q.rows[0].medical_license_number.toLowerCase()!==p.registration_number.trim().toLowerCase()) {
      throw Error('Registration number must match the clinician’s existing credential.');
    }
    await db.query(`INSERT INTO daicare_directory(doctor_id,council,registration_number,qualification,city,state,public_contact,
      languages,pincodes,modes,mental_health,verification_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
      ON CONFLICT(doctor_id) DO UPDATE SET council=EXCLUDED.council,registration_number=EXCLUDED.registration_number,
      qualification=EXCLUDED.qualification,city=EXCLUDED.city,state=EXCLUDED.state,public_contact=EXCLUDED.public_contact,
      languages=EXCLUDED.languages,pincodes=EXCLUDED.pincodes,modes=EXCLUDED.modes,mental_health=EXCLUDED.mental_health,
      verification_ref=EXCLUDED.verification_ref,suspended_at=NULL,verified_at=clock_timestamp()`,
    [id,p.council.trim(),p.registration_number.trim(),p.qualification.trim(),p.city.trim(),p.state.trim(),
      p.public_contact.trim(),JSON.stringify(p.languages),JSON.stringify(p.pincodes),JSON.stringify(p.modes),p.mental_health,p.verification_ref.trim()]);
    await db.query('UPDATE doctor_profiles SET credential_verified=TRUE WHERE user_id=$1',[id]);
  });
}

async function run() {
  const [command,doctor,value,end] = process.argv.slice(2);
  const id=Number(doctor);
  if (!Number.isInteger(id) || id<1 || id>2147483647 || !['approve','suspend','shift'].includes(command)) {
    throw Error('Usage: node scripts/daicare-directory.cjs approve DOCTOR_ID profile.json | suspend DOCTOR_ID | shift DOCTOR_ID START_ISO END_ISO');
  }
  let db;
  if (process.env.DAICARE_MAINTENANCE_DB_DIR) {
    db=require('../backend/localPool').createLocalPool(path.resolve(process.env.DAICARE_MAINTENANCE_DB_DIR));
  } else {
    if (!process.env.DATABASE_URL) throw Error('Set the operator’s DATABASE_URL to the target database.');
    db=new Pool({connectionString:process.env.DATABASE_URL});
  }
  try {
    if (command==='approve') await approve(db,id,value);
    if (command==='suspend' && !(await db.query('UPDATE daicare_directory SET suspended_at=clock_timestamp() WHERE doctor_id=$1',[id])).rowCount) {
      throw Error('Listing not found.');
    }
    if (command==='shift') {
      const start=new Date(value), finish=new Date(end);
      if (![value,end].every(s=>typeof s==='string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(s)) ||
          !Number.isFinite(+start) || !Number.isFinite(+finish) || finish<=start || +finish-+start>24*3600000 || +finish<=Date.now()) {
        throw Error('Provide timezone-qualified start/end for a current or future shift up to 24 hours.');
      }
      await inTransaction(db,async conn=>{
        await conn.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[id]);
        if (!(await activeDoctor(conn,id)).mental_health) throw Error('Mental health approval is required.');
        if ((await conn.query('SELECT 1 FROM daicare_on_call WHERE doctor_id=$1 AND starts_at<$3 AND ends_at>$2',[id,start,finish])).rowCount) {
          throw Error('Shift overlaps a rostered shift.');
        }
        await conn.query('INSERT INTO daicare_on_call(id,doctor_id,starts_at,ends_at) VALUES($1,$2,$3,$4)',[randomUUID(),id,start,finish]);
      });
    }
    console.log('DaiCare directory operation complete.');
  } finally { await db.end(); }
}
if (require.main===module) run().catch(error=>{console.error(error.code ? 'DaiCare directory operation failed ('+error.code+').' : error.message);process.exitCode=1;});
module.exports={approve};
