'use strict';
// Local synthetic scheduling only. Creates bookings, not clinical findings or outcomes.
async function seedDoctorDemoDay(client,source,{date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date()),local=process.env.DAI_LOCAL==='true'}={}){
 if(!local)return {disabled:true};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid synthetic schedule date');
 const version='doctor-demo-day-v1:'+date;
 if((await client.query('SELECT 1 FROM dai_local_seed WHERE version=$1',[version])).rows.length)return {alreadySeeded:true};
 const manifest=source.prepare('SELECT source_sha256 FROM seed_manifest LIMIT 1').get();if(!manifest?.source_sha256)throw Error('Synthetic source manifest required');
 const doctors=(await client.query("SELECT dp.user_id,l.portal_uuid FROM doctor_profiles dp JOIN dai_local_source_link l ON l.entity='doctor' AND l.target_id=dp.user_id JOIN users u ON u.id=dp.user_id WHERE u.email LIKE '%@dai-synthetic.invalid' ORDER BY dp.user_id")).rows;
 const counts={appointments:0,child_appointments:0,postpartum_appointments:0,date};
 await client.query('BEGIN');
 try{
  for(const d of doctors){
   const hd=source.prepare('SELECT * FROM portal_user WHERE id=? AND verified=1').get(d.portal_uuid);
   if(!hd||!['consultant','resident'].includes(hd.role))continue;
   const unit=hd.unit_id?source.prepare('SELECT code,room FROM unit WHERE id=?').get(hd.unit_id):null;
   // Assignment and child ownership must already exist. Do not grant new doctor/patient access.
   const rows=(await client.query(`SELECT DISTINCT mp.user_id,mp.pregnancy_status,c.id AS child_id
     FROM mother_profiles mp JOIN users u ON u.id=mp.user_id
     JOIN dai_local_source_link l ON l.entity='mother' AND l.target_id=mp.user_id
     LEFT JOIN children c ON c.mother_id=mp.user_id
     WHERE u.email LIKE '%@dai-synthetic.invalid' AND ${require('../backend/accessControl').activeRelationshipSql('mp.user_id','$1::int')}
     ORDER BY mp.user_id,c.id`,[d.user_id])).rows;
   const chosen=[];const used=new Set();
   for(const p of rows.filter(p=>p.child_id).slice(0,2)){chosen.push({...p,type:'Child follow-up'});used.add(p.user_id);}
   for(const p of [...new Map(rows.filter(p=>p.pregnancy_status==='delivered'&&!used.has(p.user_id)).map(p=>[p.user_id,p])).values()].slice(0,1)){chosen.push({...p,child_id:null,type:'Postpartum follow-up'});used.add(p.user_id);}
   for(const p of [...new Map(rows.filter(p=>p.pregnancy_status==='pregnant'&&!used.has(p.user_id)).map(p=>[p.user_id,p])).values()].slice(0,2)){chosen.push({...p,child_id:null,type:'ANC'});used.add(p.user_id);}
   for(const [i,p] of chosen.entries()){
    // Respect an existing booking for this patient/child/day, including edits or cancellations.
    if((await client.query('SELECT 1 FROM appointments WHERE doctor_id=$1 AND mother_id=$2 AND requested_date=$3 AND child_id IS NOT DISTINCT FROM $4 LIMIT 1',[d.user_id,p.user_id,date,p.child_id])).rows.length)continue;
    const a=(await client.query(`INSERT INTO appointments(mother_id,doctor_id,requested_date,requested_time,status,reason,facility_uuid,unit_label,room,visit_type,child_id)
      VALUES($1,$2,$3,$4,'confirmed',$5,$6,$7,$8,$9,$10) RETURNING id`,[p.user_id,d.user_id,date,String(13+Math.floor(i/3)).padStart(2,'0')+':'+String(i%3*20).padStart(2,'0')+':00','Synthetic daily demonstration booking · '+p.type,hd.facility_id,unit?'Unit '+unit.code:null,unit?.room||null,p.type,p.child_id])).rows[0];
    await client.query("INSERT INTO doctor_queue_state(appointment_id,doctor_id,state) VALUES($1,$2,'booked')",[a.id,d.user_id]);
    counts.appointments++;if(p.child_id)counts.child_appointments++;if(p.type==='Postpartum follow-up')counts.postpartum_appointments++;
   }
  }
  await client.query('INSERT INTO dai_local_seed(version,source_sha256,counts) VALUES($1,$2,$3)',[version,manifest.source_sha256,JSON.stringify(counts)]);await client.query('COMMIT');
  console.log('Synthetic daily doctor schedule:',counts);return counts;
 }catch(e){await client.query('ROLLBACK');throw e;}
}
module.exports={seedDoctorDemoDay};
