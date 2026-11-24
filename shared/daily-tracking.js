/* Deterministic self-report schema. A check-in is not a screening instrument. */
(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.DaiDailyModel=model;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const symptoms=['nausea','headache','blurred_vision','swelling','back_pain','cramps','bleeding','leaking_fluid','reduced_movement','chest_pain','breathlessness','palpitations','fainting'];
const numeric=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const str=(v,max)=>typeof v==='string'&&v.length<=max;
function clean(kind,d){if(!d||typeof d!=='object'||Array.isArray(d))return null;
 switch(kind){
 case 'water':return {};
 case 'supplement':return ['iron','calcium'].includes(d.supplement)&&typeof d.taken==='boolean'?{supplement:d.supplement,taken:d.taken}:null;
 case 'meal':return str(d.text,500)&&d.text.trim()?{text:d.text.trim()}:null;
 case 'sleep':return numeric(d.hours,0,24)&&['restful','mixed','poor'].includes(d.quality)?{hours:d.hours,quality:d.quality}:null;
 case 'mood':return Number.isInteger(d.mood)&&numeric(d.mood,1,5)&&Number.isInteger(d.energy)&&numeric(d.energy,1,5)?{mood:d.mood,energy:d.energy}:null;
 case 'activity':return Number.isInteger(d.minutes)&&numeric(d.minutes,0,1440)&&str(d.note||'',300)?{minutes:d.minutes,note:(d.note||'').trim()}:null;
 case 'symptom':return Array.isArray(d.codes)&&d.codes.length<=symptoms.length&&d.codes.every(c=>symptoms.includes(c))&&['mild','moderate','severe','unspecified'].includes(d.severity)&&str(d.note||'',1500)&&(d.codes.length||(d.note||'').trim())?{codes:[...new Set(d.codes)],severity:d.severity,note:(d.note||'').trim()}:null;
 case 'blood_pressure':return Number.isInteger(d.systolic)&&numeric(d.systolic,60,260)&&Number.isInteger(d.diastolic)&&numeric(d.diastolic,30,160)&&d.systolic>d.diastolic?{systolic:d.systolic,diastolic:d.diastolic}:null;
 case 'weight':return numeric(d.kg,20,250)?{kg:Math.round(d.kg*10)/10}:null;
 case 'blood_glucose':return numeric(d.mg_dl,20,600)&&['fasting','after_meal_1h','after_meal_2h','random'].includes(d.context)?{mg_dl:Math.round(d.mg_dl),context:d.context}:null;
 case 'kick_session':return Number.isInteger(d.kicks)&&numeric(d.kicks,0,200)&&Number.isInteger(d.duration_sec)&&numeric(d.duration_sec,1,21600)?{kicks:d.kicks,duration_sec:d.duration_sec}:null;
 default:return null;
 }
}
function warningCodes(d){const c=d.codes||[],out=[];if(c.includes('chest_pain')||c.includes('breathlessness')||c.includes('palpitations'))out.push('chest_breath');if(c.includes('fainting'))out.push('fainting');if(c.includes('bleeding'))out.push('bleeding_any');if(c.includes('leaking_fluid'))out.push('waters_break');if(c.includes('reduced_movement'))out.push('reduced_movement');if(c.includes('blurred_vision')||(c.includes('headache')&&d.severity==='severe'))out.push('severe_headache_vision');return out;}
return {symptoms,clean,warningCodes};
});
