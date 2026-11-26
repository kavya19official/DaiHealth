'use strict';
// Opt-in, versioned synthetic persona installation before the HTTP servers start.
const fs=require('node:fs'),path=require('node:path');
const VERSION='hosted-nivara-persona-v1';
async function seedHostedNivara(db,portal,{backupDir,manifestPath}={}){
 const old=(await db.query('SELECT counts FROM dai_local_seed WHERE version=$1',[VERSION])).rows[0];
 if(old)return {...old.counts,alreadySeeded:true};
 const profile=await require('./seed-nivara-profile.cjs').seedNivaraProfile(db,portal,{local:true,backupDir});
 const family=await require('./seed-nivara-family.cjs').seedNivaraFamily(db,{local:true,backupDir});
 await require('./reconcile-nivara-children.cjs').reconcileNivaraChildren(db,portal,{local:true,backupDir});
 // This is the explicit fictional demo share; later revocation/expiry is never reset.
 await db.query("INSERT INTO clinical_dashboard_consent(mother_id,doctor_id,expires_at,include_history) VALUES($1,$2,NOW()+INTERVAL '7 days',TRUE) ON CONFLICT(mother_id,doctor_id) DO NOTHING",[profile.motherId,profile.doctorId]);
 const patient=(await db.query('SELECT p.*,u.id,u.email FROM mother_profiles p JOIN users u ON u.id=p.user_id WHERE u.id=$1',[profile.motherId])).rows[0];
 const doctor=(await db.query('SELECT user_id AS id,full_name FROM doctor_profiles WHERE user_id=$1',[profile.doctorId])).rows[0];
 const facility=portal.prepare("SELECT registered_facility_id FROM mother WHERE source_id='MOTHER-SYN-0000001'").get().registered_facility_id;
 const result={patient:profile.email,patient_id:profile.motherId,doctor_id:profile.doctorId,child_id:family.child_id,children:1,synthetic:true};
 fs.writeFileSync(manifestPath,JSON.stringify({patient,doctor,facility,synthetic:true}),{mode:0o600});
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
