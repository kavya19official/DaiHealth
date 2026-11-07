/* Recorded events define gaps; deterministic sorting never creates a risk label. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./patient-model'),require('../../shared/child-reference'));else root.PatientPendingModel=factory(root.PatientModel,root.AnvayaChild);})(typeof window==='undefined'?this:window,function(M,Child){
'use strict';
function category(m){
 if(m.child_id)return 'child';if(m.post)return 'postpartum';
 const t=[m.title,m.guidance,m.category].join(' ').toLowerCase();
 return /vaccin|bcg|opv|td dose/.test(t)?'vaccines':/nutrition|iron|calcium|supplement/.test(t)?'nutrition':/test|scan|blood|glucose|ogtt|haemoglobin/.test(t)?'tests':/postnatal|breast|recovery|postpartum/.test(t)?'postpartum':'visits';
}
function title(m){const t=m.title||'Care follow-up';return /glucose|ogtt/i.test(t)?'Sugar test (OGTT)':/haemoglobin|\bhb\b/i.test(t)?'Blood test for iron (Hb)':/anomaly/i.test(t)?'Your baby’s detailed scan':t;}
function status(m,today=M.today()){
 if(m.status==='queued'||m.queued)return 'queued';
 if(M.status(m,today)==='completed')return 'completed';
 if(!m.due_date)return 'upcoming';const days=M.days(m.due_date,today);return days<0?'overdue':days<=7?'week':'upcoming';
}
function priority(m){const p=m.clinician_priority||(m.added_by_doctor_id?m.priority:null);return ({urgent:3,high:3,important:2,normal:1,routine:1})[String(p).toLowerCase()]||0;}
function order(a,b,today=M.today()){
 const rank={overdue:0,week:1,queued:2,upcoming:3,completed:4};
 return rank[status(a,today)]-rank[status(b,today)]||priority(b)-priority(a)||String(a.due_date||'9999').localeCompare(String(b.due_date||'9999'))||String(a.key).localeCompare(String(b.key));
}
function reason(m,today=M.today()){
 const s=status(m,today),n=m.due_date?M.days(today,m.due_date):null;
 return [priority(m)?'Priority recorded by your clinician':null,s==='overdue'?'Due '+n+' day'+(n===1?'':'s')+' ago':s==='week'?n===0?'Due today':'Due in '+Math.abs(n)+' days':s==='completed'?'Completion recorded':s==='queued'?'Waiting for your saved update to sync':'Scheduled for '+(m.due_date||'a date to confirm')].filter(Boolean).join(' · ');
}
function rows(state,lane='mother',babyId=null,today=M.today()){
 const delivered=M.stage(state.user,state.post,state.children,today).delivered,rows=[];
 if(lane!=='baby'){
  for(const m of state.milestones||[]){if(m.category==='child')continue;if(delivered&&M.status(m,today)!=='completed'&&!/post|pnc|breast|recovery/i.test([m.category,m.stage,m.title].join(' ')))continue;rows.push({...m,key:'mother-'+m.id,source:'milestone'});}
  if(state.post?.active)for(const m of state.post.schedule||[])rows.push({key:'post-'+m.code,id:'post-'+m.code,source:'post',post:true,title:m.title,guidance:m.why,due_date:m.window_end,status:m.status==='done'?'completed':m.status,completed_at:m.completed_at});
 }
 if(lane!=='mother'){
  const c=(state.children||[]).find(c=>String(c.id)===String(babyId))||state.children?.[0];
  if(c&&Child){const given=Object.fromEntries((c.vaccinations||[]).map(v=>[v.vaccine_code,v.given_on]));
   for(const v of Child.vaccineSchedule(String(c.date_of_birth).slice(0,10),given,today).filter(v=>!v.conditional||v.givenOn))rows.push({key:'child-'+c.id+'-'+v.code,id:v.code,source:'vaccine',child_id:c.id,child_name:c.name,title:v.name,category:'vaccines',due_date:v.dueDate,completed_at:v.givenOn,status:v.status==='completed'?'completed':'upcoming',guidance:'Your vaccination centre can confirm the dose and help with any missed doses.'});
   for(const m of [...(c.followups||[]),...(c.growth_checks||[])])if(m.due_date)rows.push({...m,key:'child-followup-'+c.id+'-'+m.id,source:'child-followup',child_id:c.id,child_name:c.name});
  }
 }
 return rows.sort((a,b)=>order(a,b,today));
}
function summary(rows,today=M.today()){const out={overdue:0,week:0,upcoming:0,completed:0,queued:0};for(const m of rows)out[status(m,today)]++;return {...out,total:rows.length,attention:out.overdue+out.week,percent:rows.length?Math.round(out.completed/rows.length*100):0};}
// Presentation projection of the existing authoritative workflow, never a second machine.
function workflow(m){if(m.workflow_state)return m.workflow_state;if(m.completion_verification==='verified')return 'clinician_confirmed';if(m.result_id)return 'awaiting_review';if(m.completed_at)return m.source==='milestone'?'patient_reported':'recorded';return 'planned';}
function group(m,today=M.today()){const w=workflow(m);if(w==='clinician_confirmed')return 'completed';if(['patient_reported','evidence_submitted','awaiting_review','recorded'].includes(w)||m.queued||m.status==='queued')return 'review';return ['overdue','week'].includes(status(m,today))?'arrange':'upcoming';}
function arrangeOrder(a,b,today=M.today()){return priority(b)-priority(a)||order(a,b,today);}
function groups(items,today=M.today()){const out={arrange:[],review:[],completed:[],upcoming:[]};for(const m of items)out[group(m,today)].push(m);out.arrange.sort((a,b)=>arrangeOrder(a,b,today));out.completed.sort((a,b)=>String(b.completed_at||'').localeCompare(String(a.completed_at||'')));return out;}
function ranked(items,ranker,today=M.today()){const base=items.slice().sort((a,b)=>arrangeOrder(a,b,today));const output=ranker?ranker(base):base;const rank=new Map(output.map((r,i)=>[r.key,i])),byKey=new Map(output.map(r=>[r.key,r]));return base.map(r=>{const saved=byKey.get(r.key);return {...r,...(saved?{ml_reason:String(saved.ml_reason||''),ml_source:saved.ml_source==='ml'?'ml':'rules'}:{})};}).sort((a,b)=>priority(b)-priority(a)||({overdue:0,week:1,upcoming:2}[status(a,today)]??3)-({overdue:0,week:1,upcoming:2}[status(b,today)]??3)||(rank.get(a.key)??999)-(rank.get(b.key)??999));}
return {category,title,status,priority,order,reason,rows,summary,workflow,group,groups,arrangeOrder,ranked};
});
