/* Deterministic presentation rules. No diagnosis or automated risk labels. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PatientModel=factory();})(typeof window!=='undefined'?window:this,function(){
'use strict';
const day=86400000;
const iso=d=>new Date(d).toISOString().slice(0,10);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
const days=(a,b)=>Math.floor((Date.parse(String(a).slice(0,10)+'T00:00:00Z')-Date.parse(String(b).slice(0,10)+'T00:00:00Z'))/day);
function stage(user={},post={},children=[],date=today()){
 if(post.active&&post.delivery?.date){const n=Math.max(0,days(date,post.delivery.date));return {label:n<=365?'Postpartum, day '+n:'Child care',detail:n<=42?'Recovery and postnatal follow-up':'Recovery and child care',progress:Math.min(100,n/42*100),delivered:true,edd:null,week:null};}
 if(user.pregnancy_status==='delivered'||(!user.lmp_date&&!user.care_start_date&&children.length)){const birth=children[0]?.date_of_birth;return {label:birth?'Child care · '+Math.max(0,days(date,birth))+' days old':'After delivery',detail:'Your recovery and each child’s care',progress:100,delivered:true,edd:null,week:null};}
 const start=user.lmp_date||user.care_start_date;const n=start?days(date,start):NaN;const w=Number.isFinite(n)?Math.max(0,Math.floor(n/7)):null;
 if(user.pregnancy_status==='planning'||w===null)return {label:'Your care journey',detail:'Add your pregnancy dates in profile',progress:0,delivered:false,edd:null,week:null};
 return {label:'Pregnancy, week '+w,detail:(w<14?'1st':w<28?'2nd':'3rd')+' trimester',progress:Math.min(100,w/40*100),delivered:false,edd:user.edd_date||iso(Date.parse(String(start).slice(0,10)+'T00:00:00Z')+280*day),week:w};
}
function status(m,date=today()){if(m.status==='completed'||m.status==='done')return 'completed';if(m.queued)return 'queued';return m.due_date&&String(m.due_date).slice(0,10)<date?'overdue':'upcoming';}
function gaps(items,st,date=today()){return items.filter(m=>status(m,date)!=='completed'&&(!st.delivered||/post|pnc|child|baby|breast|recovery/i.test([m.category,m.stage,m.title].join(' ')))).sort((a,b)=>(status(a,date)==='overdue'?0:1)-(status(b,date)==='overdue'?0:1)||String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')));}
function upcoming(a,date=today()){return ['pending','confirmed'].includes(a.status)&&String(a.requested_date).slice(0,10)>=date;}
function escape(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
return {today,days,stage,status,gaps,upcoming,escape};
});
