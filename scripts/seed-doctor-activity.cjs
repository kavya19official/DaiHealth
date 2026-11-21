'use strict';
// Additive, one-time fictional clinic history for the linked local cohort.
// Never replaces user edits, revoked shares, risk flags, or hospital capacity.
const fs=require('node:fs'),path=require('node:path');
const VERSION='doctor-activity-v1';
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const add=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return iso(x);};
function reportImage({name,date,doctor,hb,bp,weight}){
 const {createCanvas}=require('../backend/node_modules/@napi-rs/canvas');
 const canvas=createCanvas(1000,1100),c=canvas.getContext('2d');
 c.fillStyle='#fff';c.fillRect(0,0,1000,1100);c.fillStyle='#f1ebfa';c.fillRect(0,0,1000,210);
 c.fillStyle='#654298';c.font='bold 42px sans-serif';c.fillText('DAI | Clinic visit record',64,90);
 c.font='20px sans-serif';c.fillText('A connected record for your care journey',64,139);
 const rows=[['Patient',name.replace(/^synthetic\s+/i,'')],['Visit date',date],['Recorded by',doctor.replace(/^synthetic\s+/i,'')],['Haemoglobin',hb+' g/dL'],['Blood pressure',bp+' mmHg'],['Weight',weight+' kg']];
 rows.forEach(([k,v],i)=>{const y=280+i*100;c.fillStyle='#81758e';c.font='18px sans-serif';c.fillText(k.toUpperCase(),64,y);c.fillStyle='#302638';c.font='bold 25px sans-serif';c.fillText(v,64,y+37);c.fillStyle='#eee8f3';c.fillRect(64,y+58,870,1);});
 c.fillStyle='#766984';c.font='18px sans-serif';c.fillText('Synthetic demonstration record. Not a clinical certificate.',64,990);c.fillText('Your clinician interprets the measurements.',64,1025);
 return canvas.toBuffer('image/png');
}
async function seedDoctorActivity(client,source,{date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date()),uploadDir=path.join(__dirname,'../backend/data/patient-documents')}={}){
 if((await client.query('SELECT 1 FROM dai_local_seed WHERE version=$1',[VERSION])).rows.length)return {alreadySeeded:true};
 const doctors=(await client.query("SELECT dp.*,l.portal_uuid FROM doctor_profiles dp JOIN dai_local_source_link l ON l.entity='doctor' AND l.target_id=dp.user_id ORDER BY dp.user_id")).rows;
 const counts={appointments:0,entries:0,reports:0,completedSteps:0,summaryShares:0};
 fs.mkdirSync(uploadDir,{recursive:true});
 await client.query('BEGIN');
 try{
 for(const d of doctors){
  const hospitalDoctor=source.prepare('SELECT * FROM portal_user WHERE id=? AND verified=1').get(d.portal_uuid);
  if(!hospitalDoctor||!['consultant','resident'].includes(hospitalDoctor.role))continue;
  const unit=hospitalDoctor.unit_id?source.prepare('SELECT code,room FROM unit WHERE id=?').get(hospitalDoctor.unit_id):null;
  const patients=(await client.query(`SELECT DISTINCT mp.* FROM mother_profiles mp JOIN appointments a ON a.mother_id=mp.user_id JOIN dai_local_source_link l ON l.entity='mother' AND l.target_id=mp.user_id WHERE a.doctor_id=$1 AND ${require('../backend/accessControl').activeRelationshipSql('mp.user_id','$1::int')} ORDER BY mp.user_id`,[d.user_id])).rows;
  let slot=0;
  for(const [i,p] of patients.entries()){
   const lmp=iso(p.lmp_date||p.care_start_date),edd=iso(p.edd_date);
   if(p.pregnancy_status!=='pregnant'||lmp>=add(date,-35)||edd<date||slot>=10)continue;
   const index=slot++, time=String(9+Math.floor(index/3)).padStart(2,'0')+':'+String((index%3)*20).padStart(2,'0')+':00';
   // A seeded summary share belongs only to this already assigned fictional pair.
   if(index%4!==3){await client.query("INSERT INTO clinical_dashboard_consent(mother_id,doctor_id,expires_at) VALUES($1,$2,$3::date+INTERVAL '30 days') ON CONFLICT DO NOTHING",[p.user_id,d.user_id,date]);counts.summaryShares++;}
   for(const [offset,visitIndex] of [[-12,0],[-6,1],[0,2],[4+(index%3),3]]){
    const day=add(date,offset);if(day<lmp||day>edd)continue;
    const historical=offset<0,finished=historical||index<2&&offset===0;
    const appointment=(await client.query(`INSERT INTO appointments(mother_id,doctor_id,requested_date,requested_time,status,reason,unit_label,room,facility_uuid,visit_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ANC') RETURNING id`,[p.user_id,d.user_id,day,time,finished?'completed':'confirmed',visitIndex===0?'Antenatal review':visitIndex===1?'Investigation follow-up':visitIndex===2?'ANC clinic review':'Planned antenatal follow-up',unit?'Unit '+unit.code:null,unit?.room||null,hospitalDoctor.facility_id||null])).rows[0].id;
    counts.appointments++;
    if(offset===0){const state=index<2?'done':index<6?'waiting':'booked';await client.query(`INSERT INTO doctor_queue_state(appointment_id,doctor_id,state,checked_in_at,completed_at) VALUES($1,$2,$3,$4,$5)`,[appointment,d.user_id,state,state==='booked'?null:day+'T08:00:00+05:30',state==='done'?day+'T08:40:00+05:30':null]);}
    if(!finished)continue;
    const hb=Number((10.3+(i%6)*.2+visitIndex*.1).toFixed(1)),sys=108+(i%5)*4,dia=68+(i%4)*3,weight=Number((52+(i%9)*1.8+visitIndex*.5).toFixed(1));
    await client.query(`INSERT INTO clinical_dashboard_entries(mother_id,doctor_id,recorded_on,source_kind,values_json) VALUES($1,$2,$3,'clinic_visit',$4::jsonb)`,[p.user_id,d.user_id,day,JSON.stringify({hb,bp_systolic:sys,bp_diastolic:dia,weight_kg:weight,pulse:76+i%12})]);counts.entries++;
    await client.query(`INSERT INTO care_milestones(mother_id,stage,category,title,due_date,completed_at,appointment_id,completion_verification,verified_facility_name,sort_order) VALUES($1,$2,'pregnancy','Antenatal follow-up',$3,$3::date+INTERVAL '8 hours',$4,'verified',$5,80)`,[p.user_id,Math.floor((new Date(day)-new Date(lmp))/604800000)<13?'Trimester 1':Math.floor((new Date(day)-new Date(lmp))/604800000)<28?'Trimester 2':'Trimester 3',day,appointment,d.facility_name]);counts.completedSteps++;
    if(visitIndex!==1||index>=4)continue;
    const key='dai-clinic-'+VERSION+'-'+d.user_id+'-'+p.user_id+'.png';
    const bytes=reportImage({name:p.full_name,date:day,doctor:d.full_name,hb,bp:sys+'/'+dia,weight});fs.writeFileSync(path.join(uploadDir,key),bytes);
    const doc=(await client.query(`INSERT INTO patient_documents(mother_id,title,doc_type,original_filename,mime_type,size_bytes,storage_key,uploaded_at,report_date,facility_name,appointment_id,report_category,notes) VALUES($1,'ANC visit measurements','lab_report','clinic-visit.png','image/png',$2,$3,$4::date+INTERVAL '9 hours',$4,$5,$6,'blood','Fictional clinic record for the local demonstration.') RETURNING id`,[p.user_id,bytes.length,key,day,d.facility_name,appointment])).rows[0].id;
    await client.query(`INSERT INTO patient_document_shares(document_id,doctor_id,shared_by,shared_at,expires_at) VALUES($1,$2,$3,$4::date+INTERVAL '10 hours',$5::date+INTERVAL '30 days')`,[doc,d.user_id,p.user_id,day,date]);
    await client.query(`INSERT INTO patient_document_events(document_id,actor_id,event_type,detail,created_at) VALUES($1,$2,'upload',$3::jsonb,$4::date+INTERVAL '9 hours'),($1,$2,'share',$3::jsonb,$4::date+INTERVAL '10 hours')`,[doc,p.user_id,JSON.stringify({seed:VERSION,doctor_id:d.user_id}),day]);counts.reports++;
   }
  }
 }
 const manifest=source.prepare('SELECT source_sha256 FROM seed_manifest LIMIT 1').get();
 await client.query('INSERT INTO dai_local_seed(version,source_sha256,counts) VALUES($1,$2,$3)',[VERSION,manifest.source_sha256,JSON.stringify({...counts,as_of_date:date})]);
 await client.query('COMMIT');console.log('Added linked doctor clinic activity:',counts);return counts;
 }catch(e){await client.query('ROLLBACK');throw e;}
}
module.exports={seedDoctorActivity,reportImage};
