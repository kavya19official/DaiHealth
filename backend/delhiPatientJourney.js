'use strict';
const {resolveLocation,inDelhiBox,haversineKm}=require('./demoLocationGazetteer');
const NEEDS=Object.freeze({antenatal:{label:'Pregnancy check-up',service:'obstetrics'},gynaecology:{label:'Gynaecology consultation',service:'gynecology'},ultrasound:{label:'Ultrasound',service:'ultrasound'},laboratory:{label:'Laboratory tests',service:'lab_tests'},vaccination:{label:'Child vaccination',service:'vaccination'}});
function validate(body){
 if(!body||!Object.hasOwn(NEEDS,body.need))throw Error('Select a supported care need.');
 const l=body.location;if(!l||!['manual_pin','device'].includes(l.source))throw Error('Enter a Delhi PIN or use device location.');
 if(l.source==='manual_pin'){
  if(typeof l.pincode!=='string'||!/^\d{6}$/.test(l.pincode))throw Error('Enter a six-digit Delhi PIN code.');
  const p=resolveLocation({pincode:l.pincode});
  if(!p.ok||p.precision!=='pincode')throw Error('This PIN is outside the supported Delhi locality list. Try another Delhi PIN.');
  return {...p,source:'manual_pin'};
 }
 if(l.consent!==true)throw Error('Device location requires your permission.');
 const {latitude,longitude,accuracy}=l;
 if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||!inDelhiBox(latitude,longitude))throw Error('Device location is outside the supported Delhi area or is invalid. Enter a Delhi PIN instead.');
 if(typeof accuracy!=='number'||!Number.isFinite(accuracy)||accuracy<0)throw Error('Device location accuracy is missing or invalid.');
 return {latitude,longitude,accuracy,source:'device',precision:'device',label:'Permission-based device location'};
}
function register(app,{pool,authenticateToken}){
 app.post('/api/facilities/demo-journey/search',authenticateToken,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(process.env.DAI_LOCAL!=='true')return res.status(404).json({error:'Synthetic journey is available in local mode only.'});
  if(req.user?.role!=='mother')return res.status(403).json({error:'Patient account required.'});
  let location;try{location=validate(req.body);}catch(e){return res.status(400).json({error:e.message});}
  try{
   const need=NEEDS[req.body.need];
   const rows=(await pool.query(`SELECT f.id,f.name,f.pincode,f.facility_type,f.latitude,f.longitude,
    COALESCE((SELECT json_agg(json_build_object('name',s.service_name,'category',s.service_category)) FROM facility_services s WHERE s.facility_id=f.id AND s.available=TRUE),'[]'::json) AS services,
    COALESCE((SELECT json_agg(json_build_object('name',p.full_name,'specialty',d.specialization)) FROM doctor_facilities d JOIN doctor_profiles p ON p.user_id=d.doctor_id WHERE d.facility_id=f.id AND d.active=TRUE),'[]'::json) AS clinicians
    FROM facilities f WHERE f.facility_code LIKE 'DAI-DELHI-FOCUSED-%' AND f.verification_source='synthetic_delhi_focused_v1' AND f.active=TRUE
    AND EXISTS(SELECT 1 FROM facility_services s WHERE s.facility_id=f.id AND s.available=TRUE AND s.service_category=$1)`,[need.service])).rows;
   const facilities=rows.map(f=>({...f,distance_km:f.latitude!=null&&f.longitude!=null?haversineKm(location.latitude,location.longitude,Number(f.latitude),Number(f.longitude)):null})).sort((a,b)=>(a.distance_km??Infinity)-(b.distance_km??Infinity)||a.name.localeCompare(b.name));
   res.json({synthetic:true,not_bookable:true,need:{id:req.body.need,...need},location,facilities,notice:'Fictional scenario services only. Distances are straight-line estimates to approximate locality centres, not travel distances or verified clinical suitability.'});
  }catch(e){console.error('Demo journey search failed:',e.message);res.status(500).json({error:'Could not search the synthetic network. Please retry.'});}
 });
}
module.exports={register,validate,NEEDS};
