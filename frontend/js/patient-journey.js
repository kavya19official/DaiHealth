/* A patient-led journey through recorded care. No inferred clinical completion. */
(function () {
'use strict';
let data, prefs = {}, filter = 'all', lane = 'mother', baby, compact = false;
let scope = 'now', roadObserver, roadFrame, windowStart=0;
const WINDOW_SIZE=40;
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
function workflow(m) {
  if(m.child||m.post)return m.status==='completed'?'recorded':'planned';
  return m.workflow_state || (m.completion_verification==='verified'?'clinician_confirmed':m.result_id?'awaiting_review':m.completed_at?'patient_reported':'planned');
}
const flowLabels={planned:'Not yet recorded',patient_reported:'You reported done',evidence_submitted:'Evidence submitted',awaiting_review:'Awaiting clinician review',clinician_confirmed:'Reviewed by your clinician',recorded:'Completion recorded'};
function progress(m){
 const keys=['patient_reported','evidence_submitted','awaiting_review','clinician_confirmed'],at=keys.indexOf(workflow(m));
 return '<ol class="care-proof" aria-label="Evidence and review progress">'+keys.map((k,i)=>'<li class="'+(i<=at?'is-reached':'')+'"><span aria-hidden="true">'+(i<=at?'✓':i+1)+'</span>'+['Your update','Evidence','In review','Clinician review'][i]+'</li>').join('')+'</ol>';
}
function provenance(m){const w=workflow(m);return m.post?'From recorded delivery date':m.child?'This baby’s recorded schedule':w==='clinician_confirmed'?'Clinician reviewed'+(m.verified_facility_name?' · '+m.verified_facility_name:''):w==='awaiting_review'?'Uploaded evidence · awaiting review':w==='patient_reported'?'Patient reported · not clinician verified':m.added_by_doctor_id?'Added by your clinician':'From your recorded care plan';}
function details(m,s){
 const linked=!m.child&&!m.post;
 return '<div class="stop-content"><p class="road-provenance">'+svg('shield')+E(provenance(m))+'</p><p class="stop-guidance">'+E(m.guidance||'Discuss this recorded step with your care team.')+'</p><button type="button" class="link-btn" data-step-explain="'+E(m.id)+'">'+(document.documentElement.lang==='hi'?'आसान भाषा में समझें':'Explain in simple words')+'</button>'+(linked?progress(m):'')+'<div class="stop-actions">'+(m.child?'<button class="btn btn--primary" data-journey-child="'+E(m.child)+'">Open baby’s record →</button>':m.post?'<button class="btn btn--primary" data-route="postpartum">Open recovery check-in →</button>':'<button class="btn btn--primary" data-step-help="'+E(m.id)+'">Help me with this step ↗</button>')+'<button class="journey-listen" data-journey-listen="'+stopId(m)+'">'+svg('speaker')+' Listen</button></div>'+(linked?'<div class="stop-secondary">'+(workflow(m)==='planned'?'<button class="link-btn" data-finish="'+E(m.id)+'">I have done this</button>':'')+(workflow(m)!=='clinician_confirmed'?'<button class="link-btn" data-step-evidence="'+E(m.id)+'">'+svg('clipboard')+' Add evidence</button>':'')+'<button class="link-btn" data-book="'+E(m.title)+'">Request visit</button></div><details class="stop-details"><summary>Details & preparation</summary><p>'+E(m.verified_facility_name?'Reviewed at '+m.verified_facility_name:'Bring your care card and previous reports. Ask your clinician about preparation.')+'</p><button class="link-btn" data-journey-questions="'+E(m.title)+'">Prepare questions</button> · <button class="link-btn" data-route="schemes">Scheme information</button></details>':'')+'</div>';
}
function recordChart(all){
 const counts=[all.filter(m=>workflow(m)==='clinician_confirmed').length,all.filter(m=>['evidence_submitted','awaiting_review'].includes(workflow(m))).length,all.filter(m=>workflow(m)==='patient_reported').length];
 counts.push(all.length-counts.reduce((a,b)=>a+b,0));
 const names=['Clinician reviewed','Awaiting review','Your updates','Other recorded steps'],colours=['var(--brand)','var(--brand-mid,#b39bd8)','var(--ct-amber,#d4ae65)','var(--brand-soft)'];
 let cursor=0;const slices=counts.map((n,i)=>{const from=cursor;cursor+=all.length?n/all.length*100:0;return colours[i]+' '+from+'% '+cursor+'%';});
 return '<div class="ct-chart" role="img" aria-label="'+E(counts.map((n,i)=>names[i]+': '+n).join(', '))+'" style="--ct-chart:'+ (all.length?'conic-gradient('+slices.join(',')+')':'var(--brand-soft)')+'"><div><strong>'+all.length+'</strong><small>recorded steps</small></div></div><div class="ct-chart-legend">'+names.map((label,i)=>'<div><i style="background:'+colours[i]+'"></i><span>'+label+'</span><strong>'+counts[i]+'</strong></div>').join('')+'</div>';
}
function card(m,index,current){
 const s=status(m),id=stopId(m),wf=workflow(m),open=expanded.has(id)?expanded.get(id):current&&!compact;
 const label=wf!=='planned'?flowLabels[wf]:labels[s];
 return '<article id="'+id+'" class="journey-stop stop-'+s+(current?' stop-current':'')+' road-stop road-stop-'+(index%2?'right':'left')+'" data-week="'+(m.child||m.post?'':week(m)??'')+'"><span class="road-node" aria-hidden="true">'+(wf==='clinician_confirmed'?'✓':String(index+1).padStart(2,'0'))+'</span><details class="stop-card" data-stop-expand="'+id+'" '+(open?'open':'')+'><summary class="stop-summary"><span class="road-card-top"><span class="road-type">'+svg(icons[category(m)]||'heart')+E(m.child?'Baby’s care':m.post?'Recovery':category(m).replace('body','Recovery'))+'</span><span class="road-date">'+E(fmt(m.due_date))+'</span></span>'+(current?'<span class="you-are-here">YOUR NEXT STOP</span>':'')+'<span class="road-title">'+E(plain(m))+'</span><span class="road-card-bottom"><span class="stop-status">'+(wf==='clinician_confirmed'?'✓ ':s==='overdue'?'◷ ':'○ ')+E(label)+'</span><span class="road-open" aria-hidden="true">↗</span></span>'+(m.doctor_name&&m.added_by_doctor_id?'<span class="doctor-note">From '+E(m.doctor_name)+'</span>':'')+'</summary>'+details(m,s)+'</details></article>';
}
function roadGeometry(width,points){
 if(!points.length)return '';const x=points[0].x,first=points[0].y;
 let d='M '+x+' '+Math.max(0,first-72)+' L '+x+' '+first;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],bend=(i%2?1:-1)*Math.min(48,width*.055),dy=(b.y-a.y)*.45;d+=' C '+(x+bend)+' '+(a.y+dy)+', '+(x-bend)+' '+(b.y-dy)+', '+x+' '+b.y;}
 return d+' L '+x+' '+(points.at(-1).y+72);
}
function drawRoad(){
 const canvas=$('careRoadway'),track=canvas?.querySelector('.road-track');if(!canvas||!track||!canvas.getBoundingClientRect)return;
 const box=canvas.getBoundingClientRect();if(!box.width)return;
 const points=Array.from(canvas.querySelectorAll('.road-node')).map(node=>{const r=node.getBoundingClientRect();return{x:r.left-box.left+r.width/2,y:r.top-box.top+r.height/2};});
 const height=Math.max(canvas.scrollHeight,box.height);track.setAttribute('viewBox','0 0 '+box.width+' '+height);track.setAttribute('height',height);
 const d=roadGeometry(box.width,points);track.querySelectorAll('path').forEach(p=>p.setAttribute('d',d));
 window.dispatchEvent?.(new CustomEvent('dai:timeline-road-ready',{detail:{key:[lane,baby,scope,filter,windowStart].join('|')}}));
}
function scheduleRoad(){if(typeof requestAnimationFrame!=='function')return;cancelAnimationFrame(roadFrame);roadFrame=requestAnimationFrame(drawRoad);}
function observeRoad(){
 roadObserver?.disconnect();const canvas=$('careRoadway');if(!canvas)return;
 if(window.ResizeObserver){roadObserver=new ResizeObserver(scheduleRoad);roadObserver.observe(canvas);canvas.querySelectorAll('.road-stop').forEach(n=>roadObserver.observe(n));}
 scheduleRoad();
}
function render(){
 if(!data?.user)return;const root=$('timelineList');if(!root)return;
 root.classList.add('care-timeline-v2','care-roadway');root.classList.toggle('journey-high-contrast',contrast);root.classList.toggle('journey-simple',lowMotion);
 const all=items(),st=M().stage(data.user,data.post,data.children),activeZone=lane==='baby'?'baby':st.delivered?'post':st.week===null?'t1':st.week<14?'t1':st.week<28?'t2':'t3';
 const inChapter=m=>m.zone===activeZone;
 const current=all.find(m=>inChapter(m)&&status(m)!=='completed'&&workflow(m)==='planned')||all.find(m=>inChapter(m)&&status(m)!=='completed');
 const matches=all.filter(m=>(scope==='all'||(scope==='history'?!inChapter(m):inChapter(m)))&&(filter==='all'||category(m)===filter||(filter==='tests'&&category(m)==='scans')));
 windowStart=Math.min(windowStart,Math.max(0,Math.floor((matches.length-1)/WINDOW_SIZE)*WINDOW_SIZE));const shown=matches.slice(windowStart,windowStart+WINDOW_SIZE);
 const connection=document.documentElement.dataset.daiTimelineConnectionState==='live'?'Live updates':'Refresh available';
 const chapters=zones.filter(z=>shown.some(m=>m.zone===z.id));let index=windowStart;
 root.innerHTML='<header class="road-header"><div><span class="journey-eyebrow">MY CARE</span><h2>Your care timeline<span aria-hidden="true">.</span></h2><p>A little guidance at every turn.</p></div><div class="road-header-tools"><button type="button" class="road-jump" data-step-explorer>Explore dates ↔</button><span class="ct-live" data-timeline-connection>'+connection+'</span><details class="journey-options"><summary aria-label="Timeline display and export options">•••</summary><div><button data-journey-recap>Save my journey</button><button data-timeline-history>Event history & verification</button><button data-timeline-fhir>Download FHIR-aligned export</button><button data-timeline-share>Create / revoke summary QR</button><button data-journey-compact>Expand / collapse next stop</button><button data-journey-contrast aria-pressed="'+contrast+'">High contrast</button><button data-journey-simple aria-pressed="'+lowMotion+'">Low bandwidth</button></div></details></div></header>'+
 '<section class="road-boarding"><div class="road-stage-icon">'+svg(lane==='baby'?'baby':'heart')+'</div><div class="road-stage-copy"><span>YOUR CURRENT CHAPTER</span><strong>'+E(lane==='baby'?'Each baby, their own journey':st.label)+'</strong></div><div class="journey-view-switch"><button data-journey-lane="mother" aria-pressed="'+(lane==='mother')+'">'+svg('heart')+' Mother</button><button data-journey-lane="baby" aria-pressed="'+(lane==='baby')+'" '+(!data.children?.length?'disabled':'')+'>'+svg('baby')+' Baby</button></div></section>'+
 '<div class="road-toolbar"><div class="ct-scopes" role="group" aria-label="Care chapters">'+[['now','Current chapter'],['history','Earlier care'],['all','All steps']].map(([k,v])=>'<button data-step-scope="'+k+'" aria-pressed="'+(scope===k)+'">'+v+'</button>').join('')+'</div>'+(current?'<button class="road-jump" data-journey-current>'+svg('flag')+' Next stop ↓</button>':'')+'</div>'+
 (lane==='baby'?'<div class="journey-baby-tabs" aria-label="Choose a baby">'+(data.children||[]).map((c,i)=>'<button data-journey-baby="'+E(c.id)+'" aria-pressed="'+(String(baby||data.children[0].id)===String(c.id))+'">'+E(/^CHILD-SYN-/.test(c.name)?'Baby '+(i+1):c.name)+'</button>').join('')+'</div>':'')+
 '<div class="journey-filters" role="group" aria-label="Timeline filters">'+[['all','All stops'],['visits','Visits'],['tests','Tests & scans'],['nutrition','Nutrition'],['vaccines','Vaccines'],['body','Recovery'],['prep','Birth preparation']].map(([k,v])=>'<button data-journey-filter="'+k+'" aria-pressed="'+(filter===k)+'">'+(icons[k]?svg(icons[k]):svg('clipboard'))+v+'</button>').join('')+'</div>'+
 '<div class="road-context"><span>'+matches.length+' recorded '+(matches.length===1?'step':'steps')+(matches.length>WINDOW_SIZE?' · showing '+(windowStart+1)+'–'+(windowStart+shown.length):'')+'</span><span>Tap a stop to open it '+svg('arrow')+'</span></div><div id="careRoadway" class="road-canvas"><svg class="road-track" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 1000 1000"><path class="road-edge" d="M500 0 V1000"/><path class="road-surface" d="M500 0 V1000"/><path class="road-markings" d="M500 0 V1000"/></svg>'+
 chapters.map(z=>'<section class="road-chapter" aria-label="'+E(z.short)+'"><header class="road-chapter-title"><span>'+svg(z.id==='baby'?'baby':z.id==='post'?'heart':'flag')+'</span><div><h3>'+E(z.short)+'</h3><small>'+E(z.sub)+'</small></div>'+(z.id===activeZone?'<span class="road-here">You are here</span>':'')+'</header>'+shown.filter(m=>m.zone===z.id).map(m=>card(m,index++,current&&String(current.id)===String(m.id))).join('')+'</section>').join('')+
 (!shown.length?'<div class="journey-empty">'+svg('clipboard')+'<h3>No stops in this view</h3><p>Your other recorded steps are still here.</p><button data-step-scope="all">View all recorded steps →</button></div>':'<div class="road-end"><span aria-hidden="true">'+svg('heart')+'</span><strong>Care continues, together.</strong><small>Your next steps appear when recorded.</small></div>')+'</div>'+
 (matches.length>WINDOW_SIZE?'<nav class="road-pages" aria-label="Timeline record pages"><button data-road-page="previous" '+(!windowStart?'disabled':'')+'>← Earlier stops</button><span>'+(windowStart+1)+'–'+(windowStart+shown.length)+' / '+matches.length+'</span><button data-road-page="next" '+(windowStart+WINDOW_SIZE>=matches.length?'disabled':'')+'>More stops →</button></nav>':'')+
 '<details class="road-overview"><summary><span>'+svg('clipboard')+' Your recorded progress</span><span>View breakdown +</span></summary><div class="road-chart-body">'+recordChart(all)+'</div></details><details class="ct-proof-guide"><summary>How your care is reviewed <span aria-hidden="true">＋</span></summary><p>Your update → Evidence submitted → Awaiting review → Clinician review.</p><button class="link-btn" data-route="records">My reports & records →</button></details><footer class="journey-trust">'+svg('shield')+' Your update and clinician review are separate. Your clinician interprets results. · Synthetic demo</footer>';
 observeRoad();window.dispatchEvent?.(new Event('dai:timeline-rendered'));for(const m of all){const wf=workflow(m);if(hasRendered&&previous.has(String(m.id))&&previous.get(String(m.id))!=='clinician_confirmed'&&wf==='clinician_confirmed')window.dispatchEvent?.(new CustomEvent('dai:timeline-reviewed',{detail:{id:m.id}}));previous.set(String(m.id),wf);}hasRendered=true;
}

