'use strict';
// Opt-in, versioned synthetic persona installation before the HTTP servers start.
const fs=require('node:fs'),path=require('node:path');
const VERSION='hosted-nivara-persona-v1';
async function writeScanManifest(db,portal,result,manifestPath){
 // PostgreSQL DATE must cross the Node/Python boundary as a calendar date, not an instant.
 // node-postgres serialises local-midnight Date objects to the previous UTC day in India.
 const patient=(await db.query('SELECT p.full_name,p.pregnancy_status,p.lmp_date::text AS lmp_date,p.edd_date::text AS edd_date,u.id,u.email FROM mother_profiles p JOIN users u ON u.id=p.user_id WHERE u.id=$1',[result.patient_id])).rows[0];
 const doctor=(await db.query('SELECT user_id AS id,full_name FROM doctor_profiles WHERE user_id=$1',[result.doctor_id])).rows[0];
 const mother=portal.prepare("SELECT registered_facility_id FROM mother WHERE source_id='MOTHER-SYN-0000001'").get();
 if(!patient||!doctor||!mother?.registered_facility_id)throw Error('The hosted fictional scan identities are incomplete.');
 const temporary=manifestPath+'.tmp';
 fs.writeFileSync(temporary,JSON.stringify({patient,doctor,facility:mother.registered_facility_id,synthetic:true}),{mode:0o600});
 fs.chmodSync(temporary,0o600);fs.renameSync(temporary,manifestPath);
}
async function seedHostedNivara(db,portal,{backupDir,manifestPath}={}){
 const old=(await db.query('SELECT counts FROM dai_local_seed WHERE version=$1',[VERSION])).rows[0];
 if(old){
  // Refresh only the handoff file on retries; never reapply the profile or reset consent.
  await writeScanManifest(db,portal,old.counts,manifestPath);
  return {...old.counts,alreadySeeded:true};
 }
 const profile=await require('./seed-nivara-profile.cjs').seedNivaraProfile(db,portal,{local:true,backupDir});
 const family=await require('./seed-nivara-family.cjs').seedNivaraFamily(db,{local:true,backupDir});
 await require('./reconcile-nivara-children.cjs').reconcileNivaraChildren(db,portal,{local:true,backupDir});
 // This is the explicit fictional demo share; later revocation/expiry is never reset.
 await db.query("INSERT INTO clinical_dashboard_consent(mother_id,doctor_id,expires_at,include_history) VALUES($1,$2,NOW()+INTERVAL '7 days',TRUE) ON CONFLICT(mother_id,doctor_id) DO NOTHING",[profile.motherId,profile.doctorId]);
 const result={patient:profile.email,patient_id:profile.motherId,doctor_id:profile.doctorId,child_id:family.child_id,children:1,synthetic:true};
 await writeScanManifest(db,portal,result,manifestPath);
 await db.query('INSERT INTO dai_local_seed(version,source_sha256,counts) VALUES($1,$2,$3::jsonb)',[VERSION,'explicit-fictional-video-persona',JSON.stringify(result)]);
 return result;
}
module.exports={seedHostedNivara,VERSION};
if(require.main===module)(async()=>{
 if(process.env.DAI_HOSTED_DEMO!=='true'||process.env.DAI_LOCAL!=='true'||process.env.DAI_SEED_NIVARA_DEMO!=='true')throw Error('Explicit hosted synthetic-persona opt-ins are required.');
 const root=path.resolve(__dirname,'..'),state=path.join(root,'.local');
 const {DatabaseSync}=require('node:sqlite'),db=require('../backend/localPool').createLocalPool(path.join(state,'patient-db')),portal=new DatabaseSync(path.join(state,'portal.db'));
 try{console.log(await seedHostedNivara(db,portal,{backupDir:path.join(state,'profile-backups'),manifestPath:path.join(state,'hosted-nivara.json')}));}finally{portal.close();await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
