/* Open patient home: presentation of existing, patient-scoped records only. */
(function () {
  'use strict';
  const Display={
    journey(items,status){const sorted=items.slice().sort((a,b)=>String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')));const overdue=sorted.filter(m=>status(m)==='overdue'),done=sorted.filter(m=>status(m)==='completed'),upcoming=sorted.filter(m=>!['overdue','completed'].includes(status(m)));return {overdue,done,upcoming,nodes:[...upcoming.slice(0,3),...done.slice(-2).reverse()].slice(0,overdue.length?5:6)};},
    validPoint(f){return !!f&&f.lat!==null&&f.lng!==null&&f.lat!==''&&f.lng!==''&&Number.isFinite(Number(f.lat))&&Number.isFinite(Number(f.lng))&&Math.abs(Number(f.lat))<=90&&Math.abs(Number(f.lng))<=180;},
    distance(a,b){if(!this.validPoint(a)||!this.validPoint(b))return null;const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlng=(b.lng-a.lng)*r;return 6371*2*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2));},
    vaccineIcon(code){return /^(opv|rota)/i.test(code)?'drop':/^(bcg|hepb|fipv)/i.test(code)?'syringe':'shield';}
  };
  if(typeof module==='object'&&module.exports){module.exports=Display;return;}
  window.PatientHomeLayout=Display;
  const $ = id => document.getElementById(id);
  const E = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state, selectedChild, selectedDate, map, markers, mapKey = '',catchupOpen=false;
  const T=(en,hi)=>document.documentElement.lang==='hi'?hi:en;
  const listen=id=>'<button type="button" class="home-listen" data-listen="'+id+'" aria-label="'+T('Read this section aloud','यह भाग सुनें')+'"><svg aria-hidden="true"><use href="#i-speaker"/></svg></button>';
  const info=(text,name)=>'<details class="oh-info"><summary aria-label="'+E(name||T('About these records','इन रिकॉर्ड के बारे में'))+'">i</summary><div>'+E(text)+'</div></details>';
  const dateLabel = v => v ? new Date(String(v).slice(0,10) + 'T12:00:00').toLocaleDateString(document.documentElement.lang || 'en', {day:'numeric',month:'short'}) : 'Date not recorded';
  const header = (eyebrow, title, action, target) => '<div class="oh-section-heading"><div><span class="oh-eyebrow">'+eyebrow+'</span><h2>'+title+'</h2></div>'+(action?'<button type="button" class="link-btn" data-oh-go="'+target+'">'+action+' ↗</button>':'')+'</div>';
  function section(id, cls, markup) { const el=document.createElement('section');el.id=id;el.className=cls;el.innerHTML=markup;return el; }
  function setupNavigation() {
    const nav=document.querySelector('.sidebar__nav');if(!nav)return;
    const find=id=>nav.querySelector('[data-panel="'+id+'"]');
    const groups=[['Care',['dashboard','mycare','children','hospital-stay']],['Records',['records']],['Help',['facilities','schemes','family','companion','messages','settings']]];
    nav.querySelectorAll('.nav-caption').forEach(n=>n.remove());
    for(const [title,ids] of groups){const caption=document.createElement('span');caption.className='nav-caption';caption.dataset.homeNavLabel=title;caption.textContent=title;nav.append(caption);for(const id of ids){const item=id==='mycare'?$('homeCareNavigation'):find(id);if(item)nav.append(item);}}
  }
  function mount() {
    const root=$('panel-dashboard');if(!root||$('homeOpenJourney'))return;
    root.classList.add('open-home');setupNavigation();
    const hero=root.querySelector('.home-hero-grid');hero.classList.add('oh-hero-band');
    const greeting=root.querySelector('.home-heading'),copy=root.querySelector('.home-journey-copy');
    copy.prepend(greeting);greeting.querySelector('.eyebrow').hidden=true;
    root.querySelector('#homeJourneyTitle').hidden=true;root.querySelector('#homeJourneyText').hidden=true;
    copy.querySelector('.home-kicker').hidden=true;
    const identity=document.createElement('div');identity.className='oh-baby-identity';identity.append($('homeJourneyProgress'),$('homeBabyTabs'));copy.append(identity,$('shareJourney'));
    const next=$('nextStepCard');next.querySelector('.home-next-icon').hidden=true;next.querySelector('small').hidden=true;
    const nextDetails=document.createElement('details');nextDetails.id='homeNextDetails';nextDetails.className='oh-info';nextDetails.innerHTML='<summary aria-label="Why this care step?">i</summary><div></div>';next.append(nextDetails);
    const actions=document.createElement('div');actions.className='oh-next-actions';actions.append($('nextStepBook'),$('nextStepDirections'));next.append(actions);
    const path=document.createElement('div');path.id='homeHeroPath';path.className='oh-hero-path';$('homeJourneyProgress').after(path);path.hidden=true;
    const note=document.createElement('span');note.className='oh-photo-note';note.textContent='A little care. A world of possibility.';root.querySelector('.home-illustration').append(note);
    const top=section('homeOpenMain','oh-main-row','');
    top.append(section('homeOpenJourney','oh-open-section oh-journey',header('MY JOURNEY','Every step, connected.','Full timeline','timeline')+'<div class="oh-journey-meta" id="homeOpenCounts">Loading your recorded care plan…</div><div id="homeOpenTimeline" class="oh-timeline" aria-label="Recorded care milestones"></div><div class="oh-timeline-legend"><span class="oh-done">✓ Done</span><span class="oh-late">◷ To catch up</span><span>○ Upcoming</span></div><div class="oh-journey-foot"><span>Small steps. A continuous story of care.</span><button type="button" class="link-btn" data-oh-go="gaps">See what’s next →</button></div>'));
    const developmentCard=$('homeDevelopmentCard'),babyLogs=$('homeBabyLogArea');const logs=document.createElement('details');logs.className='oh-baby-logs';logs.innerHTML='<summary>Feeding & sleep notes +</summary>';logs.append(babyLogs);developmentCard.append(logs);hero.after(top);
    const middle=section('homeOpenMiddle','oh-middle-row','');
    middle.append(section('homeOpenPending','oh-open-section oh-pending',header('A LITTLE ATTENTION','Your next little steps','All pending care','gaps')+'<div id="homeOpenPendingRows" class="oh-pending-rows"><p>Loading recorded items…</p></div>'));
    top.append(middle.firstElementChild);middle.append($('homeHealthCard'),developmentCard,$('homeAppointmentCard'));top.after(middle);
    const week=document.createElement('div');week.id='homeOpenWeek';week.className='oh-week';week.setAttribute('aria-label','Appointment dates this week');$('nextAppointmentPreview').before(week);
    const bottom=section('homeOpenBottom','oh-bottom-row','');
    bottom.append(section('homeOpenVaccines','oh-open-section oh-vaccines',header('MY BABY','Little doses. Lasting care.','Baby records','children')+'<div id="homeOpenVaccineBabies" class="oh-vaccine-babies" role="tablist" aria-label="Select baby for vaccine tracker"></div><div id="homeOpenVaccineRows" class="oh-vaccine-row"></div><p class="oh-source-note">Each baby’s recorded doses stay separate. Your care team plans catch-up doses.</p>'));
    bottom.append(section('homeOpenNearby','oh-map-card',header('CARE, CLOSER TO YOU','Your care neighbourhood','Find care','facilities')+'<div id="homeOpenMap" class="oh-map" aria-label="Map of listed care facilities"></div><div id="homeOpenFacility" class="oh-map-caption"></div><p class="oh-source-note">Synthetic facility locations · Availability must be confirmed with the centre.</p>'));
    middle.after(bottom);
    const extras=document.createElement('details');extras.className='oh-extras';extras.innerHTML='<summary><span>✧ A little more, just for you</span><span>Personal check-ins, journal & recorded-detail viewer +</span></summary><div class="oh-extras-body"></div>';
    extras.querySelector('div').append($('homeCheckinCard'),logs,$('homeJournalCard'),$('clinicalDashboardHome'));bottom.after(extras);
    extras.addEventListener('toggle',()=>window.dispatchEvent(new Event('resize')));
    const voice=document.createElement('button');voice.type='button';voice.className='oh-header-voice';voice.setAttribute('aria-label','Ask Dhruv by voice');voice.innerHTML='<svg aria-hidden="true"><use href="#i-mic"/></svg>';voice.onclick=()=>window.PatientExperience?.askDaya(null,'voice');root.querySelector('.home-display-controls').prepend(voice);
    const today=document.createElement('span');today.className='oh-today';today.textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Kolkata'});root.querySelector('.home-display-controls').prepend(today);
    // Existing privacy, scheme and report pages remain the source of truth.
    root.querySelectorAll('.home-quick,.home-ask-bar,.home-middle-grid,.home-insight-grid,.home-support-grid').forEach(el=>el.hidden=true);
    function navState(){const n=$('homeCareNavigation');if(n)n.open=!!n.querySelector('.is-active');document.body.classList.toggle('patient-on-home',!location.hash||location.hash==='#dashboard');if(map)setTimeout(()=>map.invalidateSize(),0);}
    window.addEventListener('hashchange',navState);navState();
    document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.matches('.nav-item'))queueMicrotask(navState);if(button.hasAttribute('data-oh-catchup')){catchupOpen=!catchupOpen;renderJourney();return;}if(button.dataset.ohGo){const nav=document.querySelector('.nav-item[data-panel="'+button.dataset.ohGo+'"]');if(nav)nav.click();else if(button.dataset.ohGo==='profile')document.querySelector('.user-chip')?.click();queueMicrotask(navState);}if(button.dataset.ohDate){selectedDate=button.dataset.ohDate;renderCalendar();}if(button.dataset.ohChild){selectedChild=state?.children?.find(c=>String(c.id)===button.dataset.ohChild);const choice=document.querySelector('[data-home-child="'+button.dataset.ohChild+'"]');if(choice)choice.click();renderVaccines();}if(button.dataset.ohBaby){const c=state?.children?.find(c=>String(c.id)===button.dataset.ohBaby);if(c){localStorage.setItem('dai_active_child',c.id);location.href='child-dashboard.html';}}});
  }
  function renderHero(){
    const st=window.PatientModel.stage(state.user,state.post,state.children),next=relevant()[0],hi=document.documentElement.lang==='hi';
    $('homeGreetingSub').textContent=st.label;$('homeGreetingSub').className='oh-stage-chip';
    $('nextStepWhy').textContent=next?(hi?'आपकी दर्ज देखभाल में अगला कदम।':'The next item in your recorded care plan.'):(hi?'अपनी देखभाल का प्लान देखें।':'Review your recorded care plan.');
    const detail=$('homeNextDetails').querySelector('div');detail.textContent=next?.guidance||next?.why||(hi?'आगे की देखभाल अपनी टीम से तय करें।':'Discuss your next follow-up with your care team.');
    $('nextStepDirections').innerHTML='<svg aria-hidden="true"><use href="#i-arrow"/></svg>';
    $('nextStepDirections').setAttribute('aria-label',hi?'केंद्र तक रास्ता':'Directions to registered centre');
    $('nextStepDirections').title=hi?'केंद्र तक रास्ता':'Directions to registered centre';
    $('nextStepCard').querySelector('.home-kicker').textContent=hi?'आपका अगला कदम':'YOUR NEXT STEP';
    const save=$('shareJourney');save.innerHTML='<svg aria-hidden="true"><use href="#i-heart"/></svg> '+(hi?'यादगार कार्ड':'Milestone card')+' ↗';
    const image=$('homeStageImage');image.loading='eager';
  }
  function relevant() {
    const M=window.PatientModel,st=M.stage(state.user,state.post,state.children),items=M.gaps(state.milestones||[],st);
    if(st.delivered)for(const p of state.post?.schedule||[])if(p.status!=='done')items.push({id:'pnc-'+p.code,title:p.title,due_date:p.window_end,guidance:p.why,post:true});
    return items.sort((a,b)=>String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')));
  }
  function renderJourney() {
    const M=window.PatientModel,st=M.stage(state.user,state.post,state.children),items=[...(state.milestones||[])];
    if(st.delivered)for(const p of state.post?.schedule||[])items.push({id:'pnc-'+p.code,title:p.title,due_date:p.window_end,status:p.status==='done'?'completed':p.status});
    const view=Display.journey(items,M.status);
    $('homeOpenJourney').querySelector('.oh-section-heading').innerHTML=header('MY JOURNEY',T('Your care path','आपकी देखभाल का सफ़र'),T('Timeline','समयरेखा'),'timeline').replace(/^<div[^>]*>|<\/div>$/g,'');
    $('homeOpenCounts').innerHTML='<span>✓ <b>'+view.done.length+'</b> '+T('Done','पूरा')+'</span><span>◷ <b>'+view.overdue.length+'</b> '+T('Catch up','बाकी')+'</span><span>○ <b>'+view.upcoming.length+'</b> '+T('Upcoming','आने वाले')+'</span>'+listen('homeOpenJourney');
    const stops=view.nodes.map((m,i)=>{const status=M.status(m);return '<button type="button" data-oh-go="timeline" class="oh-stop '+(status==='completed'?'oh-done':'')+'"><span class="oh-stop-date">'+E(dateLabel(m.due_date))+'</span><span class="oh-stop-dot">'+(status==='completed'?'✓':status==='queued'?'↻':'○')+'</span><strong>'+E(m.title)+'</strong><small>'+E(status==='completed'?T('Done','पूरा'):status==='queued'?T('Waiting to sync','सिंक होना बाकी'):T('Upcoming','आने वाला'))+'</small></button>';}).join('');
    const catchup=view.overdue.length?'<button type="button" class="oh-stop oh-catchup" data-oh-catchup aria-expanded="'+catchupOpen+'" aria-controls="homeCatchupItems"><span class="oh-stop-date">'+T('Earlier care','पिछली देखभाल')+'</span><span class="oh-stop-dot">◷</span><strong>'+T('Catch up','बाकी')+' · '+view.overdue.length+'</strong><small>'+T('Review together','साथ में देखें')+' '+(catchupOpen?'−':'+')+'</small></button>':'';
    $('homeOpenTimeline').innerHTML=stops+catchup||'<div class="oh-empty">'+(window.PatientVisuals?.emptyArt('care')||'○')+'<p>'+T('No care milestones recorded.','देखभाल के पड़ाव दर्ज नहीं हैं।')+'</p><button type="button" data-oh-go="profile" class="link-btn">'+T('My profile','मेरी प्रोफ़ाइल')+' ↗</button></div>';
    let history=$('homeCatchupItems');if(!history){history=document.createElement('div');history.id='homeCatchupItems';history.className='oh-catchup-list';$('homeOpenTimeline').after(history);}history.hidden=!catchupOpen||!view.overdue.length;
    history.innerHTML='<strong>'+T('Let’s review these together','इन्हें साथ मिलकर देखें')+'</strong>'+view.overdue.map(m=>'<div><span>◷</span><div><b>'+E(m.title)+'</b><small>'+E(dateLabel(m.due_date))+'</small></div><button class="link-btn" type="button" data-oh-go="timeline">'+T('Open','खोलें')+' ↗</button></div>').join('');
    const legend=$('homeOpenJourney').querySelector('.oh-timeline-legend');legend.innerHTML=info(T('Counts reflect recorded completion and due dates. Queued changes are not confirmed completion. Older outstanding items are grouped, not removed.','गिनती दर्ज स्थिति और तारीखों पर आधारित है। पुराने बाकी रिकॉर्ड हटाए नहीं गए हैं।'));
    $('homeOpenJourney').querySelector('.oh-journey-foot').hidden=true;
    const pending=$('homeOpenPending');pending.querySelector('h2').textContent=T('Next actions','अगले कदम');pending.querySelector('.oh-eyebrow').textContent=T('A LITTLE ATTENTION','थोड़ा ध्यान');pending.querySelector('.oh-section-heading>.link-btn').textContent=T('All care ↗','सभी कदम ↗');
    $('homeOpenPendingRows').innerHTML=relevant().slice(0,2).map((m,i)=>'<div class="oh-pending-row"><span class="oh-row-icon">◷</span><div><strong>'+E(m.title)+'</strong><small>'+E(dateLabel(m.due_date))+'</small></div><button type="button" class="oh-row-action" data-oh-go="'+(m.post?'postpartum':'gaps')+'">'+T('View','देखें')+' ↗</button></div>').join('')||'<div class="oh-empty">'+(window.PatientVisuals?.emptyArt('care')||'✓')+'<p>'+T('No open items recorded.','कोई बाकी कदम दर्ज नहीं है।')+'</p></div>';
    const development=window.PatientHomeModel.development(st,selectedChild,M.today()),size=window.PatientHomeModel.SIZE[st.week];
    $('homeDevelopmentKicker').textContent=T('YOUR BABY','आपका बच्चा');
    $('homeDevelopment').innerHTML='<div class="oh-baby-art" aria-hidden="true">'+(st.delivered?'♡':size?.icon||'✿')+'</div><h3>'+E(st.delivered?(selectedChild?T('Growing together','साथ बढ़ते हुए'):T('Your next chapter','आपका अगला अध्याय')):st.week!==null?T('Week ','सप्ताह ')+st.week:T('Your journey','आपका सफ़र'))+'</h3><p>'+E(size?T('About the size of ','लगभग ')+size.label:st.delivered?T('Each baby’s records stay separate.','हर बच्चे के रिकॉर्ड अलग हैं।'):T('Explore your recorded stage.','अपना दर्ज चरण देखें।'))+'</p>'+info(development.text+' '+T('Illustration only, not a measurement of your baby.','यह केवल चित्रण है, आपके बच्चे की माप नहीं।'))+'<button type="button" class="link-btn" data-oh-go="'+(st.delivered?'children':'timeline')+'">'+T('Explore','और देखें')+' ↗</button><a class="oh-development-source" href="'+E(development.source)+'" '+(development.source.startsWith('https:')?'target="_blank" rel="noopener"':'')+' aria-label="'+E(development.sourceLabel)+'">'+T('Source','स्रोत')+' ↗</a>';
    
  }
  function renderCalendar(){
    if(!state)return;const M=window.PatientModel,today=M.today();selectedDate=selectedDate||today;
    const days=Array.from({length:7},(_,i)=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
    $('homeOpenWeek').innerHTML=days.map(d=>{const has=(state.appointments||[]).some(a=>String(a.requested_date).slice(0,10)===d&&a.status!=='cancelled');return '<button type="button" aria-pressed="'+(selectedDate===d)+'" data-oh-date="'+d+'" class="'+(has?'oh-has-visit':'')+'" aria-label="'+E(dateLabel(d)+(has?' · visit recorded':''))+'"><small>'+new Date(d+'T12:00:00').toLocaleDateString(document.documentElement.lang||'en',{weekday:'short'})+'</small><strong>'+d.slice(-2)+'</strong><i aria-hidden="true"></i></button>';}).join('');
    const appointments=(state.appointments||[]).filter(a=>String(a.requested_date).slice(0,10)===selectedDate&&a.status!=='cancelled');
    $('nextAppointmentPreview').innerHTML='<div class="oh-day-appointments"><span class="oh-eyebrow">'+E(dateLabel(selectedDate))+'</span>'+(appointments.length?appointments.map(a=>'<div><strong>'+E(a.requested_time?.slice(0,5)||'Time to confirm')+' · '+E(a.reason||'Care visit')+'</strong><p>'+E(a.doctor_name||'Clinician to confirm')+'</p><small>'+E(a.hospital_name||a.facility_name||'Confirm centre with your care team')+' · '+E(a.status)+'</small></div>').join(''):'<p>No visit recorded for this day.</p><button type="button" class="link-btn" data-oh-go="appointments">Plan your next visit →</button>')+'</div>';
  }
  function renderVaccines(){
    const children=state.children||[];selectedChild=children.find(c=>c.id===selectedChild?.id)||children[0];
    $('homeOpenVaccineBabies').innerHTML=children.map((c,i)=>'<button type="button" role="tab" aria-selected="'+(c.id===selectedChild?.id)+'" data-oh-child="'+c.id+'"><span>'+(window.LittleWorld?.face?.()||'♡')+'</span>'+E(/^CHILD-SYN-/.test(c.name||'')?'Baby '+(i+1):c.name||'Baby '+(i+1))+'</button>').join('');
    if(!selectedChild){$('homeOpenVaccineRows').innerHTML='<div class="oh-baby-waiting"><span class="oh-cradle" aria-hidden="true">☾<br>◡</span><div><h3>A little world is waiting.</h3><p>After birth, each baby has their own vaccine passport.</p><button type="button" class="link-btn" data-oh-go="children">My baby’s records →</button></div></div>';return;}
    const recorded=Object.fromEntries((selectedChild.vaccinations||[]).map(v=>[v.vaccine_code,{given_on:v.given_on}]));
    const schedule=window.AnvayaChild?.vaccineSchedule(selectedChild.date_of_birth,recorded,window.PatientModel.today())||[];
    const firstOpen=schedule.findIndex(v=>v.status!=='completed');const start=Math.max(0,firstOpen-2),visible=schedule.slice(start,start+6);
    $('homeOpenVaccineRows').innerHTML=visible.map(v=>'<button type="button" class="oh-dose '+(v.status==='completed'?'oh-given':v.status==='missed'?'oh-catchup':'')+'" data-oh-baby="'+selectedChild.id+'"><span class="oh-dose-stamp">'+(v.status==='completed'?'✓':'♧')+'<small>'+(v.status==='completed'?'✓':'◷')+'</small></span><strong>'+E(v.name)+'</strong><small>'+E(v.status==='completed'?'Recorded given':v.status==='missed'?'Catch-up review':dateLabel(v.dueDate))+'</small></button>').join('');
  }
  function renderMap(){
    const facility=state.overview?.registered_facility;
    const valid=f=>(f.lat!==null&&f.lng!==null&&Number.isFinite(Number(f.lat))&&Number.isFinite(Number(f.lng)));
    const facilities=(state.overview?.facilities||[]).filter(valid);const anchor=facility&&valid(facility)?facility:facilities[0];
    $('homeOpenFacility').innerHTML=anchor?'<span class="oh-facility-icon">✚</span><div><strong>'+E(anchor.name)+'</strong><small>'+(anchor.id===facility?.id?'Your registered centre':'Listed care centre')+' · '+E(anchor.tier||'Facility')+'</small></div><button type="button" class="oh-row-action" data-oh-go="facilities" aria-label="Find nearby care">↗</button>':'<p>No facility location recorded. Choose an area in Nearby care.</p>';
    const host=$('homeOpenMap');
    if(!anchor){host.innerHTML='<div class="oh-map-empty"><span>⌖</span>Choose an area to discover care.<button type="button" class="link-btn" data-oh-go="facilities">Open Nearby care →</button></div>';return;}
    if(!navigator.onLine||window.DaiAPI.lowBandwidth?.()){if(map){map.remove();map=null;mapKey='';}host.innerHTML='<div class="oh-map-empty"><span>⌖</span>Map paused to save data.<button type="button" class="link-btn" data-oh-go="facilities">Browse the facility list →</button></div>';return;}
    if(!window.L)return;
    const key=anchor.id+'|'+facilities.map(f=>f.id).join(',');if(map&&key===mapKey)return;
    if(!map){host.replaceChildren();map=L.map(host,{scrollWheelZoom:false,dragging:!L.Browser.mobile,zoomControl:true});const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:18});tiles.addTo(map);tiles.on('tileerror',()=>{host.setAttribute('aria-label','Map tiles unavailable. Facility details and Nearby care list remain available.');});markers=L.layerGroup().addTo(map);new ResizeObserver(()=>map?.invalidateSize()).observe(host);}
    markers.clearLayers();mapKey=key;map.setView([Number(anchor.lat),Number(anchor.lng)],12);
    for(const f of facilities){L.circleMarker([Number(f.lat),Number(f.lng)],{radius:f.id===anchor.id?10:7,color:'#fff',weight:3,fillColor:f.id===anchor.id?'#6d3fd6':'#9c83c7',fillOpacity:1}).addTo(markers).bindPopup('<strong>'+E(f.name)+'</strong><p>Listed facility · confirm availability</p>');}
    setTimeout(()=>map.invalidateSize(),0);
  }
  function update(next,prefs,c){
    mount();if(!next?.user)return;state=next;selectedChild=c||selectedChild;
    if(!next.homeLoaded&&!next.offline&&!next.user.guest){
      $('homeOpenJourney').setAttribute('aria-busy','true');
      $('homeOpenCounts').textContent='Loading your recorded care plan…';
      $('homeOpenTimeline').innerHTML='<div class="oh-loading-line" aria-label="Loading care milestones"><span></span><span></span><span></span><span></span><span></span></div>';
      $('homeOpenPendingRows').innerHTML='<p class="oh-loading-copy">Checking your recorded next steps…</p>';
      $('nextAppointmentPreview').innerHTML='<p class="oh-loading-copy">Loading your appointments…</p>';
      $('homeOpenVaccineRows').innerHTML='<p class="oh-loading-copy">Loading each baby’s own records…</p>';
      $('homeOpenFacility').innerHTML='<p class="oh-loading-copy">Finding your registered centre…</p>';
      return;
    }
    $('homeOpenJourney').removeAttribute('aria-busy');renderJourney();renderHero();renderCalendar();renderVaccines();renderMap();
  }
  window.PatientHomeOpen={update};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
