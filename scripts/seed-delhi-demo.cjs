'use strict';
const fixture=require('../synthetic_data/demo/delhi-network.json');
// Approximate locality centres for synthetic fixtures, not facility addresses.
const demoPinCentres = {
  '110001': [28.6315, 77.2167],
  '110017': [28.5330, 77.2100],
  '110075': [28.5890, 77.0470],
  '110085': [28.7150, 77.1200],
  '110092': [28.6410, 77.2950]
};
function resolveLocation({pincode}) {
  const point = demoPinCentres[String(pincode)];
  return point
    ? {ok:true, precision:'pincode', latitude:point[0], longitude:point[1]}
    : {ok:false};
}
const crypto=require('node:crypto');
const PREFIX='DAI-DELHI-FOCUSED-';
async function seedDelhiDemo(client,env=process.env){
 if(env.DAI_LOCAL!=='true')return {seeded:false,reason:'Local synthetic mode only'};
 await client.query('BEGIN');
 try{
  await client.query('CREATE TABLE IF NOT EXISTS dai_demo_network_seed(version TEXT PRIMARY KEY, details JSONB NOT NULL, seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const prior=(await client.query('SELECT details FROM dai_demo_network_seed WHERE version=$1',[fixture.version])).rows[0];
  if(prior){await client.query('COMMIT');return {seeded:false,...prior.details};}
  const ids={};
  for(const f of fixture.facilities){
   const location=resolveLocation({pincode:f.pincode});if(!location.ok||location.precision!=='pincode')throw Error('Demo PIN must have an explicit gazetteer entry: '+f.pincode);
   const inserted=await client.query(`INSERT INTO facilities(facility_code,name,facility_type,address,city,district,state,pincode,latitude,longitude,languages,verification_source,notes,active)
    VALUES($1,$2,$3,$4,'Delhi','Delhi','Delhi',$5,$6,$7,$8::jsonb,'synthetic_delhi_focused_v1',$9,TRUE) ON CONFLICT(facility_code) DO NOTHING RETURNING id`,[PREFIX+f.code,f.name,f.type,'Fictional demonstration premises near '+f.locality+'; not a real facility address',f.pincode,location.latitude,location.longitude,JSON.stringify(f.languages),'SYNTHETIC DEMO ONLY. Fictional service/capability assertions. Coordinates are approximate PIN/locality centres, not facility locations. No verified credentials or live availability.']);
   if(!inserted.rows.length)throw Error('Reserved synthetic facility code already exists outside this seed: '+f.code);
   ids[f.code]=inserted.rows[0].id;
   for(const [name,category]of f.services)await client.query('INSERT INTO facility_services(facility_id,service_name,service_category,available,notes) VALUES($1,$2,$3,TRUE,$4)',[ids[f.code],name,category,'Synthetic scenario capability only; not live service availability']);
   for(const capability of f.capabilities)await client.query('INSERT INTO facility_capabilities(facility_id,capability,available,notes) VALUES($1,$2,TRUE,$3)',[ids[f.code],capability,'Synthetic scenario capability only; not clinically verified']);
  }
  for(const d of fixture.clinicians){
   // Deliberately unusable login hash: these are directory fixtures, not issued clinical accounts.
   const inserted=await client.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'doctor') ON CONFLICT(email) DO NOTHING RETURNING id",[d.code.toLowerCase()+'@delhi-focused.dai-synthetic.invalid','disabled-synthetic-directory-'+crypto.randomBytes(24).toString('hex')]);
   if(!inserted.rows.length)throw Error('Reserved synthetic clinician already exists outside this seed: '+d.code);
   const id=inserted.rows[0].id;
   await client.query('INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,facility_name) VALUES($1,$2,$3,$4,$5)',[id,d.name,d.specialty,'SYNTHETIC-NOT-A-VALID-LICENSE-'+d.code,fixture.facilities.find(f=>f.code===d.facilities[0]).name]);
   for(const code of d.facilities)await client.query(`INSERT INTO doctor_facilities(doctor_id,facility_id,role,specialization,languages,qualification_verified,verification_details,accepts_new_patients,active) VALUES($1,$2,'consultant',$3,$4::jsonb,FALSE,$5::jsonb,FALSE,TRUE)`,[id,ids[code],d.specialty,JSON.stringify(d.languages),JSON.stringify({synthetic:true,scenario:fixture.version,credentials_verified:false,not_bookable:true})]);
  }
  const summary={facilities:fixture.facilities.length,clinicians:fixture.clinicians.length,affiliations:fixture.clinicians.reduce((n,d)=>n+d.facilities.length,0),label:fixture.label};
  await client.query('INSERT INTO dai_demo_network_seed(version,details) VALUES($1,$2::jsonb)',[fixture.version,JSON.stringify(summary)]);await client.query('COMMIT');return {seeded:true,...summary};
 }catch(e){await client.query('ROLLBACK');throw e;}
}
module.exports={seedDelhiDemo,PREFIX,fixture};
