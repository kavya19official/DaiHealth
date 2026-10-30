/* Open patient home: presentation of existing, patient-scoped records only. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state, selectedChild, selectedDate, map, markers, mapKey = '';
  const dateLabel = v => v ? new Date(String(v).slice(0,10) + 'T12:00:00').toLocaleDateString(document.documentElement.lang || 'en', {day:'numeric',month:'short'}) : 'Date not recorded';
  const header = (eyebrow, title, action, target) => '<div class="oh-section-heading"><div><span class="oh-eyebrow">'+eyebrow+'</span><h2>'+title+'</h2></div>'+(action?'<button type="button" class="link-btn" data-oh-go="'+target+'">'+action+' ↗</button>':'')+'</div>';
  function section(id, cls, markup) { const el=document.createElement('section');el.id=id;el.className=cls;el.innerHTML=markup;return el; }
  function mount() {
    const root=$('panel-dashboard');if(!root||$('homeOpenJourney'))return;
    root.classList.add('open-home');
    const hero=root.querySelector('.home-hero-grid');hero.classList.add('oh-hero-band');
    const path=document.createElement('div');path.id='homeHeroPath';path.className='oh-hero-path';$('homeJourneyProgress').after(path);
    const note=document.createElement('span');note.className='oh-photo-note';note.textContent='A little care. A world of possibility.';root.querySelector('.home-illustration').append(note);
    const top=section('homeOpenMain','oh-main-row','');
    top.append(section('homeOpenJourney','oh-open-section oh-journey',header('MY JOURNEY','Every step, connected.','Full timeline','timeline')+'<div class="oh-journey-meta" id="homeOpenCounts">Loading your recorded care plan…</div><div id="homeOpenTimeline" class="oh-timeline" aria-label="Recorded care milestones"></div><div class="oh-timeline-legend"><span class="oh-done">✓ Done</span><span class="oh-late">◷ To catch up</span><span>○ Upcoming</span></div><div class="oh-journey-foot"><span>Small steps. A continuous story of care.</span><button type="button" class="link-btn" data-oh-go="gaps">See what’s next →</button></div>'));
    const developmentCard=$('homeDevelopmentCard'),babyLogs=$('homeBabyLogArea');const logs=document.createElement('details');logs.className='oh-baby-logs';logs.innerHTML='<summary>Feeding & sleep notes +</summary>';logs.append(babyLogs);developmentCard.append(logs);top.append(developmentCard);hero.after(top);
    const middle=section('homeOpenMiddle','oh-middle-row','');
    middle.append(section('homeOpenPending','oh-open-section oh-pending',header('A LITTLE ATTENTION','Your next little steps','All pending care','gaps')+'<div id="homeOpenPendingRows" class="oh-pending-rows"><p>Loading recorded items…</p></div>'));
    middle.append($('homeHealthCard'),$('homeAppointmentCard'));top.after(middle);
    const week=document.createElement('div');week.id='homeOpenWeek';week.className='oh-week';week.setAttribute('aria-label','Appointment dates this week');$('nextAppointmentPreview').before(week);
    const bottom=section('homeOpenBottom','oh-bottom-row','');
    bottom.append(section('homeOpenVaccines','oh-open-section oh-vaccines',header('MY BABY','Little doses. Lasting care.','Baby records','children')+'<div id="homeOpenVaccineBabies" class="oh-vaccine-babies" role="tablist" aria-label="Select baby for vaccine tracker"></div><div id="homeOpenVaccineRows" class="oh-vaccine-row"></div><p class="oh-source-note">Each baby’s recorded doses stay separate. Your care team plans catch-up doses.</p>'));
    bottom.append(section('homeOpenNearby','oh-map-card',header('CARE, CLOSER TO YOU','Your care neighbourhood','Find care','facilities')+'<div id="homeOpenMap" class="oh-map" aria-label="Map of listed care facilities"></div><div id="homeOpenFacility" class="oh-map-caption"></div><p class="oh-source-note">Synthetic facility locations · Availability must be confirmed with the centre.</p>'));
    middle.after(bottom);
    const extras=document.createElement('details');extras.className='oh-extras';extras.innerHTML='<summary><span>✧ A little more, just for you</span><span>Personal check-ins, journal & recorded-detail viewer +</span></summary><div class="oh-extras-body"></div>';
    extras.querySelector('div').append($('homeCheckinCard'),$('homeJournalCard'),$('clinicalDashboardHome'));bottom.after(extras);
    extras.addEventListener('toggle',()=>window.dispatchEvent(new Event('resize')));
    const voice=document.createElement('button');voice.type='button';voice.className='oh-header-voice';voice.setAttribute('aria-label','Ask Dhruv by voice');voice.innerHTML='<svg aria-hidden="true"><use href="#i-mic"/></svg>';voice.onclick=()=>window.PatientExperience?.askDaya(null,'voice');root.querySelector('.home-display-controls').prepend(voice);
    const today=document.createElement('span');today.className='oh-today';today.textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Kolkata'});root.querySelector('.home-display-controls').prepend(today);
    // Existing privacy, scheme and report pages remain the source of truth.
    root.querySelectorAll('.home-quick,.home-ask-bar,.home-middle-grid,.home-insight-grid,.home-support-grid').forEach(el=>el.hidden=true);
    function navState(){const n=$('homeCareNavigation');if(n?.querySelector('.is-active'))n.open=true;document.body.classList.toggle('patient-on-home',!location.hash||location.hash==='#dashboard');if(map)setTimeout(()=>map.invalidateSize(),0);}
    window.addEventListener('hashchange',navState);navState();
    document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.matches('.nav-item'))queueMicrotask(navState);if(button.dataset.ohGo){const nav=document.querySelector('.nav-item[data-panel="'+button.dataset.ohGo+'"]');if(nav)nav.click();else if(button.dataset.ohGo==='profile')document.querySelector('.user-chip')?.click();queueMicrotask(navState);}if(button.dataset.ohDate){selectedDate=button.dataset.ohDate;renderCalendar();}if(button.dataset.ohChild){selectedChild=state?.children?.find(c=>String(c.id)===button.dataset.ohChild);const choice=document.querySelector('[data-home-child="'+button.dataset.ohChild+'"]');if(choice)choice.click();renderVaccines();}if(button.dataset.ohBaby){const c=state?.children?.find(c=>String(c.id)===button.dataset.ohBaby);if(c){localStorage.setItem('dai_active_child',c.id);location.href='child-dashboard.html';}}});
  }
  function relevant() {
    const M=window.PatientModel,st=M.stage(state.user,state.post,state.children),items=M.gaps(state.milestones||[],st);
    if(st.delivered)for(const p of state.post?.schedule||[])if(p.status!=='done')items.push({id:'pnc-'+p.code,title:p.title,due_date:p.window_end,guidance:p.why,post:true});
    return items.sort((a,b)=>String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')));
  }
  function renderJourney() {
    const M=window.PatientModel,st=M.stage(state.user,state.post,state.children);
    const fraction=st.delivered?1:Math.min(1,Math.max(0,(st.week||0)/40)), x=35+fraction*510;
    $('homeHeroPath').innerHTML='<svg viewBox="0 0 580 106" role="img" aria-label="'+E(st.label)+' · illustrative journey path"><defs><linearGradient id="ohPathGradient"><stop stop-color="#bba0ee"/><stop offset="1" stop-color="#6d3fd6"/></linearGradient></defs><path d="M35 57 C100 12 110 96 170 58 S270 17 310 56 S400 94 445 58 S515 25 545 56" fill="none" stroke="#e2d7f3" stroke-width="5" stroke-linecap="round"/><path d="M35 57 C100 12 110 96 170 58 S270 17 310 56 S400 94 445 58 S515 25 545 56" fill="none" stroke="url(#ohPathGradient)" stroke-width="5" stroke-dasharray="'+Math.round(fraction*590)+' 650" stroke-linecap="round"/>'+[35,170,310,445,545].map((cx,i)=>'<circle cx="'+cx+'" cy="57" r="6" fill="'+(i/4<=fraction?'#8c66cb':'#f8f4ff')+'" stroke="#c7b2e7" stroke-width="2"/>').join('')+'<g class="oh-you-marker" transform="translate('+x+',40)"><circle r="17" fill="#fff" stroke="#a887dd" stroke-width="2"/><text y="5" text-anchor="middle" fill="#6d3fd6" font-size="17">♡</text></g><text x="35" y="99">Beginnings</text><text x="235" y="99">Growing together</text><text x="480" y="99">A new chapter</text></svg>';
    const items=[...(state.milestones||[])];
    if(st.delivered)for(const p of state.post?.schedule||[])items.push({id:'pnc-'+p.code,title:p.title,due_date:p.window_end,status:p.status==='done'?'completed':p.status});
    items.sort((a,b)=>String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')));
    const counts={completed:0,overdue:0,upcoming:0};for(const item of items){const status=M.status(item);if(status in counts)counts[status]++;}
    $('homeOpenCounts').innerHTML='<span><b>'+counts.completed+'</b> recorded done</span><span><b>'+counts.overdue+'</b> to catch up</span><span><b>'+counts.upcoming+'</b> upcoming</span>';
    const shown=items.length>6?[...items.slice(0,3),...items.slice(-3)]:items;
    $('homeOpenTimeline').innerHTML=shown.length?shown.map((m,i)=>{const status=M.status(m);return '<button type="button" data-oh-go="timeline" class="oh-stop '+(status==='completed'?'oh-done':status==='overdue'?'oh-late':'')+'"><span class="oh-stop-date">'+E(dateLabel(m.due_date))+'</span><span class="oh-stop-dot">'+(status==='completed'?'✓':status==='overdue'?'◷':'○')+'</span><strong>'+E(m.title)+'</strong><small>'+E(status==='completed'?'Recorded done':status==='overdue'?'Let’s catch up':'Upcoming')+'</small></button>';}).join(''):'<div class="oh-empty"><span>✧</span><p>Your journey starts with your recorded care plan.</p><button type="button" class="link-btn" data-oh-go="profile">Add your dates →</button></div>';
    const gaps=relevant();
    $('homeOpenPendingRows').innerHTML=gaps.slice(0,3).map((m,i)=>'<div class="oh-pending-row"><span class="oh-row-icon">'+(['◷','⌁','♡'][i])+'</span><div><strong>'+E(m.title)+'</strong><small>'+E(M.status(m)==='overdue'?'Not recorded · '+dateLabel(m.due_date):'Due '+dateLabel(m.due_date))+'</small></div><button type="button" class="oh-row-action" data-oh-go="'+(m.post?'postpartum':'gaps')+'">'+(m.post?'Review':'View')+' ↗</button></div>').join('')||'<div class="oh-empty"><span>✓</span><p>No open care items recorded. Your next steps will appear here.</p></div>';
    const kick=$('homeDevelopmentKicker');if(kick)kick.textContent=st.delivered?'YOUR BABY, THIS WEEK':'BABY THIS WEEK';
    const development=window.PatientHomeModel.development(st,selectedChild,M.today()),size=window.PatientHomeModel.SIZE[st.week];
    $('homeDevelopment').innerHTML='<div class="oh-baby-art" aria-hidden="true">'+(st.delivered?(window.LittleWorld?.face?.()||'♡'):(size?.icon||'✿'))+'</div><h3>'+E(development.title)+'</h3><p>'+E(st.delivered?'A little more to discover, together. Keep this baby’s visits, vaccines and little firsts in their own record.':development.text)+'</p>'+(size?'<p class="oh-size-note">About the size of '+E(size.label)+'.</p><small class="oh-source-note">Illustration only, not your baby’s measurement.</small>':'')+'<button type="button" class="link-btn" data-oh-go="'+(st.delivered?'children':'timeline')+'">'+(st.delivered?'Explore this baby’s world':'Explore this week')+' ↗</button><a class="oh-development-source" href="'+E(development.source)+'" '+(development.source.startsWith('https:')?'target="_blank" rel="noopener"':'')+'>'+E(development.sourceLabel)+' ↗</a>';
    $('homeGreetingSub').textContent=st.label+' · '+(st.edd?'Expected '+dateLabel(st.edd):'Your recovery and each baby’s care, connected.');
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
    $('homeOpenJourney').removeAttribute('aria-busy');renderJourney();renderCalendar();renderVaccines();renderMap();
  }
  window.PatientHomeOpen={update};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
