'use strict';
const fs=require('node:fs'),path=require('node:path');
async function seedNivaraFamily(db,{local=false,backupDir}={}){
 if(!local)throw Error('Only the local fictional Nivara household may be curated.');
 const mother=(await db.query(`SELECT u.id FROM users u JOIN mother_profiles p ON p.user_id=u.id JOIN dai_local_source_link l ON l.entity='mother' AND l.target_id=u.id WHERE u.email='nivara@dai-synthetic.invalid' AND l.source_id='MOTHER-SYN-0000001' AND p.full_name='Nivara Sethi'`)).rows[0];
 if(!mother)throw Error('The curated fictional Nivara profile is required.');
 const child=(await db.query("SELECT * FROM children WHERE mother_id=$1 AND (name='Aarav Sethi' OR (sex='male' AND notes LIKE '%CHILD-SYN-0000002%')) ORDER BY id LIMIT 1",[mother.id])).rows[0];
 const doctor=(await db.query("SELECT p.user_id,p.full_name FROM doctor_profiles p JOIN users u ON u.id=p.user_id WHERE u.email='doctor@dai-synthetic.invalid' AND p.full_name LIKE '%Hemangini Batra%'")).rows[0];
 if(!child||!doctor)throw Error('Expected Nivara’s linked male demo child and Hemangini.');
 const grant=(await db.query("SELECT id FROM family_access_grants WHERE mother_id=$1 AND relationship='partner' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",[mother.id])).rows[0];
 const oldGrowth=(await db.query('SELECT * FROM child_growth_logs WHERE child_id=$1',[child.id])).rows;
 if(backupDir){fs.mkdirSync(backupDir,{recursive:true});fs.writeFileSync(path.join(backupDir,'nivara-family-'+Date.now()+'.json'),JSON.stringify({child,growth:oldGrowth},null,2),{mode:0o600});}
 const record={synthetic:true,version:1,child_id:child.id,routine_review_date:'2026-11-28',
  growth_review:{recorded_on:'2026-11-12',doctor_id:doctor.user_id,synthetic:true},
  previous_birth:{date:'2024-05-18',mode:'caesarean',reason:'breech'},
  people:[{id:'kabir',name:'Kabir Sethi',relationship:'partner',responsibilities:['transport','visit_companion','toddler_care'],grant_id:grant?.id||null},
   {id:'ritu',name:'Ritu Sharma',relationship:'outreach_worker',responsibilities:['outreach'],grant_id:null}]};
 await db.query('BEGIN');try{
  await db.query("UPDATE children SET name='Aarav Sethi',date_of_birth='2024-05-18',sex='male',birth_weight_kg=3.1,born_at_weeks=NULL,notes='Fictional Aarav profile, curated for Nivara’s family story. Original source CHILD-SYN-0000002; no real child data.' WHERE id=$1 AND mother_id=$2",[child.id,mother.id]);
  for(const [date,weight,height] of [['2024-05-18',3.1,null],['2026-11-12',12.4,89]]){
   const old=(await db.query('SELECT id FROM child_growth_logs WHERE child_id=$1 AND measured_on=$2 ORDER BY id LIMIT 1',[child.id,date])).rows[0];
   if(old)await db.query('UPDATE child_growth_logs SET weight_kg=$2,height_cm=$3 WHERE id=$1',[old.id,weight,height]);
   else await db.query('INSERT INTO child_growth_logs(child_id,measured_on,weight_kg,height_cm) VALUES($1,$2,$3,$4)',[child.id,date,weight,height]);
  }
  if(!(await db.query("SELECT 1 FROM child_health_events WHERE child_id=$1 AND title='Demo child growth review' AND event_date='2026-11-12'",[child.id])).rows.length)
   await db.query("INSERT INTO child_health_events(child_id,event_type,title,details,event_date,doctor_name) VALUES($1,'checkup','Demo child growth review','Synthetic clinician review recorded: 12.4 kg / 89 cm. No growth classification inferred.','2026-11-12',$2)",[child.id,doctor.full_name]);
  const visit=(await db.query("SELECT id FROM appointments WHERE mother_id=$1 AND child_id=$2 AND doctor_id=$3 AND requested_date='2026-11-28' AND status NOT IN ('cancelled','rejected') ORDER BY id LIMIT 1",[mother.id,child.id,doctor.user_id])).rows[0];
  if(visit)await db.query("UPDATE appointments SET reason='Routine child review · Aarav Sethi (synthetic demo)' WHERE id=$1",[visit.id]);
  else await db.query("INSERT INTO appointments(mother_id,child_id,doctor_id,requested_date,reason,status) VALUES($1,$2,$3,'2026-11-28','Routine child review · Aarav Sethi (synthetic demo)','pending')",[mother.id,child.id,doctor.user_id]);
  await db.query('INSERT INTO family_circle_profiles(mother_id,record) VALUES($1,$2::jsonb) ON CONFLICT(mother_id) DO UPDATE SET record=EXCLUDED.record,updated_at=NOW()',[mother.id,JSON.stringify(record)]);
  await db.query('COMMIT');return {mother_id:mother.id,child_id:child.id,name:'Aarav Sethi',people:['Kabir Sethi','Ritu Sharma'],permissions_changed:false,vaccine_dates_added:0};
 }catch(e){await db.query('ROLLBACK');throw e;}
}
module.exports={seedNivaraFamily};
if(require.main===module)(async()=>{
 if(process.env.DAI_LOCAL!=='true'||process.env.DAI_APPLY_NIVARA_FAMILY!=='true')throw Error('Explicit local demo opt-ins are required. Stop the launcher first.');
 const running=await new Promise(resolve=>{const s=require('node:net').connect({host:'127.0.0.1',port:3001});s.on('connect',()=>{s.destroy();resolve(true)});s.on('error',()=>resolve(false));});
 if(running)throw Error('Stop the launcher before opening its embedded database.');
 const root=path.resolve(__dirname,'..'),db=require('../backend/localPool').createLocalPool(path.join(root,'.local/patient-db'));
 try{await db.query(fs.readFileSync(path.join(root,'backend/db/family_circle_profiles.sql'),'utf8'));console.log(await seedNivaraFamily(db,{local:true,backupDir:path.join(root,'.local/profile-backups')}));}finally{await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
