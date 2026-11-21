/* Patient developmental observations and chart preparation. No diagnostic scoring. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./child-reference'));else root.ChildDevelopment=factory(root.AnvayaChild);})(typeof self!=='undefined'?self:this,function(Ref){'use strict';
const VERSION='dai-development-checkin-1';
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());}
function age(child,on=today()){
 const days=Ref.daysBetween(child.date_of_birth,on);if(!Number.isFinite(days)||days<0)return null;
 const early=Number(child.born_at_weeks)>0&&Number(child.born_at_weeks)<37?(40-Number(child.born_at_weeks))*7:0;
 const corrected=early>0&&days/30.4375<24;
 const checklistMonths=days<early?0:Ref.ageParts(corrected?Ref.addDaysISO(child.date_of_birth,early):child.date_of_birth,on).totalMonths;
 return {days,months:(corrected?Math.max(0,days-early):days)/30.4375,checklistMonths,corrected,beforeTerm:early>days};
}
function checkpoint(child,on=today()){
 const a=age(child,on);if(!a||a.beforeTerm||a.checklistMonths>=72)return null;
 return Ref.MILESTONES.filter(c=>c.months<=a.checklistMonths).at(-1)||null;
}
function growthPoints(child,metric,on=today()){
 const key={weight:'weight_kg',height:'height_cm',head:'head_cm'}[metric];if(!key)return [];
 return (child.growth||[]).filter(g=>/^\d{4}-\d{2}-\d{2}$/.test(String(g.measured_on))&&g.measured_on>=child.date_of_birth&&g.measured_on<=on&&g[key]!=null&&g[key]!==''&&Number.isFinite(Number(g[key]))&&Number(g[key])>0).map(g=>({m:age(child,g.measured_on),v:Number(g[key]),date:g.measured_on,id:g.id})).filter(p=>p.m&&!p.m.beforeTerm&&p.m.months<=60).map(p=>({...p,m:p.m.months})).sort((a,b)=>a.date.localeCompare(b.date)||Number(a.id||0)-Number(b.id||0));
}
function validate(child,body,on=today()){
 const c=checkpoint(child,on),answers=body?.answers;
 if(!c||body.checkpoint_months!==c.months||!answers||Array.isArray(answers)||typeof answers!=='object')return null;
 const codes=c.items.map(i=>i.code);if(Object.keys(answers).length!==codes.length||codes.some(k=>!['yes','not_yet','unsure'].includes(answers[k])))return null;
 if(!['yes','no','unsure'].includes(body.lost_skills)||typeof body.concern!=='string'||body.concern.length>1000)return null;
 return {checkpoint_months:c.months,answers:Object.fromEntries(codes.map(k=>[k,answers[k]])),lost_skills:body.lost_skills,concern:body.concern.trim(),age_days:age(child,on).days,instrument:VERSION};
}
return {VERSION,today,age,checkpoint,growthPoints,validate,SCREENING_MONTHS:[9,18,30]};
});
