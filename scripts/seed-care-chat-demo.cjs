'use strict';
// Fictional demo dialogue only. Never creates relationships, consents or medical findings.
const {createHash}=require('node:crypto');
const access=require('../backend/accessControl');
const VERSION='nivara-hemangini-chat-v1';
async function seedCareChatDemo(client,{local=process.env.DAI_LOCAL==='true',demo=process.env.DAI_DEMO==='true',now=new Date()}={}){
 if(!local||!demo)return {disabled:true};
 if((await client.query('SELECT 1 FROM dai_local_seed WHERE version=$1',[VERSION])).rows.length)return {alreadySeeded:true};
 const pair=(await client.query(`SELECT mp.user_id AS mother_id,dp.user_id AS doctor_id FROM mother_profiles mp
 JOIN users mu ON mu.id=mp.user_id AND mu.email='mother@dai-synthetic.invalid'
 JOIN dai_local_source_link ml ON ml.entity='mother' AND ml.target_id=mp.user_id AND ml.source_id='MOTHER-SYN-0000001'
 CROSS JOIN doctor_profiles dp JOIN users du ON du.id=dp.user_id AND du.email='doctor@dai-synthetic.invalid'
 JOIN dai_local_source_link dl ON dl.entity='doctor' AND dl.target_id=dp.user_id
 WHERE mp.full_name LIKE '%Nivara Sethi%' AND dp.full_name LIKE '%Hemangini Batra%'
 AND ${access.activeRelationshipSql('mp.user_id','dp.user_id')}
 AND COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean FROM patient_preferences WHERE user_id=mp.user_id),TRUE)`)).rows[0];
 if(!pair)return {skipped:true};
 const dialogue=[
  ['mother','Hello Dr. Hemangini, this is Nivara. I would like to discuss my recovery at my next follow-up.'],
  ['doctor','Hello Nivara. Please bring your previous prescriptions and reports to the visit so we can review them together.'],
  ['mother','Should I bring my daily tracking notes as well?'],
  ['doctor','Yes, please bring your notes and any questions you would like us to discuss.'],
  ['mother','Thank you, Doctor. I will keep them ready.'],
  ['doctor','You can send appointment questions here. For urgent concerns, please contact the hospital directly.']
 ];
 await client.query('BEGIN');
 try{
  for(const [index,[role,text]] of dialogue.entries()){
   const hash=createHash('sha256').update(VERSION+':'+pair.mother_id+':'+pair.doctor_id+':'+index).digest('hex');
   const uuid=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
   await client.query(`INSERT INTO demo_care_messages(mother_id,doctor_id,sender_id,client_id,body,created_at)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(sender_id,client_id) DO NOTHING`,[pair.mother_id,pair.doctor_id,role==='mother'?pair.mother_id:pair.doctor_id,uuid,text,new Date(now.getTime()-(30-index*2)*60000)]);
  }
  await client.query('INSERT INTO dai_local_seed(version,source_sha256,counts) VALUES($1,$2,$3)',[VERSION,'synthetic-conversation-v1',JSON.stringify({messages:dialogue.length,...pair})]);
  await client.query('COMMIT');return {messages:dialogue.length,...pair};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
module.exports={seedCareChatDemo};
