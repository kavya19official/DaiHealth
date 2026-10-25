'use strict';
const {haversineKm}=require('./demoLocationGazetteer');
const VERSION='synthetic-care-ranking-v1';
function preferences(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid search preferences.');
 const p={language:value.language||'',facility_type:value.facility_type||'',max_distance_km:value.max_distance_km??null,transport_difficulty:value.transport_difficulty??false,preferred_date:value.preferred_date||''};
 if(!['','hindi','english','punjabi'].includes(p.language))throw Error('Select a supported language preference.');
 if(!['','clinic','hospital','maternity_centre','diagnostic_lab'].includes(p.facility_type))throw Error('Select a supported facility type.');
 if(p.max_distance_km!==null&&(typeof p.max_distance_km!=='number'||!Number.isFinite(p.max_distance_km)||p.max_distance_km<1||p.max_distance_km>100))throw Error('Maximum distance must be between 1 and 100 km.');
 if(typeof p.transport_difficulty!=='boolean')throw Error('Invalid shorter-travel preference.');
 if(p.preferred_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.preferred_date)||!Number.isFinite(Date.parse(p.preferred_date+'T00:00:00Z'))||new Date(p.preferred_date+'T00:00:00Z').toISOString().slice(0,10)!==p.preferred_date))throw Error('Select a valid preferred date.');
 return p;
}
function localDate(date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));}
function rank(rows,service,location,p,now=new Date()){
 const timestamp=now.getTime(),week=7*86400000;
 const ranked=[];let excludedService=0,excludedDistance=0;
 for(const f of rows){
  const services=(f.services||[]).filter(s=>s.available===true&&s.category===service);
  if(f.active===false||!services.length){excludedService++;continue;}
  const coordinate=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const km=coordinate(f.latitude)&&coordinate(f.longitude)&&Math.abs(Number(f.latitude))<=90&&Math.abs(Number(f.longitude))<=180?haversineKm(location.latitude,location.longitude,Number(f.latitude),Number(f.longitude)):null;
  if(p.max_distance_km!==null&&(km===null||km>p.max_distance_km)){excludedDistance++;continue;}
  const future=(f.slots||[]).filter(s=>services.some(x=>Number(x.id)===Number(s.facility_service_id))&&Date.parse(s.starts_at)>timestamp&&Date.parse(s.ends_at)>Date.parse(s.starts_at)&&(!p.preferred_date||localDate(s.starts_at)===p.preferred_date));
  const fresh=future.filter(s=>typeof s.source==='string'&&s.source.trim()&&Date.parse(s.updated_at)<=timestamp&&timestamp-Date.parse(s.updated_at)<=week&&(s.doctor_id==null||s.clinician_eligible===true));
  const available=fresh.filter(s=>Number(s.available_places)>0).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at));
  const status=available.length?'reported_available':fresh.length?'no_reported_places':'unknown';
  const reasons=[],components=[];
  const add=(key,weight,value,note)=>{components.push({key,weight,points:Math.round(weight*value*100)/100,note});reasons.push(note);};
  add('availability',40,available.length?1:0,available.length?'A recent reported slot matches the requested service'+(p.preferred_date?' and date':'')+'. Confirm before travel.':fresh.length?'No reported places in the matching future slot records. Other availability is unknown.':'Availability unknown: no recent usable slot report for this service'+(p.preferred_date?' and date':'')+'.');
  add('distance',p.transport_difficulty?60:40,km===null?0:Math.max(0,1-km/50),km===null?'Distance unknown.':km.toFixed(1)+' km approximate straight-line distance. Distance points decline to zero at 50 km.');
  if(p.language){const known=Array.isArray(f.languages)&&f.languages.length;const matched=known&&f.languages.map(l=>String(l).toLowerCase()).includes(p.language);add('language',10,matched?1:0,matched?'Preferred language is listed; confirm clinician language.':known?'Preferred language is not listed.':'Facility languages unknown.');}
  if(p.facility_type)add('facility_type',10,f.facility_type===p.facility_type?1:0,f.facility_type===p.facility_type?'Preferred facility type matches.':'Different facility type; required service still matches.');
  const points=components.reduce((n,c)=>n+c.points,0),total=components.reduce((n,c)=>n+c.weight,0);
  ranked.push({...f,distance_km:km,ranking:{version:VERSION,score:Math.round(100*points/total),availability:status,components,reasons,matching_slots:available.slice(0,3).map(s=>({starts_at:s.starts_at,available_places:s.available_places,source:s.source,updated_at:s.updated_at})),service_match:true}});
 }
 ranked.sort((a,b)=>b.ranking.score-a.ranking.score||(a.distance_km??Infinity)-(b.distance_km??Infinity)||String(a.name).localeCompare(String(b.name))||Number(a.id)-Number(b.id));
 return {facilities:ranked,excluded:{required_service:excludedService,max_distance:excludedDistance},method:{version:VERSION,availability_weight:40,distance_weight:p.transport_difficulty?60:40,language_weight:p.language?10:0,facility_type_weight:p.facility_type?10:0,slot_freshness_days:7,distance_scale_km:50,description:'Required service is a hard gate. Maximum distance, if set, is a hard limit. Other preferences affect ranking only. Scores describe this search, not clinical quality. Unknown availability gets no availability points; opening hours never imply a slot. Ties use distance, name and ID.'}};
}
module.exports={preferences,rank,VERSION};
