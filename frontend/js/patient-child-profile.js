/* Child-owned records inside the patient workspace; no second dashboard. */
(function(){'use strict';
const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>x?window.DaiAPI.fmtDate(x):'Not recorded';
let revision=0,active=null;
const field=(k,v)=>'<div><dt>'+E(k)+'</dt><dd>'+E(v==null||v===''?'Not recorded':v)+'</dd></div>';
const blank=t=>'<p class="icp-empty">'+E(t)+'</p>';
function pie(title,rows,center,caption){
 const total=rows.reduce((n,r)=>n+r[1],0);let cursor=0;
 const stops=rows.filter(r=>r[1]>0).map(r=>{const start=cursor;cursor+=r[1]/total*100;return r[2]+' '+start.toFixed(3)+'% '+cursor.toFixed(3)+'%';});
 return '<figure class="icp-chart"><figcaption>'+E(title)+'</figcaption><div class="icp-chart-body"><div class="icp-donut" role="img" aria-label="'+E(title+': '+rows.map(r=>r[0]+' '+r[1]).join(', '))+'" style="--icp-pie:'+(total?'conic-gradient('+stops.join(',')+')':'#e9e5f2')+'"><div><strong>'+E(center)+'</strong><span>'+E(total?'entries':'No entries')+'</span></div></div><ul class="icp-legend">'+rows.map(r=>'<li><i style="background:'+r[2]+'" aria-hidden="true"></i><span>'+E(r[0])+'</span><strong>'+r[1]+'</strong></li>').join('')+'</ul></div><p>'+E(caption)+'</p></figure>';
}
function charts(c,schedule){
 const today=window.PatientModel.today(),listed=schedule.filter(v=>v.status!=='optional'&&v.dueDate<=today),recorded=listed.filter(v=>v.givenOn).length;
 return '<section class="icp-chart-grid" aria-label="Child record charts">'+pie('Vaccine records at a glance',[['Dose recorded',recorded,'#37b5a4'],['No entry yet',listed.length-recorded,'#f4bd68']],recorded+' / '+listed.length,'Age-based schedule entries through today. Missing records do not mean a vaccine was missed.')+pie('A little collection of care',[['Growth measurements',(c.growth||[]).length,'#9a80e6'],['Vaccination entries',(c.vaccinations||[]).length,'#37b5a4'],['Milestones',(c.milestones||[]).length,'#f4bd68'],['Health notes',(c.health_events||[]).length,'#ed91aa']],(c.growth||[]).length+(c.vaccinations||[]).length+(c.milestones||[]).length+(c.health_events||[]).length,'Saved entries in this child’s record. This is a record summary, not a health score.')+'</section>';
}
function mount(host,c,options={}){
 const key=JSON.stringify([options.owner,c]);
 if(active?.host===host&&active.key===key&&host.querySelector('[data-child-profile]'))return;
 const ticket=++revision;active={host,key,id:c.id};
 const given=Object.fromEntries((c.vaccinations||[]).map(v=>[v.vaccine_code,{given_on:v.given_on}]));
 const schedule=window.AnvayaChild?.vaccineSchedule(c.date_of_birth,given,window.PatientModel.today())||[];
 const names=Object.fromEntries(schedule.map(v=>[v.code,v.name]));
 const milestones=(c.milestones||[]),events=c.health_events||[];
 host.innerHTML='<section class="inline-child-profile" data-child-profile="'+E(c.id)+'"><header class="icp-header"><div class="icp-welcome"><span class="lw-eyebrow">A LITTLE WORLD OF THEIR OWN</span><h2 tabindex="-1">'+E(c.name)+'</h2><p>'+E(window.LittleWorldModel?.age(c.date_of_birth,window.PatientModel.today())||'')+' · Records for this child only</p></div><button type="button" class="btn btn--ghost" data-icp-close>Back to my children</button><img class="icp-cartoon" src="assets/toddler-world-cartoon.png" alt="" width="230" height="230" decoding="async"></header><nav class="icp-nav" aria-label="Child profile sections">'+[['icpBirth','Birth details'],['icpVaccines','Vaccinations'],['childGrowthDevelopment','Growth & development'],['icpHistory','Milestones & history'],['icpVisits','Visits & follow-ups'],['icpReports','Reports & records']].map(([id,title])=>'<button type="button" data-icp-jump="'+id+'">'+title+'</button>').join('')+'</nav>'+charts(c,schedule)+'<div class="icp-grid"><article class="icp-card" id="icpBirth"><h3><span class="icp-heading-icon" aria-hidden="true">☀</span>Birth details</h3><dl class="icp-facts">'+field('Date of birth',fmt(c.date_of_birth))+field('Sex',c.sex)+field('Birth weight',c.birth_weight_kg!=null?c.birth_weight_kg+' kg':null)+field('Birth length',c.birth_length_cm!=null?c.birth_length_cm+' cm':null)+field('Blood group',c.blood_group)+field('Allergies',c.allergies)+'</dl>'+(c.notes?'<details><summary>Recorded profile note</summary><p>'+E(c.notes)+'</p></details>':'')+'</article><article class="icp-card" id="icpVaccines"><h3><span class="icp-heading-icon" aria-hidden="true">✦</span>Vaccinations</h3><p>Recorded doses only. A missing entry does not establish whether a vaccine was given.</p>'+(c.vaccinations?.length?'<ul class="icp-list">'+c.vaccinations.map(v=>'<li><strong>'+E(names[v.vaccine_code]||v.vaccine_code)+'</strong><span>'+E(fmt(v.given_on))+'</span></li>').join('')+'</ul>':blank('No vaccination entries recorded.'))+'<details><summary>View age-based vaccine schedule</summary><ul class="icp-list">'+schedule.map(v=>'<li><strong>'+E(v.name)+'</strong><span>'+E(v.givenOn?'Recorded · '+fmt(v.givenOn):'Listed date · '+fmt(v.dueDate))+'</span></li>').join('')+'</ul></details></article><article class="icp-card" id="icpHistory"><h3><span class="icp-heading-icon" aria-hidden="true">★</span>Milestones & history</h3>'+(milestones.length?'<ul class="icp-list">'+milestones.map(m=>'<li><strong>'+E(m.milestone_code.replaceAll('_',' '))+'</strong><span>'+E(fmt(m.achieved_on))+'</span></li>').join('')+'</ul>':blank('No achieved milestones recorded.'))+(events.length?events.map(e=>'<details><summary>'+E(e.title)+' · '+E(fmt(e.event_date))+'</summary><p>'+E(e.details||'No additional note')+'</p>'+(e.doctor_name?'<small>'+E(e.doctor_name)+'</small>':'')+'</details>').join(''):blank('No health history entries recorded.'))+'</article><article class="icp-card" id="icpVisits"><h3><span class="icp-heading-icon" aria-hidden="true">◷</span>Visits & follow-ups</h3><div data-icp-visits role="status">Loading this child’s visits…</div></article><article class="icp-card icp-wide" id="icpReports"><h3><span class="icp-heading-icon" aria-hidden="true">▤</span>Reports & records</h3><div data-icp-reports role="status">Loading this child’s reports…</div></article></div></section>';
 host.querySelector('[data-icp-close]').onclick=()=>{++revision;active=null;options.close?.();};
 host.querySelectorAll('[data-icp-jump]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.icpJump)?.scrollIntoView({behavior:'smooth',block:'start'}));
 const valid=()=>ticket===revision&&host.isConnected&&host.querySelector('[data-child-profile]')?.dataset.childProfile===String(c.id);
 async function load(){
  const [visits,docs]=await Promise.allSettled([window.DaiAPI.apiRequest('/children/'+encodeURIComponent(c.id)+'/appointments'),window.DaiAPI.apiRequest('/documents')]);
  if(!valid())return;
  const v=visits.status==='fulfilled'?visits.value:null,d=docs.status==='fulfilled'?docs.value:null;
  const vh=host.querySelector('[data-icp-visits]'),dh=host.querySelector('[data-icp-reports]');
  if(!v){vh.innerHTML=blank('Visits could not be loaded.')+'<button type="button" class="link-btn" data-icp-retry>Retry</button>';}
  else{const rows=v.appointments||[];vh.innerHTML=rows.length?'<ul class="icp-list" tabindex="0" aria-label="Recorded child visits">'+rows.map(a=>'<li><strong>'+E(a.reason||'Child visit')+'</strong><span>'+E(fmt(a.requested_date))+' · '+E(a.status)+'</span><small>'+E(a.doctor_name||'Clinician not recorded')+'</small>'+(a.doctor_notes?'<p>'+E(a.doctor_notes)+'</p>':'')+'</li>').join('')+'</ul>':blank('No visits recorded for this child.');}
  if(!d){dh.innerHTML=blank('Reports could not be loaded.')+'<button type="button" class="link-btn" data-icp-retry>Retry</button>';}
  else{const rows=(d.documents||[]).filter(r=>String(r.child_id)===String(c.id));dh.innerHTML=rows.length?'<ul class="icp-list">'+rows.map(r=>'<li><strong>'+E(r.title||r.original_name||'Child report')+'</strong><span>'+E(r.doc_type||'Report')+' · '+E(fmt(r.report_date||r.uploaded_at))+'</span><button type="button" class="link-btn" data-icp-document="'+E(r.id)+'">View report</button></li>').join('')+'</ul>':blank('No reports linked to this child. Pregnancy reports stay in your own record.');}
  host.querySelectorAll('[data-icp-retry]').forEach(b=>b.onclick=load);
  host.querySelectorAll('[data-icp-document]').forEach(b=>b.onclick=()=>window.PatientConnected?.viewReport(b.dataset.icpDocument));
 }
 if(options.guest||options.offline)host.querySelectorAll('[data-icp-visits],[data-icp-reports]').forEach(h=>h.textContent='Sign in and connect to load this child’s private records.');else void load();
}
window.PatientChildProfile={mount,reset(){++revision;active=null;}};
})();
