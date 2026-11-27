'use strict';
// Explicit correction for the local fictional household; never applied to real patients.
const fs = require('node:fs'), path = require('node:path');
async function reconcileNivaraChildren(db, portal, {local=false, backupDir}={}) {
 if(!local)throw Error('This correction is restricted to the local fictional Nivara household.');
 const mother=(await db.query(`SELECT u.id FROM users u JOIN mother_profiles p ON p.user_id=u.id JOIN dai_local_source_link l ON l.entity='mother' AND l.target_id=u.id WHERE u.email='nivara@dai-synthetic.invalid' AND p.full_name='Nivara Sethi' AND l.source_id='MOTHER-SYN-0000001'`)).rows[0];
 if(!mother)throw Error('Expected the curated fictional Nivara account.');
 // Compare PostgreSQL DATE as calendar text: node-postgres parses DATE at local midnight,
 // which shifts to the previous UTC day in Asia/Kolkata.
 const children=(await db.query('SELECT *, date_of_birth::text AS recorded_birth_date FROM children WHERE mother_id=$1',[mother.id])).rows;
 const aarav=children.find(c=>c.name==='Aarav Sethi');
 if(!aarav||aarav.recorded_birth_date!=='2024-05-18')throw Error('Aarav’s curated profile is required.');
 const extra=children.find(c=>c.name==='CHILD-SYN-0000001'&&c.notes?.includes('source CHILD-SYN-0000001'));
 if(children.some(c=>c.id!==aarav.id&&c.id!==extra?.id))throw Error('Unexpected child record: no records were removed.');
 const references=(await db.query(`SELECT tc.table_name,kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema JOIN information_schema.referential_constraints rc ON rc.constraint_name=tc.constraint_name AND rc.constraint_schema=tc.constraint_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=rc.unique_constraint_name AND ccu.constraint_schema=rc.unique_constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='children'`)).rows;
 const backup={reason:'Remove obsolete fictional twin; Nivara has one born child and a singleton pregnancy.',children,dependent:{}};
 if(extra)for(const r of references){const rows=(await db.query(`SELECT * FROM "${r.table_name}" WHERE "${r.column_name}"=$1`,[extra.id])).rows;backup.dependent[r.table_name]=rows;}
 // Do not silently detach uploaded documents or convert child appointments into maternal care.
 if(backup.dependent.patient_documents?.length)throw Error('The obsolete child has uploaded documents; review required.');
 if(backup.dependent.appointments?.some(a=>!a.reason?.startsWith('Synthetic daily demonstration booking')))throw Error('The obsolete child has a non-seeded appointment; review required.');
 let oldPortal, portalAarav, portalRefs=[];
 if(portal){
  oldPortal=portal.prepare("SELECT * FROM child WHERE source_id='CHILD-SYN-0000001'").get();
  portalAarav=portal.prepare("SELECT * FROM child WHERE source_id='CHILD-SYN-0000002'").get();
  const m=portal.prepare("SELECT id FROM mother WHERE source_id='MOTHER-SYN-0000001'").get();
  if(!m||!portalAarav||portalAarav.mother_id!==m.id||(oldPortal&&oldPortal.mother_id!==m.id))throw Error('Portal child ownership mismatch.');
  backup.portal={extra:oldPortal,aarav:portalAarav,dependent:{}};
  if(oldPortal)for(const {name} of portal.prepare("SELECT name FROM sqlite_master WHERE type='table'").all())for(const fk of portal.prepare(`PRAGMA foreign_key_list("${name}")`).all())if(fk.table==='child'){
   portalRefs.push({table:name,column:fk.from});backup.portal.dependent[name]=portal.prepare(`SELECT * FROM "${name}" WHERE "${fk.from}"=?`).all(oldPortal.id);
  }
 }
 if(extra||oldPortal){
  if(!backupDir)throw Error('A recovery backup directory is required before removing the obsolete demo.');
  fs.mkdirSync(backupDir,{recursive:true});fs.writeFileSync(path.join(backupDir,'nivara-obsolete-twin-'+Date.now()+'.json'),JSON.stringify(backup,null,2),{mode:0o600});
 }
 await db.query('BEGIN');if(portal)portal.exec('BEGIN IMMEDIATE');
 try{
  if(extra){
   await db.query("UPDATE appointments SET status='cancelled',reason='Archived obsolete synthetic child booking; not part of Nivara’s curated household.' WHERE child_id=$1",[extra.id]);
   await db.query('DELETE FROM patient_stay_updates WHERE child_id=$1',[extra.id]);
   await db.query("DELETE FROM dai_local_source_link WHERE entity='child' AND source_id='CHILD-SYN-0000001' AND target_id=$1",[extra.id]);
   await db.query('DELETE FROM children WHERE id=$1 AND mother_id=$2',[extra.id,mother.id]);
  }
  if(portal){
   if(oldPortal){for(const r of portalRefs)portal.prepare(`DELETE FROM "${r.table}" WHERE "${r.column}"=?`).run(oldPortal.id);portal.prepare('DELETE FROM child WHERE id=?').run(oldPortal.id);}
   const details=JSON.parse(portalAarav.details||'{}');
   Object.assign(details,{birth_order:1,birth_label:'singleton',date_of_birth:'2024-05-18',birth_weight_g:3100,sex:'male',demo_curated:true});
   // Old twin delivery/NICU metadata does not describe Aarav’s prior birth.
   for(const key of ['pregnancy_id','delivery_id','nicu_admission','nicu_bed_id','nicu_admission_id','gestational_age','apgar_1min','apgar_5min'])delete details[key];
   portal.prepare("UPDATE child SET date_of_birth='2024-05-18',birth_weight_g=3100,birth_order=1,details=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(details),portalAarav.id);
   portal.prepare("UPDATE patient SET name='Aarav Sethi' WHERE id=?").run(portalAarav.patient_id);
  }
  await db.query('COMMIT');if(portal)portal.exec('COMMIT');
  return {children:1,child_name:'Aarav Sethi',removed_obsolete_demo:!!(extra||oldPortal),current_pregnancy:'singleton; EDD 2027-02-15'};
 }catch(e){await db.query('ROLLBACK');if(portal)portal.exec('ROLLBACK');throw e;}
}
module.exports={reconcileNivaraChildren};
if(require.main===module)(async()=>{
 if(process.env.DAI_LOCAL!=='true'||process.env.DAI_APPLY_NIVARA_FAMILY!=='true')throw Error('Explicit local demo opt-ins required. Stop the launcher first.');
 const running=await new Promise(resolve=>{const s=require('node:net').connect({host:'127.0.0.1',port:3001});s.on('connect',()=>{s.destroy();resolve(true)});s.on('error',()=>resolve(false));});
 if(running)throw Error('Stop the local launcher before opening its embedded database.');
 const root=path.resolve(__dirname,'..'),db=require('../backend/localPool').createLocalPool(path.join(root,'.local/patient-db')),portal=new(require('node:sqlite').DatabaseSync)(path.join(root,'.local/portal.db'));
 try{console.log(await reconcileNivaraChildren(db,portal,{local:true,backupDir:path.join(root,'.local/profile-backups')}));}finally{portal.close();await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