function listen(id) {
  const selected=items().find(m=>stopId(m)===id);if(window.TimelineTools&&selected)return TimelineTools.listen(selected);
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
 if(data?.user?.guest||data?.offline||!navigator.onLine){window.DaiAPI?.toast('Sign in and connect for record-specific help. The saved timeline and prepared explanations remain available.');return;}
 const dialog=document.createElement('dialog');dialog.className='ct-help-dialog';dialog.setAttribute('aria-label','Help with this care step');
 dialog.innerHTML='<button class="ct-dialog-close" aria-label="Close help">×</button><div data-help-content role="status">Preparing your step…</div>';document.body.appendChild(dialog);
 dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{dialog.remove();opener?.focus();});dialog.showModal();
 const result=await DaiAPI.apiRequest('/patient/timeline/'+encodeURIComponent(id)+'/assist',{method:'POST'});if(!dialog.open)return;
 const host=dialog.querySelector('[data-help-content]');
 if(!result){host.innerHTML='<h2>Let’s try another way</h2><p>You can still request a visit or upload a report.</p><button class="btn" data-book="'+E(items().find(m=>String(m.id)===id)?.title||'Care follow-up')+'">Request a visit</button>';return;}
 host.innerHTML='<span class="journey-eyebrow">DHRUV · GUIDED HELP</span><h2>'+E(result.title)+'</h2><p>'+E(result.explanation)+'</p><div class="ct-agent-tools"><span>✓ Read your step</span><span>✓ Checked listed services</span><span>✓ Prepared questions</span></div><section><h3>Questions to take with you</h3><ul>'+result.questions.map(q=>'<li>'+E(q)+'</li>').join('')+'</ul></section><section><h3>Centres listing this service</h3><p>Optional: use your location once to check straight-line distance. Coordinates are not saved.</p><button type="button" class="link-btn" data-near-step="'+E(id)+'">Use location once</button><div data-near-results role="status"></div>'+ (result.facilities.map(f=>'<article><strong>'+E(f.name)+'</strong><p>'+E(f.reason)+(f.verified_at?' Last confirmed '+E(fmt(f.verified_at))+'.':'')+'</p><small>'+E(f.address)+'</small></article>').join('')||'<p>No matching service is recorded. Use Nearby care to check with a centre.</p>')+'</section><div class="ct-draft"><span class="journey-eyebrow">READY FOR YOUR REVIEW</span><h3>Appointment request draft</h3><p>'+E(result.draft.reason)+'</p><p>'+E(result.notice)+'</p><button class="btn btn--primary" data-help-draft>Review request →</button></div>';
 host.querySelector('[data-help-draft]').onclick=()=>{dialog.close();if(window.PatientConnected?.prepareVisit){window.PatientConnected.prepareVisit(result.title,result.questions);return;}document.querySelector('[data-panel="appointments"]')?.click();const input=$('apptNotes');if(input){input.value=result.draft.reason+'\nQuestions: '+result.questions.join(' ');input.focus();}DaiAPI.toast('Draft prepared. Choose a doctor and date, then confirm the request.');};
}
function scrollTo(el) { el?.scrollIntoView({ behavior: lowMotion || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); }
document.addEventListener('toggle', e => {
  const id = e.target.dataset?.stopExpand;
  if (id) { expanded.set(id, e.target.open); scheduleRoad(); }
}, true);
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.stepScope) { scope=b.dataset.stepScope; windowStart=0;render(); }
  if(b.dataset.roadPage){windowStart=Math.max(0,windowStart+(b.dataset.roadPage==='next'?WINDOW_SIZE:-WINDOW_SIZE));render();$('careRoadway')?.scrollIntoView({block:'start'});}
  if(b.hasAttribute('data-step-explorer')){const d=document.createElement('dialog');d.className='ct-help-dialog timeline-explorer-dialog';d.setAttribute('aria-label','Explore recorded care by date');d.innerHTML='<button class="ct-dialog-close" aria-label="Close">×</button><h2>Explore your dates</h2><div data-date-explorer></div>';document.body.append(d);d.querySelector('button').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());d.showModal();window.TimelineTools?.explorer(d.querySelector('[data-date-explorer]'),items(),id=>{d.close();reveal(id);});}
  if(b.dataset.stepExplain){const m=items().find(m=>String(m.id)===b.dataset.stepExplain),answer=window.TimelineTools?.explain(m||{});if(answer){const d=document.createElement('dialog');d.className='ct-help-dialog';d.innerHTML='<button class="ct-dialog-close" aria-label="Close">×</button><h2>'+E(plain(m))+'</h2><small>Prepared educational content · not an interpretation of your result</small><p>'+E(answer.text)+'</p>'+(answer.sources||[]).filter(s=>typeof s.url==='string'&&s.url.startsWith('https://')).map(s=>'<a target="_blank" rel="noopener" href="'+E(s.url)+'">'+E(s.title||'Official source')+'</a>').join('');document.body.append(d);d.querySelector('button').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());d.showModal();}}
  if (b.dataset.stepHelp) openHelp(b.dataset.stepHelp,b);
  if (b.dataset.stepEvidence) openEvidence(b.dataset.stepEvidence);
  if (b.dataset.journeyFilter) { filter = b.dataset.journeyFilter;windowStart=0; render(); }
  if (b.dataset.journeyLane) { lane = b.dataset.journeyLane; windowStart=0;filter = 'all'; render(); }
  if (b.dataset.journeyBaby) { baby = b.dataset.journeyBaby;windowStart=0; render(); }
  if (b.hasAttribute('data-journey-compact')) { compact = !compact; expanded.clear(); render(); }
  if (b.dataset.journeyListen) listen(b.dataset.journeyListen);
  if (b.hasAttribute('data-journey-recap')) recap();
  if (b.hasAttribute('data-journey-contrast')) { contrast = !contrast; localStorage.setItem('dai_journey_contrast', contrast ? '1' : '0'); render(); }
  if (b.hasAttribute('data-journey-simple')) { lowMotion = !lowMotion; localStorage.setItem('dai_journey_simple', lowMotion ? '1' : '0'); render(); }
  if (b.dataset.journeyChild) { localStorage.setItem('dai_active_child', b.dataset.journeyChild); location.href = 'child-dashboard.html'; }
  if (b.dataset.journeyQuestions) window.PatientExperience.askDaya('What should I ask my doctor about ' + b.dataset.journeyQuestions + '?');
  if (b.dataset.journeyChapter) scrollTo($('journey-zone-' + b.dataset.journeyChapter));
  if (b.hasAttribute('data-journey-current')) {
    if(scope!=='now'||filter!=='all'){scope='now';filter='all';render();}
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
function reveal(id){scope='all';filter='all';const rows=items(),i=rows.findIndex(m=>String(m.id)===String(id));if(i<0)return;windowStart=Math.floor(i/WINDOW_SIZE)*WINDOW_SIZE;expanded.set(stopId(rows[i]),true);render();scrollTo($(stopId(rows[i])));}
document.addEventListener('dai:patient-panel',scheduleRoad);
window.addEventListener?.('resize',scheduleRoad);
window.PatientJourney = { update(next, p) { data = next; prefs = p; render(); }, category, roadGeometry, reveal, help:openHelp, evidence:openEvidence, getRows:()=>items() };
})();
