'use strict';
// Explicit video mode only: fictional facility-level capacity reports, never clinician credentials.
async function seedVideoDemo(client,{date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date())}={}){
 if(process.env.DAI_LOCAL!=='true'||process.env.DAI_VIDEO_DEMO!=='true')return {disabled:true};
 const key='video-slots-v1:'+date;if((await client.query('SELECT 1 FROM dai_local_seed WHERE version=$1',[key])).rows.length)return {alreadySeeded:true};
 const services=(await client.query("SELECT s.id FROM facility_services s JOIN facilities f ON f.id=s.facility_id WHERE f.verification_source='synthetic_delhi_focused_v1' AND f.active=TRUE AND s.available=TRUE ORDER BY s.id")).rows;
 await client.query('BEGIN');try{
  for(const [i,s] of services.entries())await client.query("INSERT INTO facility_service_slots(facility_service_id,starts_at,ends_at,available_places,source,updated_at) VALUES($1,$2::date+INTERVAL '1 day 4 hours',$2::date+INTERVAL '1 day 5 hours',$3,'SYNTHETIC VIDEO FIXTURE: not live availability',NOW())",[s.id,date,2+i%4]);
  await client.query('INSERT INTO dai_local_seed(version,source_sha256,counts) VALUES($1,$2,$3)',[key,'synthetic-video-v1',JSON.stringify({slots:services.length,date})]);await client.query('COMMIT');return {slots:services.length};
 }catch(e){await client.query('ROLLBACK');throw e;}
}
module.exports={seedVideoDemo};
