'use strict';
const {PREFIX,fixture}=require('../scripts/seed-delhi-demo.cjs');
module.exports=function(app,{pool,authenticateToken}){
 app.get('/api/facilities/demo-network',authenticateToken,async(req,res)=>{
  res.set('Cache-Control','private, no-store');if(process.env.DAI_LOCAL!=='true')return res.status(404).json({error:'Synthetic demo network is available in local mode only'});
  if(!['mother','doctor'].includes(req.user?.role))return res.status(403).json({error:'Patient or doctor account required'});
  try{const facilities=(await pool.query(`SELECT f.id,f.facility_code,f.name,f.facility_type,f.address,f.pincode,f.latitude,f.longitude,f.languages,f.notes,
   COALESCE((SELECT json_agg(json_build_object('name',fs.service_name,'category',fs.service_category,'available',fs.available)) FROM facility_services fs WHERE fs.facility_id=f.id),'[]'::json) AS services,
   COALESCE((SELECT json_agg(json_build_object('name',fc.capability,'available',fc.available)) FROM facility_capabilities fc WHERE fc.facility_id=f.id),'[]'::json) AS capabilities,
   COALESCE((SELECT json_agg(json_build_object('id',dp.user_id,'name',dp.full_name,'specialty',df.specialization,'languages',df.languages,'qualification_verified',df.qualification_verified,'accepts_new_patients',df.accepts_new_patients)) FROM doctor_facilities df JOIN doctor_profiles dp ON dp.user_id=df.doctor_id WHERE df.facility_id=f.id AND df.active=TRUE),'[]'::json) AS clinicians
   FROM facilities f WHERE f.facility_code LIKE $1 AND f.verification_source='synthetic_delhi_focused_v1' AND f.active=TRUE ORDER BY f.pincode,f.facility_code`,[PREFIX+'%'])).rows;
   const clinicians=new Set(facilities.flatMap(f=>f.clinicians.map(d=>d.id)));res.json({version:fixture.version,label:fixture.label,synthetic:true,not_bookable:true,coordinate_precision:'approximate PIN/locality centre',facilities,counts:{facilities:facilities.length,clinicians:clinicians.size,pincodes:new Set(facilities.map(f=>f.pincode)).size,affiliations:facilities.reduce((n,f)=>n+f.clinicians.length,0)}});
  }catch(e){console.error('Delhi demo network:',e.message);res.status(500).json({error:'Could not load the demo network. Run npm start to apply the local seed.'});}
 });
};
