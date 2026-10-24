/* Data-only presentation helpers shared by child, recovery and map screens. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LittleWorldModel=factory();})(typeof window==='undefined'?this:window,function(){
'use strict';
const date=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(value))return NaN;const d=new Date(value.slice(0,10)+'T00:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===value.slice(0,10)?d.getTime():NaN;};
function days(dob,today){const a=date(dob),b=date(today);return Number.isFinite(a)&&Number.isFinite(b)&&a<=b?Math.floor((b-a)/86400000):null;}
function age(dob,today){const n=days(dob,today);if(n===null)return 'Age not recorded';if(n<84)return Math.floor(n/7)+' weeks, '+n%7+' days';const a=new Date(date(dob)),b=new Date(date(today));let m=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth();if(b.getUTCDate()<a.getUTCDate())m--;return m<24?m+' months old':Math.floor(m/12)+' years, '+m%12+' months';}
function nextDose(schedule){return (schedule||[]).filter(v=>!v.givenOn&&v.status!=='optional').slice().sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)))[0]||null;}
function ring(dob,today,schedule){const current=days(dob,today),next=nextDose(schedule),due=next&&days(dob,next.dueDate);return current===null?0:due>0?Math.min(100,current/due*100):next?100:0;}
function coordinates(f){const a=f.latitude??f.lat,b=f.longitude??f.lng;if(a==null||b==null||a===''||b==='')return null;const x=Number(a),y=Number(b);return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x)<=90&&Math.abs(y)<=180?[x,y]:null;}
function kind(f){const t=f.facility_type||'';return ['phc','chc'].includes(t)?'primary':t==='diagnostic_lab'?'lab':t==='vaccination_center'?'vaccine':t==='clinic'?'clinic':'hospital';}
function filterFacilities(rows,filter){return rows.filter(f=>filter==='all'||filter==='emergency'&&f.emergency_24x7===true||kind(f)===filter);}
return {days,age,nextDose,ring,coordinates,kind,filterFacilities};
});
