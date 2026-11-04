'use strict';
// Explicit fictional discharge-summary fixture. Does not allocate a real bed or change hospital census.
async function seedHospitalStay(client,{now=new Date()}={}){
 const version='hospital-stay-demo-v1';
 if((await client.query('SELECT 1 FROM dai_local_seed WHERE version=$1',[version])).rows.length)return;
 const mother=(await client.query("SELECT target_id FROM dai_local_source_link WHERE entity='mother' AND source_id='MOTHER-SYN-0000001'")).rows[0];if(!mother)return;
 const at=hours=>new Date(now.getTime()+hours*3600000).toISOString();
 await client.query('BEGIN');try{
 const stay=(await client.query(`INSERT INTO patient_hospital_stays(mother_id,facility_name,ward_name,bed_label,admitted_at,discharged_at,synthetic) VALUES($1,'DAI demonstration facility','Demo recovery ward','Demo bed 14',$2,$3,TRUE) RETURNING id`,[mother.target_id,at(-48),at(-6)])).rows[0];
 async function update(kind,text,values={},child=null,hours=-10,supersedes=null){return (await client.query(`INSERT INTO patient_stay_updates(stay_id,child_id,kind,patient_text,values_json,recorded_at,recorded_by,verified_at,verified_by,released_at,released_by,supersedes_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,'Demo Nurse Iva', $7,'Demo Senior Nurse Reva',$8,'Demo Clinician Dev',$9) RETURNING id`,[stay.id,child,kind,text,JSON.stringify(values),at(hours),at(hours+.2),at(hours+.4),supersedes])).rows[0].id;}
 const old=await update('vitals','Observations recorded on the ward.',{bp_systolic:116,bp_diastolic:76,pulse:80,temperature_c:36.7},null,-24);
 await update('vitals','Updated pulse entry; the previous value remains in history.',{bp_systolic:116,bp_diastolic:76,pulse:78,temperature_c:36.7},null,-23,old);
 await update('vitals','Observations recorded before discharge.',{bp_systolic:118,bp_diastolic:78,pulse:76,temperature_c:36.8});
 await update('handover','Bring your discharge notes and your questions to the planned follow-up. Please speak to your nurse or doctor about the recorded readings.');
 await update('medicine','Iron and folic acid - administration recorded by nursing staff. This fictional record does not specify a dose.');
 const followup=at(72).slice(0,10);
 await update('followup','Post-discharge follow-up with your care team.',{followup_date:followup});
 await client.query(`INSERT INTO care_milestones(mother_id,stage,category,title,due_date,sort_order) VALUES($1,'Postpartum','pregnancy','Hospital stay: post-discharge review',$2,95)`,[mother.target_id,followup]);
 const children=(await client.query('SELECT id,name,birth_weight_kg FROM children WHERE mother_id=$1 ORDER BY id',[mother.target_id])).rows;
 for(const [index,child] of children.entries()){await update('weight','Daily weight recorded by nursing staff.',{weight_kg:6.1+index*.2},child.id);await update('feeding','Feeding session recorded; ask the care team about the feeding plan.',{},child.id);await update('kangaroo','Kangaroo care session recorded.',{minutes:20},child.id);await update('phototherapy','No phototherapy entry released in this demonstration stay.',{},child.id);}
 // An unverified entry must never appear on the patient screen.
 await client.query("INSERT INTO patient_stay_updates(stay_id,kind,recorded_at,recorded_by,patient_text) VALUES($1,'handover',$2,'Demo Nurse Iva','Internal draft: not released')",[stay.id,at(-8)]);
 await client.query('INSERT INTO dai_local_seed(version,source_sha256,counts) VALUES($1,$2,$3)',[version,'explicit-synthetic-stay-demo',JSON.stringify({stays:1,children:children.length})]);await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}
}
module.exports={seedHospitalStay};
