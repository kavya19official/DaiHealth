'use strict';
// Explicit local-only profile edit. Never run automatically on startup.
const fs = require('node:fs'), path = require('node:path');
const F = require('./fixtures/nivara-profile.cjs');

async function seedNivaraProfile(db, portal, {local = false, backupDir} = {}) {
  if (!local) throw Error('Nivara profile edits are restricted to the local fictional demo.');
  const found = (await db.query(`SELECT u.id,u.email,mp.*,l.portal_uuid FROM users u
    JOIN mother_profiles mp ON mp.user_id=u.id
    JOIN dai_local_source_link l ON l.entity='mother' AND l.target_id=u.id
    WHERE l.source_id=$1 AND u.role='mother' AND u.email IN ('mother@dai-synthetic.invalid',$2)`, [F.sourceId,F.email])).rows;
  if (found.length !== 1) throw Error('Expected exactly one linked fictional Nivara account.');
  const old = found[0], mother = portal.prepare('SELECT * FROM mother WHERE id=?').get(old.portal_uuid);
  if (!mother || mother.source_id !== F.sourceId) throw Error('Fictional portal identity does not match.');
  const doctor = (await db.query(`SELECT dp.user_id,dp.full_name FROM doctor_profiles dp
    JOIN dai_local_source_link l ON l.entity='doctor' AND l.target_id=dp.user_id
    WHERE l.portal_uuid=$1 AND dp.full_name LIKE '%Hemangini Batra%'`, [mother.assigned_doctor_id])).rows[0];
  if (!doctor) throw Error('Nivara must already be assigned to Hemangini.');
  const context = (await db.query('SELECT * FROM pregnancy_care_context WHERE mother_id=$1',[old.id])).rows;
  const previousPost = (await db.query('SELECT * FROM postpartum_profile WHERE mother_id=$1',[old.id])).rows;
  const previousMilestones = (await db.query("SELECT * FROM care_milestones WHERE mother_id=$1 AND stage='Delivery'",[old.id])).rows;
  if (backupDir) {
    fs.mkdirSync(backupDir,{recursive:true});
    fs.writeFileSync(path.join(backupDir,'nivara-profile-'+Date.now()+'.json'),JSON.stringify({profile:old,mother,context,previousPost,previousMilestones},null,2),{mode:0o600});
  }
  const record = {...F.context, dating_note:F.dating, prior_outcomes:F.history, plan_note:'Fictional profile only. Individual care plan has not been activated.', pathway_version:require('../shared/pregnancy-journey').VERSION};
  await db.query('BEGIN'); portal.exec('BEGIN IMMEDIATE');
  try {
    await db.query(`UPDATE mother_profiles SET full_name=$2,pregnancy_status='pregnant',lmp_date=$3::date,
      edd_date=$4::date,care_start_date=$3::date,blood_group='B+',gravida=2,parity=1,
      previous_complications=$5,medical_conditions=$6,allergies='No known drug allergy recorded.' WHERE user_id=$1`,
      [old.id,F.name,F.lmp,F.edd,F.history,F.concerns]);
    await db.query('UPDATE users SET email=$2 WHERE id=$1',[old.id,F.email]);
    await db.query(`INSERT INTO pregnancy_care_context(mother_id,record,updated_by) VALUES($1,$2::jsonb,$3)
      ON CONFLICT(mother_id) DO UPDATE SET record=EXCLUDED.record,updated_by=EXCLUDED.updated_by,
      version=pregnancy_care_context.version+1,updated_at=NOW()`,[old.id,JSON.stringify(record),doctor.user_id]);
    // Retain earlier birth as history; it must not turn this pregnancy into postpartum.
    await db.query("UPDATE postpartum_profile SET delivery_date=$2,delivery_type='caesarean' WHERE mother_id=$1",[old.id,F.previousBirth]);
    await db.query("UPDATE care_milestones SET completed_at=$2::date WHERE mother_id=$1 AND stage='Delivery' AND completed_at IS NOT NULL",[old.id,F.previousBirth]);
    const details = {...JSON.parse(mother.details||'{}'),name:F.name,stage:'Trimester 3',demo_profile_id:F.recordId,
      demo_profile_version:1,lmp:F.lmp,edd:F.edd,dating_note:F.dating,gravida:2,para:1,living_children:1,
      plurality:'singleton',prior_outcomes:F.history};
    portal.prepare(`UPDATE mother SET uhid=?,abha_id=NULL,edd=?,gestation_weeks=28,blood_group='B+',
      high_risk_reason_by_clinician=?,validated_by=?,details=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(F.recordId,F.edd,JSON.stringify(['Previous caesarean','Anaemia']),mother.assigned_doctor_id,JSON.stringify(details),mother.id);
    portal.prepare('UPDATE patient SET name=? WHERE id=?').run(F.name,mother.patient_id);
    await db.query('COMMIT'); portal.exec('COMMIT');
    return {motherId:old.id,doctorId:doctor.user_id,email:F.email,recordId:F.recordId};
  } catch(e) {await db.query('ROLLBACK');portal.exec('ROLLBACK');throw e;}
}

module.exports = {seedNivaraProfile};
if (require.main === module) (async()=>{
  const root=path.resolve(__dirname,'..');
  if(process.env.DAI_LOCAL!=='true'||process.env.DAI_APPLY_NIVARA_PROFILE!=='true') throw Error('Explicit DAI_LOCAL and DAI_APPLY_NIVARA_PROFILE opt-ins required. Stop the local launcher first.');
  const net=require('node:net');
  const running=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:Number(process.env.DAI_PORT||3001)});s.on('connect',()=>{s.destroy();resolve(true);});s.on('error',()=>resolve(false));});
  if(running)throw Error('Stop the local launcher before opening its embedded database.');
  const {createLocalPool}=require('../backend/localPool'),{DatabaseSync}=require('node:sqlite');
  const db=createLocalPool(path.join(root,'.local/patient-db')),portal=new DatabaseSync(path.join(root,'.local/portal.db'));
  try{console.log(await seedNivaraProfile(db,portal,{local:true,backupDir:path.join(root,'.local/profile-backups')}));}
  finally{portal.close();await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
