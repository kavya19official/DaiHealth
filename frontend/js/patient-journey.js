/* A patient-led journey through recorded care. No inferred clinical completion. */
(function () {
'use strict';
let data, prefs = {}, filter = 'all', lane = 'mother', baby, compact = false;
let scope = 'now';
let previous = new Map(), hasRendered = false, contrast = false, lowMotion = false;
const expanded = new Map();
try {
  contrast = localStorage.getItem('dai_journey_contrast') === '1';
  lowMotion = localStorage.getItem('dai_journey_simple') === '1';
} catch {}
const $ = id => document.getElementById(id), M = () => window.PatientModel, E = x => M().escape(x);
const svg = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const icons = { visits: 'clipboard', tests: 'droplet', scans: 'scan', nutrition: 'pill', vaccines: 'shield', body: 'heart', prep: 'flag' };
const labels = { completed: 'Done', overdue: 'Let’s catch up', due: 'Due soon', upcoming: 'Upcoming', queued: 'Waiting to sync', review: 'Review progress' };
const fmt = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date to confirm';
const stopId = m => 'journey-stop-' + String(m.id).replace(/[^\w-]/g, '');
function category(m) {
  if (m.child) return 'vaccines';
  const t = (m.title + ' ' + (m.guidance || '')).toLowerCase();
  return /vaccin|bcg|opv|td dose/.test(t) ? 'vaccines' : /nutrition|iron|calcium|supplement/.test(t) ? 'nutrition' : /scan|ultrasound/.test(t) ? 'scans' : /test|blood|glucose|haemoglobin|ogtt/.test(t) ? 'tests' : /birth plan|hospital|transport|bag|readiness/.test(t) ? 'prep' : /mood|breast|recovery|postnatal|pnc|mental/.test(t) ? 'body' : 'visits';
}
function plain(m) {
  const t = m.title;
  return /glucose|ogtt/i.test(t) ? 'Your sugar test' : /haemoglobin|\bhb\b/i.test(t) ? 'Your blood count check' : /anomaly/i.test(t) ? 'Your baby’s detailed scan' : /first antenatal/i.test(t) ? 'Your first pregnancy visit' : t;
}
function week(m) {
  const start = data.user.lmp_date || data.user.care_start_date;
  return start && m.due_date ? Math.max(0, Math.floor(M().days(m.due_date, start) / 7)) : null;
}
function status(m) {
  if (m.status === 'queued') return 'queued';
  if (!m.child && !m.post && (m.workflow_state === 'patient_reported' || m.workflow_state === 'awaiting_review' || (m.completion_verification && m.completion_verification !== 'verified'))) return 'review';
  const s = M().status(m);
  return s === 'upcoming' && m.due_date && M().days(m.due_date, M().today()) <= 7 ? 'due' : s;
}
function items() {
  if (lane === 'baby') {
    const c = (data.children || []).find(c => String(c.id) === String(baby)) || data.children?.[0];
    if (!c || !window.AnvayaChild) return [];
    const map = Object.fromEntries((c.vaccinations || []).map(v => [v.vaccine_code, v.given_on]));
    return AnvayaChild.vaccineSchedule(String(c.date_of_birth).slice(0, 10), map, M().today()).filter(v => !v.conditional || v.givenOn).map(v => ({ id: 'baby-' + c.id + '-' + v.code, title: v.name, category: 'vaccines', due_date: v.dueDate, status: v.status === 'completed' ? 'completed' : v.status === 'missed' ? 'overdue' : 'upcoming', guidance: 'A little protection, one visit at a time. Your vaccination centre can confirm doses and a catch-up plan.', child: c.id, birth: c.date_of_birth, given: v.givenOn, zone: 'baby' }));
  }
  const rows = (data.milestones || []).filter(m => m.category !== 'child').map(m => ({ ...m, zone: /postpartum|postnatal|pnc|recovery|post-discharge/i.test([m.stage,m.category,m.title].join(' ')) ? 'post' : week(m) < 14 ? 't1' : week(m) < 28 ? 't2' : 't3' }));
  if (data.post?.active) for (const p of data.post.schedule || []) rows.push({ id: 'post-' + p.code, title: p.title, due_date: p.window_end, guidance: p.why, status: p.status === 'done' ? 'completed' : p.status, post: true, zone: 'post' });
  return rows.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
}
const zones = [
  { id: 't1', symbol: 'seed', label: 'Little beginnings', short: 'First trimester', sub: 'Weeks 0–13', text: 'The first chapter of a very personal story.' },
  { id: 't2', symbol: 'leaf', label: 'Growing, together', short: 'Second trimester', sub: 'Weeks 14–27', text: 'Room for new questions, little movements and your next checks.' },
  { id: 't3', symbol: 'bloom', label: 'Almost time to meet', short: 'Third trimester', sub: 'Week 28 onwards', text: 'Your care team, your birth plan, your next beginning.' },
  { id: 'post', symbol: 'heart', label: 'A little care for you, too', short: 'Your recovery', sub: 'After delivery', text: 'There is room in this new chapter for your recovery and support.' },
  { id: 'baby', symbol: 'bloom', label: 'Hello, little one', short: 'Baby’s journey', sub: 'Vaccines & follow-ups', text: 'Small steps for a growing world. This baby’s records stay their own.' }
];
function plant(type) {
  const petals = type === 'bloom' ? '<g fill="currentColor" opacity=".22"><ellipse cx="60" cy="21" rx="10" ry="18"/><ellipse cx="60" cy="21" rx="10" ry="18" transform="rotate(60 60 21)"/><ellipse cx="60" cy="21" rx="10" ry="18" transform="rotate(120 60 21)"/></g><circle cx="60" cy="21" r="6" fill="currentColor"/>' : type === 'heart' ? '<path d="M60 37C32 20 43 1 60 14C77 1 88 20 60 37Z" fill="currentColor" opacity=".4"/>' : '<ellipse cx="60" cy="23" rx="8" ry="13" fill="currentColor" opacity=".4"/>';
  return '<svg viewBox="0 0 120 120" class="journey-botanical" aria-hidden="true"><path d="M24 110Q60 100 97 110M60 104Q45 73 60 36" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M56 83Q18 82 23 50Q51 50 56 83ZM56 68Q94 69 98 39Q68 37 56 68Z" fill="currentColor" opacity=".18"/><path d="M56 83L30 58M56 68L90 45" fill="none" stroke="currentColor" stroke-width="1" opacity=".4"/>' + petals + '</svg>';
}
function workflow(m) {
  if(m.child||m.post)return m.status==='completed'?'recorded':'planned';
  return m.workflow_state || (m.completion_verification==='verified'?'clinician_confirmed':m.result_id?'awaiting_review':m.completed_at?'patient_reported':'planned');
}
const flowLabels={planned:'Not yet recorded',patient_reported:'You reported done',evidence_submitted:'Evidence submitted',awaiting_review:'Awaiting clinician review',clinician_confirmed:'Reviewed by your clinician',recorded:'Completion recorded'};
function progress(m){
 const keys=['patient_reported','evidence_submitted','awaiting_review','clinician_confirmed'],at=keys.indexOf(workflow(m));
 return '<ol class="care-proof" aria-label="Evidence and review progress">'+keys.map((k,i)=>'<li class="'+(i<=at?'is-reached':'')+'"><span aria-hidden="true">'+(i<=at?'✓':i+1)+'</span>'+['Your update','Evidence','In review','Clinician review'][i]+'</li>').join('')+'</ol>';
}
function details(m,s){
 const linked=!m.child&&!m.post;
 return '<div class="stop-content"><p class="stop-guidance">'+E(m.guidance||'Discuss this recorded step with your care team.')+'</p>'+(linked?progress(m):'')+'<div class="stop-actions">'+(m.child?'<button class="btn btn--primary" data-journey-child="'+E(m.child)+'">Open baby’s record →</button>':m.post?'<button class="btn btn--primary" data-route="postpartum">Open recovery check-in →</button>':'<button class="btn btn--primary" data-step-help="'+E(m.id)+'">Help me with this step ↗</button>')+'<button class="journey-listen" data-journey-listen="'+stopId(m)+'">'+svg('speaker')+' Listen</button></div>'+(linked?'<div class="stop-secondary">'+(workflow(m)==='planned'?'<button class="link-btn" data-finish="'+E(m.id)+'">I have done this</button>':'')+(workflow(m)!=='clinician_confirmed'?'<button class="link-btn" data-step-evidence="'+E(m.id)+'">'+svg('clipboard')+' Add evidence</button>':'')+'<button class="link-btn" data-book="'+E(m.title)+'">Request visit</button></div><details class="stop-details"><summary>Details & preparation</summary><p>'+E(m.verified_facility_name?'Reviewed at '+m.verified_facility_name:'Bring your care card and previous reports. Ask your clinician about preparation.')+'</p><button class="link-btn" data-journey-questions="'+E(m.title)+'">Prepare questions</button> · <button class="link-btn" data-route="schemes">Scheme information</button></details>':'')+'</div>';
}
function card(m,index,current){
 const s=status(m),id=stopId(m),wf=workflow(m),open=expanded.has(id)?expanded.get(id):current&&!compact;
 const label=wf!=='planned'?flowLabels[wf]:labels[s];
 return '<article id="'+id+'" class="journey-stop stop-'+s+(current?' stop-current':'')+'" data-week="'+(m.child||m.post?'':week(m)??'')+'"><div class="path-node" aria-hidden="true">'+(s==='completed'?'✓':svg(icons[category(m)]||'heart'))+'</div><details class="stop-card" data-stop-expand="'+id+'" '+(open?'open':'')+'><summary class="stop-summary"><span class="stop-heading">'+(current?'<span class="you-are-here">FOCUS STEP</span>':'')+'<span class="stop-when">'+E(fmt(m.due_date))+(m.child||m.post||week(m)===null?'':' · Week '+week(m))+'</span><strong>'+E(plain(m))+'</strong>'+(m.doctor_name&&m.added_by_doctor_id?'<span class="doctor-note">From '+E(m.doctor_name)+'</span>':'')+'</span><span class="stop-status">'+(wf==='clinician_confirmed'?'✓ ':s==='overdue'?'◷ ':'○ ')+E(label)+'</span><span class="stop-chevron" aria-hidden="true">⌄</span></summary>'+details(m,s)+'</details></article>';
}
function deliveryChapter() {
  return '<aside class="delivery-chapter"><span>YOUR BIRTH CHAPTER</span><h3>Pack a little peace of mind.</h3><div><p><strong>Your hospital</strong>' + E(data.overview?.registered_facility?.name || 'Not selected yet') + '</p><p><strong>Your emergency contact</strong>' + E(data.user.emergency_contact_name || 'Not recorded yet') + '</p></div><p>Discuss your bag and transport plan with your care team. Hospital readiness is not yet confirmed here.</p><button type="button" class="link-btn" data-route="profile">Review my birth & contact details →</button></aside>';
}
function render(){
 if(!data?.user)return;const root=$('timelineList');if(!root)return;
 root.classList.add('care-timeline-v2');root.classList.toggle('journey-high-contrast',contrast);root.classList.toggle('journey-simple',lowMotion);
 const all=items(),st=M().stage(data.user,data.post,data.children),activeZone=lane==='baby'?'baby':st.delivered?'post':st.week===null?'t1':st.week<14?'t1':st.week<28?'t2':'t3';
 const inChapter=m=>m.zone===activeZone;
 const current=all.find(m=>inChapter(m)&&status(m)!=='completed'&&workflow(m)==='planned')||all.find(m=>inChapter(m)&&status(m)!=='completed');
 const shown=all.filter(m=>(scope==='all'||(scope==='history'?!inChapter(m):inChapter(m)))&&(filter==='all'||category(m)===filter||(filter==='tests'&&category(m)==='scans')));
 const confirmed=all.filter(m=>workflow(m)==='clinician_confirmed').length,review=all.filter(m=>['awaiting_review','evidence_submitted'].includes(workflow(m))).length,self=all.filter(m=>workflow(m)==='patient_reported').length;
 const percent=all.length?Math.round(confirmed/all.length*100):0;
 const connection=document.documentElement.dataset.daiTimelineConnectionState==='live'?'Live updates':'Refresh available';
 root.innerHTML='<header class="ct-hero"><div><span class="journey-eyebrow">YOUR CARE, CONNECTED</span><h2>A clearer next step.</h2><p>'+E(lane==='baby'?'Separate care. For each little one.':st.label)+'</p><div class="journey-view-switch"><button data-journey-lane="mother" aria-pressed="'+(lane==='mother')+'">'+svg('heart')+' Mother</button><button data-journey-lane="baby" aria-pressed="'+(lane==='baby')+'" '+(!data.children?.length?'disabled':'')+'>'+svg('baby')+' Baby</button></div></div><div class="ct-overview"><div class="ct-ring" style="--care-progress:'+percent+'%"><strong>'+confirmed+'<small>clinician reviewed</small></strong></div><div><span class="ct-live" data-timeline-connection>'+connection+'</span><dl><div><dt>Your updates</dt><dd>'+self+'</dd></div><div><dt>In review</dt><dd>'+review+'</dd></div><div><dt>Recorded steps</dt><dd>'+all.length+'</dd></div></dl></div></div></header>'+
 '<div class="ct-controls"><div class="ct-scopes" role="group" aria-label="Care chapters">'+[['now','Current chapter'],['history','Earlier care'],['all','All steps']].map(([k,v])=>'<button data-step-scope="'+k+'" aria-pressed="'+(scope===k)+'">'+v+'</button>').join('')+'</div><details class="journey-options"><summary>Display & export</summary><div><button data-journey-recap>Save my journey</button><button data-journey-compact>Expand / collapse focus</button><button data-journey-contrast aria-pressed="'+contrast+'">High contrast</button><button data-journey-simple aria-pressed="'+lowMotion+'">Low bandwidth</button></div></details></div>'+
 (lane==='baby'?'<div class="journey-baby-tabs" aria-label="Choose a baby">'+(data.children||[]).map((c,i)=>'<button data-journey-baby="'+E(c.id)+'" aria-pressed="'+(String(baby||data.children[0].id)===String(c.id))+'">'+E(/^CHILD-SYN-/.test(c.name)?'Baby '+(i+1):c.name)+'</button>').join('')+'</div>':'')+
 '<div class="journey-filters" role="group" aria-label="Timeline filters">'+[['all','All'],['visits','Visits'],['tests','Tests & scans'],['nutrition','Nutrition'],['vaccines','Vaccines'],['body','Recovery'],['prep','Birth preparation']].map(([k,v])=>'<button data-journey-filter="'+k+'" aria-pressed="'+(filter===k)+'">'+v+'</button>').join('')+'</div><div class="ct-layout"><section class="ct-records"><div class="ct-section-head"><div><span class="journey-eyebrow">'+(scope==='history'?'YOUR EARLIER RECORDS':'YOUR RECORDED PLAN')+'</span><h3>'+E(scope==='history'?'Earlier care':scope==='all'?'The whole picture':zones.find(z=>z.id===activeZone)?.short||'Current care')+'</h3></div><span>'+shown.length+' steps</span></div><div class="ct-step-list">'+(shown.map((m,i)=>card(m,i,current&&String(current.id)===String(m.id))).join('')||'<div class="journey-empty">'+svg('clipboard')+'<h3>No steps in this view</h3><button data-step-scope="all">View all recorded steps →</button></div>')+'</div></section><aside class="ct-rail"><section class="ct-focus"><span class="journey-eyebrow">ONE STEP AT A TIME</span><div class="ct-focus-icon">'+svg(current?icons[category(current)]:'shield')+'</div><h3>'+E(current?plain(current):'Your next chapter')+'</h3><p>'+E(current?fmt(current.due_date):'Your care team can help plan what comes next.')+'</p>'+(current?'<button class="btn btn--primary" data-journey-current>Go to this step ↗</button>':'<button class="btn btn--primary" data-route="appointments">Request a visit</button>')+'</section><section class="ct-proof-guide"><span class="journey-eyebrow">HOW REVIEW WORKS</span><h3>Every update has a source.</h3><ol><li><b>01</b><span><strong>You report done</strong><small>Your update, in your words.</small></span></li><li><b>02</b><span><strong>You add evidence</strong><small>A report linked to this step.</small></span></li><li><b>03</b><span><strong>Awaiting review</strong><small>Share with your care team.</small></span></li><li><b>04</b><span><strong>Clinician reviews</strong><small>Only an authorised clinician.</small></span></li></ol><button class="link-btn" data-route="records">My reports & records →</button></section></aside></div><footer class="journey-trust">'+svg('shield')+' Your update and clinician review are separate. Your clinician interprets results. · Synthetic demo</footer>';
 for(const m of all){const wf=workflow(m);if(hasRendered&&previous.has(String(m.id))&&previous.get(String(m.id))!=='clinician_confirmed'&&wf==='clinician_confirmed')window.DaiAPI?.toast('Your clinician reviewed a care step.');previous.set(String(m.id),wf);}hasRendered=true;
}

function listen(id) {
  if (!window.speechSynthesis) return window.DaiAPI.toast('Read-aloud is unavailable in this browser.');
  speechSynthesis.cancel();
  const lang = document.documentElement.lang || 'en', voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(lang));
  if (!voice && lang !== 'en') return DaiAPI.toast('Install a device voice for this language, or choose English.');
  const m = items().find(m => stopId(m) === id), u = new SpeechSynthesisUtterance(m ? plain(m) + '. ' + fmt(m.due_date) + '. ' + labels[status(m)] + '. ' + (m.guidance || '') : '');
  u.lang = voice?.lang || 'en-IN'; if (voice) u.voice = voice; speechSynthesis.speak(u);
}
function recap() {
  const text = ['DAI · My recorded care journey', 'Synthetic demonstration', ...items().map(m => fmt(m.due_date) + ' · ' + plain(m) + ' · ' + status(m)), 'Completion reflects recorded events; it is not clinical clearance.'].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' })), a = document.createElement('a');
  a.href = url; a.download = 'dai-my-care-journey.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function openEvidence(id){
 window.PatientExperience?.route('records');document.querySelector('[data-panel="records"]')?.click();
 const subject=$('docSubject');if(subject){subject.value='';subject.dispatchEvent(new Event('change',{bubbles:true}));}const select=$('docMilestone');if(select){select.disabled=false;select.value=id;}const upload=$('connectedUploadDetails');if(upload)upload.open=true;
 $('docTitle')?.focus();$('docUploadForm')?.scrollIntoView({block:'center',behavior:'smooth'});
}
async function openHelp(id,opener){
 const dialog=document.createElement('dialog');dialog.className='ct-help-dialog';dialog.setAttribute('aria-label','Help with this care step');
 dialog.innerHTML='<button class="ct-dialog-close" aria-label="Close help">×</button><div data-help-content role="status">Preparing your step…</div>';document.body.appendChild(dialog);
 dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{dialog.remove();opener?.focus();});dialog.showModal();
 const result=await DaiAPI.apiRequest('/patient/timeline/'+encodeURIComponent(id)+'/assist',{method:'POST'});if(!dialog.open)return;
 const host=dialog.querySelector('[data-help-content]');
 if(!result){host.innerHTML='<h2>Let’s try another way</h2><p>You can still request a visit or upload a report.</p><button class="btn" data-book="'+E(items().find(m=>String(m.id)===id)?.title||'Care follow-up')+'">Request a visit</button>';return;}
 host.innerHTML='<span class="journey-eyebrow">DHRUV · GUIDED HELP</span><h2>'+E(result.title)+'</h2><p>'+E(result.explanation)+'</p><div class="ct-agent-tools"><span>✓ Read your step</span><span>✓ Checked listed services</span><span>✓ Prepared questions</span></div><section><h3>Questions to take with you</h3><ul>'+result.questions.map(q=>'<li>'+E(q)+'</li>').join('')+'</ul></section><section><h3>Centres listing this service</h3>'+ (result.facilities.map(f=>'<article><strong>'+E(f.name)+'</strong><p>'+E(f.reason)+(f.verified_at?' Last confirmed '+E(fmt(f.verified_at))+'.':'')+'</p><small>'+E(f.address)+'</small></article>').join('')||'<p>No matching service is recorded. Use Nearby care to check with a centre.</p>')+'</section><div class="ct-draft"><span class="journey-eyebrow">READY FOR YOUR REVIEW</span><h3>Appointment request draft</h3><p>'+E(result.draft.reason)+'</p><p>'+E(result.notice)+'</p><button class="btn btn--primary" data-help-draft>Review request →</button></div>';
 host.querySelector('[data-help-draft]').onclick=()=>{dialog.close();if(window.PatientConnected?.prepareVisit){window.PatientConnected.prepareVisit(result.title,result.questions);return;}document.querySelector('[data-panel="appointments"]')?.click();const input=$('apptNotes');if(input){input.value=result.draft.reason+'\nQuestions: '+result.questions.join(' ');input.focus();}DaiAPI.toast('Draft prepared. Choose a doctor and date, then confirm the request.');};
}
function scrollTo(el) { el?.scrollIntoView({ behavior: lowMotion || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); }
document.addEventListener('toggle', e => {
  const id = e.target.dataset?.stopExpand;
  if (id) expanded.set(id, e.target.open);
}, true);
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.stepScope) { scope=b.dataset.stepScope; render(); }
  if (b.dataset.stepHelp) openHelp(b.dataset.stepHelp,b);
  if (b.dataset.stepEvidence) openEvidence(b.dataset.stepEvidence);
  if (b.dataset.journeyFilter) { filter = b.dataset.journeyFilter; render(); }
  if (b.dataset.journeyLane) { lane = b.dataset.journeyLane; filter = 'all'; render(); }
  if (b.dataset.journeyBaby) { baby = b.dataset.journeyBaby; render(); }
  if (b.hasAttribute('data-journey-compact')) { compact = !compact; expanded.clear(); render(); }
  if (b.dataset.journeyListen) listen(b.dataset.journeyListen);
  if (b.hasAttribute('data-journey-recap')) recap();
  if (b.hasAttribute('data-journey-contrast')) { contrast = !contrast; localStorage.setItem('dai_journey_contrast', contrast ? '1' : '0'); render(); }
  if (b.hasAttribute('data-journey-simple')) { lowMotion = !lowMotion; localStorage.setItem('dai_journey_simple', lowMotion ? '1' : '0'); render(); }
  if (b.dataset.journeyChild) { localStorage.setItem('dai_active_child', b.dataset.journeyChild); location.href = 'child-dashboard.html'; }
  if (b.dataset.journeyQuestions) window.PatientExperience.askDaya('What should I ask my doctor about ' + b.dataset.journeyQuestions + '?');
  if (b.dataset.journeyChapter) scrollTo($('journey-zone-' + b.dataset.journeyChapter));
  if (b.hasAttribute('data-journey-current')) {
    const current = document.querySelector('.stop-current');
    if (!current) return window.DaiAPI.toast('No next step is recorded in this view. Try All steps.');
    const detail = current.querySelector('[data-stop-expand]'); if (detail) detail.open = true;
    scrollTo(current);
  }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'journeyWeek') return;
  const w = Number(e.target.value); $('journeyWeekValue').textContent = w;
  const stops = Array.from(document.querySelectorAll('.journey-stop[data-week]')).filter(x => x.dataset.week !== '');
  const target = stops.sort((a, b) => Math.abs(Number(a.dataset.week) - w) - Math.abs(Number(b.dataset.week) - w))[0];
  target?.scrollIntoView({ behavior: 'instant', block: 'center' });
});
window.PatientJourney = { update(next, p) { data = next; prefs = p; render(); }, category };
})();
