'use strict';
const radians=d=>d*Math.PI/180;
function distance(a,b){const lat=radians(Number(b.latitude)-a.lat),lng=radians(Number(b.longitude)-a.lng);return 6371*2*Math.asin(Math.sqrt(Math.sin(lat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(Number(b.latitude)))*Math.sin(lng/2)**2));}
const valid=p=>p&&typeof p.lat==='number'&&typeof p.lng==='number'&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const SQL=`SELECT f.id,f.name,f.address,f.latitude,f.longitude,f.verified_at,s.service_name,
 ST_Distance(f.location,ST_SetSRID(ST_MakePoint($2,$1),4326)::geography)/1000.0 AS distance_km
 FROM facilities f JOIN facility_services s ON s.facility_id=f.id
 WHERE f.active=TRUE AND s.available=TRUE AND s.service_name ILIKE ANY($3::text[])
 AND ST_DWithin(f.location,ST_SetSRID(ST_MakePoint($2,$1),4326)::geography,$4)
 ORDER BY distance_km,f.id,s.id LIMIT 100`;
async function nearby(pool,point,patterns,{postgis=process.env.PATIENT_POSTGIS_ENABLED==='true',radiusKm=25}={}){
 if(!valid(point)||!patterns.length)return {facilities:[],distance_method:'unavailable'};
 if(postgis){try{const r=await pool.query(SQL,[point.lat,point.lng,patterns,radiusKm*1000]);return {facilities:unique(r.rows),distance_method:'postgis'};}catch{/* Deterministic fallback never removes the service eligibility gate. */}}
 const rows=(await pool.query('SELECT f.id,f.name,f.address,f.latitude,f.longitude,f.verified_at,s.service_name FROM facilities f JOIN facility_services s ON s.facility_id=f.id WHERE f.active=TRUE AND s.available=TRUE AND s.service_name ILIKE ANY($1::text[])',[patterns])).rows;
 return {facilities:unique(rows.filter(f=>f.latitude!==null&&f.longitude!==null&&Number.isFinite(Number(f.latitude))&&Number.isFinite(Number(f.longitude))).map(f=>({...f,distance_km:distance(point,f)})).filter(f=>f.distance_km<=radiusKm).sort((a,b)=>a.distance_km-b.distance_km||a.id-b.id)),distance_method:'haversine'};
}
function unique(rows){const seen=new Set();return rows.filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;}).slice(0,5).map(f=>({...f,distance_km:Number(f.distance_km),reason:'Lists '+f.service_name+' · '+Number(f.distance_km).toFixed(1)+' km straight-line distance. Confirm services and availability.'}));}
module.exports={nearby,distance,valid,SQL};
