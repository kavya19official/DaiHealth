(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CareWorkbench=factory();})(typeof window!=='undefined'?window:this,function(){
'use strict';
const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const minutes=t=>/^\d\d:\d\d(?::\d\d)?$/.test(t||'')&&Number(t.slice(0,2))<24&&Number(t.slice(3,5))<60?Number(t.slice(0,2))*60+Number(t.slice(3,5)):null;
const time=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
function registry(data,filter={}){
 const q=String(filter.query||'').toLowerCase().trim();
 return (data.patients||[]).filter(p=>{
  const week=p.stage?.week;
  const stage=p.stage?.delivered?'postpartum':Number.isFinite(week)?'t'+(week<14?1:week<28?2:3):'unknown';
  const due=p.edd&&p.edd>=data.date&&p.edd<=new Date(Date.parse(data.date+'T12:00:00Z')+14*86400000).toISOString().slice(0,10);
  return (!q||[p.name,p.uhid,p.abha].some(s=>String(s||'').toLowerCase().includes(q)))&&(!filter.stage||filter.stage==='all'||stage===filter.stage)&&(!filter.gap||filter.gap==='all'||filter.gap==='overdue'&&p.overdue>0||filter.gap==='due14'&&due||filter.gap==='marked'&&!!p.clinicianRisk||filter.gap==='unshared'&&!p.clinical_shared);
 });
}
function operations(data,options={}){
 const date=options.date||data.date,start=minutes(options.start||'09:00'),end=minutes(options.end||'17:00'),duration=Number(options.duration||30);
 if(!dateOK(date)||start===null||end===null||end<=start||![15,30,45,60].includes(duration))throw Error('Choose a valid date, clinic hours and appointment length.');
 const rows=(data.appointments||[]).filter(a=>a.requested_date===date),queue=new Map((data.queue||[]).map(q=>[q.appointment_id,q]));
 const state=a=>queue.get(a.id)?.state||a.status;
 const active=rows.filter(a=>!['cancelled','no_show'].includes(a.status)&&state(a)!=='no_show');
 const timed=active.filter(a=>minutes(a.requested_time)!==null),untimed=active.length-timed.length;
 // Existing booking endpoint reserves a 30-minute buffer. Larger chosen slots remain conservative.
 const occupied=timed.map(a=>({start:minutes(a.requested_time),end:minutes(a.requested_time)+Math.max(30,duration)}));
 const now=options.now||new Date().toISOString(),nowMs=Date.parse(now),slots=[];
 for(let m=start;m+duration<=end;m+=duration){if(Date.parse(date+'T'+time(m)+':00+05:30')<=nowMs)continue;if(!occupied.some(a=>m<a.end&&m+Math.max(30,duration)>a.start))slots.push(time(m));}
 const waiting=active.filter(a=>state(a)==='waiting').map(a=>{const q=queue.get(a.id);return {...a,wait_minutes:q?.checked_in_at?Math.max(0,Math.floor((nowMs-Date.parse(q.checked_in_at))/60000)):null};});
 const overlaps=[];for(let i=0;i<occupied.length;i++)for(let j=i+1;j<occupied.length;j++)if(occupied[i].start<occupied[j].end&&occupied[j].start<occupied[i].end)overlaps.push([timed[i].id,timed[j].id]);
 return {date,slots,untimed,waiting,overlaps,scheduled:active.length,completed:active.filter(a=>['done','completed'].includes(state(a))).length,cancelled:rows.filter(a=>a.status==='cancelled').length,no_show:rows.filter(a=>state(a)==='no_show').length,booking_supported:duration===30};
}
function followupCandidates(data){
 const booked=new Set((data.appointments||[]).filter(a=>a.child_id==null&&['confirmed','scheduled'].includes(a.status)&&a.requested_date>=data.date).map(a=>a.mother_id));
 return (data.patients||[]).filter(p=>!booked.has(p.id)&&(Number(p.overdue)>0||p.clinical_shared&&p.clinicianRisk)).map(p=>({id:p.id,name:p.name,marked:Boolean(p.clinical_shared&&p.clinicianRisk),overdue:Number(p.overdue)||0,reason:[p.clinical_shared&&p.clinicianRisk?'Clinician marked for review':'',Number(p.overdue)>0?p.overdue+' recorded overdue care items':''].filter(Boolean).join(' · ')})).sort((a,b)=>Number(b.marked)-Number(a.marked)||b.overdue-a.overdue||String(a.name).localeCompare(String(b.name)));
}
function insights(data){
 const end=Date.parse(data.date+'T12:00:00Z'),start=new Date(end-29*86400000).toISOString().slice(0,10),rows=(data.appointments||[]).filter(a=>a.requested_date>=start&&a.requested_date<=data.date),q=new Map((data.queue||[]).map(q=>[q.appointment_id,q.state]));
 const completed=rows.filter(a=>a.status==='completed'||q.get(a.id)==='done').length,noShow=rows.filter(a=>a.status==='no_show'||q.get(a.id)==='no_show').length,cancelled=rows.filter(a=>a.status==='cancelled').length,unique=new Set(rows.map(a=>a.mother_id)).size;
 const repeat=new Map();rows.filter(a=>a.status==='completed'||q.get(a.id)==='done').forEach(a=>repeat.set(a.mother_id,(repeat.get(a.mother_id)||0)+1));
 return {start,end:data.date,recorded:rows.length,completed,no_show:noShow,cancelled,unique,repeat_patients:[...repeat.values()].filter(n=>n>1).length,completion_rate:rows.length?Math.round(completed/rows.length*100):null,unreviewed_reports:(data.reports||[]).filter(r=>!r.reviewed).length};
}
function csv(rows){const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return rows.map(r=>r.map(cell).join(',')).join('\r\n');}
return {dateOK,minutes,time,registry,operations,followupCandidates,insights,csv};
});
