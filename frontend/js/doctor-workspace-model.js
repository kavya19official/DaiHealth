(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DoctorWorkspaceModel=factory();})(typeof window!=='undefined'?window:this,function(){
'use strict';
const iso=d=>new Date(d).toISOString().slice(0,10),add=(d,n)=>iso(Date.parse(d+'T12:00:00Z')+n*86400000);
function bounds(date,period){return {start:add(date,period==='week'?-6:period==='month'?-29:period==='year'?-364:0),end:date};}
function inRange(d,b){return !!d&&d.slice(0,10)>=b.start&&d.slice(0,10)<=b.end;}
function roster(data,{query='',filter='all',period='all',date=data.date,sort='name'}={}){
 const q=query.toLowerCase().trim(),b=bounds(date,period),next=add(date,14);
 return (data.patients||[]).filter(p=>(!q||[p.name,p.uhid,p.abha,p.phone].some(v=>String(v||'').toLowerCase().includes(q)))&&(filter==='all'||filter==='high-risk'&&!!p.clinicianRisk||filter==='due14'&&!p.stage.delivered&&p.edd>=date&&p.edd<=next||filter==='postpartum'&&p.stage.delivered||filter==='newborn'&&p.has_child_visit||filter==='overdueHb'&&data.worklist.some(w=>w.patient_id===p.id&&/haemoglobin|\bhb\b|blood count/i.test(w.title)))&&(period==='all'||data.appointments.some(a=>a.mother_id===p.id&&a.status!=='cancelled'&&(filter!=='newborn'||a.child_id)&&inRange(a.requested_date,b))||filter!=='newborn'&&inRange(p.edd,b)))
 .sort((a,b)=>sort==='gaps'?b.open_items-a.open_items:sort==='edd'?String(a.edd||'9999').localeCompare(String(b.edd||'9999')):a.name.localeCompare(b.name));
}
function completion(items){const total=items.length,done=items.filter(m=>m.completed_at).length;return {total,done,percent:total?Math.round(done/total*100):null};}
function completionSeries(items,date,days=7){return Array.from({length:days},(_,i)=>{const d=add(date,i-days+1),rows=items.filter(m=>m.completed_at===d);return {date:d,visits:rows.filter(m=>!/vaccin|scan|test|blood|ogtt|haemoglobin/i.test(m.title)).length,tests:rows.filter(m=>/scan|test|blood|ogtt|haemoglobin/i.test(m.title)).length,vaccines:rows.filter(m=>/vaccin/i.test(m.title)).length};});}
return {add,bounds,inRange,roster,completion,completionSeries};
});
