/* Presentation of existing authorised records. No clinical inference. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./doctor-dashboard-model'));else root.DoctorPagesModel=factory(root.DoctorDashboardModel);})(typeof window!=='undefined'?window:this,function(DM){
'use strict';
const add=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const date=x=>String(x||'').slice(0,10);
const same=(a,b)=>String(a)===String(b);
function children(d){return DM.childRecords(d).map(c=>({...c,isChild:true,key:'child-'+c.id,clinical_shared:false}));}
function dueItems(d,p){return p.isChild?p.appointments.filter(a=>['confirmed','pending'].includes(a.status)).map(a=>({due_date:a.requested_date,title:a.reason||'Follow-up'})):(d.milestones||[]).filter(m=>same(m.mother_id,p.id)&&m.category!=='child'&&!m.completed_at).concat(!p.stage?.delivered&&p.edd?[{due_date:p.edd,title:'Expected delivery'}]:[]);}
function due14(d,p){return dueItems(d,p).some(m=>date(m.due_date)>=d.date&&date(m.due_date)<=add(d.date,14));}
function sourceRows(d,mode,filter){return mode==='child'||filter==='newborn'?children(d):(d.patients||[]).map(p=>({...p,key:'mother-'+p.id}));}
function matches(d,p,filter){if(filter==='high-risk')return !!p.clinicianRisk;if(filter==='due14')return due14(d,p);if(filter==='postpartum')return p.isChild?!!d.patients.find(m=>same(m.id,p.parent_id))?.stage?.delivered:!!p.stage?.delivered;if(filter==='overdueHb')return !p.isChild&&(d.worklist||[]).some(w=>same(w.patient_id,p.id)&&/haemoglobin|\bhb\b/i.test(w.title));if(filter==='missed')return (d.queue||[]).some(q=>q.state==='no_show'&&pAppointments(d,p).some(a=>same(q.appointment_id,a.id)));return true;}
function pAppointments(d,p){return p.isChild?p.appointments:(d.appointments||[]).filter(a=>same(a.mother_id,p.id)&&a.child_id==null);}
function rows(d,mode,f={}){const q=(f.search||'').toLowerCase().trim();return sourceRows(d,mode,f.filter).filter(p=>matches(d,p,f.filter)&&(!f.stage||DM.maternalGroup(p)===f.stage)&&(!f.unit||p.unit===f.unit)&&(!f.language||p.preferred_language===f.language)&&(!f.open||Number(p.open_items)>0)&&(!f.min||Number.isFinite(p.stage?.week)&&p.stage.week>=Number(f.min))&&(!f.max||Number.isFinite(p.stage?.week)&&p.stage.week<=Number(f.max))&&(!q||[p.name,p.parent_name,p.uhid,p.abha,p.phone,p.id].some(v=>String(v??'').toLowerCase().includes(q)))).sort((a,b)=>f.sort==='gaps'?(b.open_items||0)-(a.open_items||0):f.sort==='edd'?String(a.edd||'9999').localeCompare(String(b.edd||'9999')):a.name.localeCompare(b.name));}
function stage(p){return p.isChild?'unstaged':DM.maternalGroup(p)||'unstaged';}
function twins(p){return ['twins',2,'2'].includes(p.plurality);}
function queue(d,a){const q=(d.queue||[]).find(q=>same(q.appointment_id,a.id));return {state:a.status==='cancelled'?'cancelled':q?.state||({completed:'done',pending:'requested',confirmed:'booked'}[a.status]||'unknown'),version:Number(q?.version||0),confirmed:a.status==='completed',reported:a.patient_reported_done===true};}
function appointments(d,mode){return (d.appointments||[]).filter(a=>mode==='child'?a.child_id!=null:a.child_id==null).sort((a,b)=>date(a.requested_date).localeCompare(date(b.requested_date))||String(a.requested_time||'99').localeCompare(String(b.requested_time||'99')));}
function blocks(d,mode,day){const week=new Date(day+'T12:00:00Z').toLocaleDateString('en',{weekday:'long'}),u=d.doctor?.unit,out=[];
 if(mode==='maternal'&&u)for(const [field,title,type] of [['anc_day','ANC OPD','opd'],['gynae_day','Gynae OPD','opd'],['ot_day','Unit OT day','ot']])if(u[field]===week)out.push({type,title,room:type==='ot'?null:u.room||null,time:null,note:type==='ot'?'Recurring unit allocation, not a theatre booking.':'Recorded unit day; individual times are not provided.'});
 for(const c of d.hospital?.clinics||[]){const wd=typeof c.day==='number'?['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][c.day]:c.day;if(wd!==week||mode==='child'&&!/pa?ediatr|neonat|immuni|newborn|nicu/i.test(c.name))continue;out.push({type:'clinic',title:c.name,room:c.room,time:c.start_time?.slice(0,5)||null,end:c.end_time?.slice(0,5)||null,note:'Recorded special clinic.'});}
 for(const a of appointments(d,mode).filter(a=>date(a.requested_date)===day&&a.status!=='cancelled'))out.push({type:'booked',title:a.child_id!=null?'Child #'+a.child_id:(d.patients||[]).find(p=>same(p.id,a.mother_id))?.name||'Assigned patient',time:a.requested_time?.slice(0,5)||null,appointment:a,room:a.room||null,note:a.reason||'Recorded appointment'});
 for(const r of d.hospital?.roster||[])if(date(r.roster_date)===day&&same(r.name,d.doctor.name))out.push({type:'shift',title:'Scheduled shift',time:r.start_time?.slice(0,5)||null,end:r.end_time?.slice(0,5)||null,note:'Scheduled, presence not confirmed.'});return out;
}
function minutes(time){if(!/^\d{2}:\d{2}$/.test(time||''))return null;return Number(time.slice(0,2))*60+Number(time.slice(3));}
return {add,date,rows,children,dueItems,due14,pAppointments,stage,twins,queue,appointments,blocks,minutes};
});
