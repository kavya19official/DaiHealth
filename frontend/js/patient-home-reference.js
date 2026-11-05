/* Reference-inspired home presentation. Uses only the existing patient's scoped state. */
(function () {
  'use strict';
  const validDate = value => {
    const date=String(value||'').slice(0,10),time=Date.parse(date);
    return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===date?date:null;
  };
  function buildJourney(data,stage,status) {
    const items=data.milestones||[],pregnancy=items.filter(m=>!/post|pnc|child|baby|recovery|delivery|birth/i.test([m.category,m.stage,m.title].join(' '))),post=(data.post?.schedule||[]).map(m=>({...m,due_date:m.window_end,status:m.status==='done'?'completed':m.status}));
    const summarize=rows=>!rows.length?'unrecorded':rows.some(m=>status(m)==='overdue')?'attention':rows.every(m=>status(m)==='completed')?'done':rows.some(m=>status(m)==='review')?'review':rows.some(m=>status(m)==='queued')?'syncing':'upcoming';
    return [
      {key:'pregnancy',panel:'timeline',state:summarize(pregnancy)},
      {key:'delivery',panel:stage.delivered?'postpartum':'timeline',state:validDate(data.post?.delivery?.date)?'recorded':stage.delivered?'unrecorded':'upcoming'},
      {key:'postnatal',panel:'postpartum',state:post.length?summarize(post):stage.delivered?'unrecorded':'upcoming'},
      {key:'child',panel:'children',state:(data.children||[]).length?'available':'upcoming'}
    ];
  }
  function buildActivities(data,today) {
    const rows=[];
    for(const a of data.appointments||[]) {
      const date=validDate(a.requested_date);if(!date)continue;
      rows.push({id:'appointment-'+a.id,date,title:a.reason||'Care appointment',detail:a.hospital_name||a.doctor_name||'',state:a.status||'recorded',panel:'appointments'});
    }
    for(const m of data.milestones||[]) {
      const date=validDate(m.completed_at);if(date&&['completed','done'].includes(m.status)&&(!m.completion_verification||m.completion_verification==='verified'))rows.push({id:'milestone-'+m.id,date,title:m.title,detail:'Recorded care milestone',state:'completed',panel:'timeline'});
    }
    for(const c of data.children||[])for(const v of c.vaccinations||[]) {
      const date=validDate(v.given_on);if(date)rows.push({id:'vaccine-'+c.id+'-'+v.vaccine_code,date,title:v.vaccine_name||v.vaccine_code||'Vaccination record',detail:c.name||'Child record',state:'recorded',panel:'children'});
    }
    const future=rows.filter(r=>r.date>=today&&!['cancelled','completed'].includes(r.state)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
    const recent=rows.filter(r=>r.date<=today).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
    return [...future.slice(0,2),...recent.filter(r=>!future.slice(0,2).some(f=>f.id===r.id))].slice(0,3);
  }
  if(typeof module==='object'&&module.exports){module.exports={validDate,buildJourney,buildActivities};return;}
  const $=id=>document.getElementById(id),E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const T=(en,hi)=>document.documentElement.lang==='hi'?hi:en;
  const icon=name=>name==='pin'?'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>':'<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>';
  let mounted=false;
  function mount() {
    if(mounted||!$('homeOpenJourney'))return;mounted=true;
    document.body.classList.add('mother-reference');
    const root=$('panel-dashboard');root.classList.add('reference-home');
    const make=(id,cls)=>{const el=document.createElement('section');el.id=id;el.className=cls;return el;};
    const grid=make('motherHomeOverview','mr-overview');
    grid.append($('homeOpenJourney'));
    grid.append(make('motherWellness','mr-wellness mr-card'));
    grid.append(make('motherActivities','mr-activities mr-card'));
    grid.append(make('motherSupport','mr-support mr-card'));
    root.querySelector('.home-hero-grid').after(grid);
    const more=document.createElement('details');more.id='motherMoreCare';more.className='mr-more-care';more.innerHTML='<summary><span></span>'+icon('arrow')+'</summary><div class="mr-more-body"></div>';
    const body=more.querySelector('div');body.append($('homeOpenPending'),$('homeOpenMiddle'),$('homeOpenBottom'));grid.after(more);
    $('homeOpenMain').remove();
    const nextDetails=document.createElement('button');nextDetails.type='button';nextDetails.id='motherNextDetails';nextDetails.className='mr-outline';nextDetails.dataset.mrGo='timeline';$('nextStepCard').querySelector('.oh-next-actions').prepend(nextDetails);
    const calendar=document.createElement('div');calendar.className='mr-calendar-art';calendar.setAttribute('aria-hidden','true');calendar.innerHTML=icon('cal')+'<span>✓</span>';$('nextStepCard').append(calendar);
    const journey=document.createElement('button');journey.type='button';journey.id='motherJourneyLink';journey.className='mr-outline mr-journey-link';journey.dataset.mrGo='timeline';root.querySelector('.home-journey-copy').append(journey);
    const intro=document.createElement('p');intro.id='motherHeroIntro';root.querySelector('.home-heading').append(intro);
    document.addEventListener('click',event=>{
      const button=event.target.closest('[data-mr-go]');if(!button)return;
      const panel=button.dataset.mrGo;
      if(panel==='readings'){$('motherMoreCare').open=true;$('homeHealthCard').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});return;}
      document.querySelector('.sidebar .nav-item[data-panel="'+panel+'"]')?.click();
    });
  }
  function update(data,prefs,child) {
    mount();if(!mounted||!data?.user)return;
    const M=window.PatientModel,stage=M.stage(data.user,data.post,data.children),today=M.today();
    if($('shareJourney').parentElement!==$('motherMoreCare').querySelector('.mr-more-body'))$('motherMoreCare').querySelector('.mr-more-body').prepend($('shareJourney'));
    $('motherMoreCare').querySelector('summary span').textContent=T('More of your care · readings, appointments, vaccines & nearby care','आपकी और देखभाल · रीडिंग, अपॉइंटमेंट, टीके और नज़दीकी देखभाल');
    const journey=$('homeOpenJourney');
    journey.querySelector('.oh-section-heading').innerHTML='<h2>'+icon('heart')+T('YOUR CARE JOURNEY','आपकी देखभाल का सफ़र')+'</h2><button type="button" class="link-btn" data-mr-go="timeline">'+T('View full timeline','पूरी समयरेखा देखें')+' →</button>';
    const loading=!data.homeLoaded&&!data.offline&&!data.user.guest;
    if(loading){journey.setAttribute('aria-busy','true');$('homeOpenTimeline').innerHTML='<p class="mr-empty">'+T('Loading your recorded care…','आपकी दर्ज देखभाल लोड हो रही है…')+'</p>';for(const id of ['motherWellness','motherActivities','motherSupport'])$(id).replaceChildren();$('motherCatchup')?.remove();return;}
    journey.removeAttribute('aria-busy');
    const names={pregnancy:T('Pregnancy','गर्भावस्था'),delivery:T('Delivery','प्रसव'),postnatal:T('Postnatal care','प्रसवोत्तर देखभाल'),child:T('Child wellness','बच्चे की देखभाल')};
    const labels={review:T('Awaiting review','समीक्षा बाकी'),done:T('Recorded complete','रिकॉर्ड में पूरा'),attention:T('Needs follow-up','फॉलो-अप बाकी'),recorded:T('Birth recorded','जन्म दर्ज'),upcoming:T('Upcoming','आगामी'),unrecorded:T('Not recorded','दर्ज नहीं'),available:T('View records','रिकॉर्ड देखें'),syncing:T('Waiting to sync','सिंक होना बाकी')};
    $('homeOpenTimeline').innerHTML=buildJourney(data,stage,M.status).map(s=>'<button type="button" class="mr-stage mr-stage--'+s.state+'" data-mr-go="'+s.panel+'"><span class="mr-stage-dot">'+(s.state==='done'||s.state==='recorded'?'✓':icon(s.state==='attention'?'clock':s.key==='child'?'baby':'cal'))+'</span><strong>'+names[s.key]+'</strong><small>'+labels[s.state]+'</small></button>').join('');
    const open=M.gaps(data.milestones||[],stage).concat(stage.delivered?(data.post?.schedule||[]).filter(s=>s.status!=='done').map(s=>({...s,due_date:s.window_end,title:s.title,post:true})):[]).sort((a,b)=>String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')));
    const late=open.filter(s=>M.status(s)==='overdue'),pending=late[0]||open[0];
    let catchup=$('motherCatchup');if(!catchup){catchup=document.createElement('div');catchup.id='motherCatchup';journey.append(catchup);}
    catchup.className='mr-catchup'+(late.length?'':' mr-catchup--calm');
    catchup.innerHTML='<span class="mr-catchup-icon" aria-hidden="true">'+(late.length?'!':'♡')+'</span><div><h3>'+T(late.length?'Let’s catch up!':'One step at a time.',late.length?'आइए, बाकी देखभाल पूरी करें!':'एक समय में एक कदम।')+'</h3><p>'+E(pending?pending.title:T('No pending item is recorded. Explore your full timeline.','कोई बाकी कदम दर्ज नहीं है। अपनी पूरी समयरेखा देखें।'))+'</p></div><button type="button" data-mr-go="'+(pending?.post?'postpartum':'timeline')+'">'+T('View details','विवरण देखें')+' →</button>';
    $('motherWellness').innerHTML='<h2>'+icon('heart')+T('FOR YOU AND YOUR BABY','आपके और आपके बच्चे के लिए')+'</h2><div class="mr-wellness-grid"><button type="button" class="mr-wellness-tile" data-mr-go="'+(stage.delivered?'postpartum':'readings')+'"><span class="mr-tile-icon">'+icon('heart')+'</span><strong>'+T('Your wellness','आपकी सेहत')+'</strong><p>'+T(stage.delivered?'Recovery, readings and care for you.':'Your recorded readings and care notes.',stage.delivered?'आपके लिए स्वास्थ्य लाभ, रीडिंग और देखभाल।':'आपकी दर्ज रीडिंग और देखभाल के नोट।')+'</p><span class="mr-tile-link">'+T('View wellness','सेहत देखें')+' →</span></button><button type="button" class="mr-wellness-tile mr-wellness-tile--baby" data-mr-go="'+((data.children||[]).length?'children':'timeline')+'"><span class="mr-tile-icon">'+icon('baby')+'</span><strong>'+T((data.children||[]).length?'Your baby’s journey':'Your growing journey',(data.children||[]).length?'आपके बच्चे का सफ़र':'आपका बढ़ता सफ़र')+'</strong><p>'+T((data.children||[]).length?'Growth, vaccinations and little milestones.':'Explore your recorded pregnancy timeline.',(data.children||[]).length?'विकास, टीकाकरण और छोटे पड़ाव।':'अपनी दर्ज गर्भावस्था की समयरेखा देखें।')+'</p><span class="mr-tile-link">'+T('View milestones','पड़ाव देखें')+' →</span></button></div>';
    let note=$('motherJourneyNote');if(!note){note=document.createElement('p');note.id='motherJourneyNote';note.className='mr-methodology';journey.append(note);}note.textContent=T('Based on recorded care items, not a health assessment.','दर्ज देखभाल के कदमों पर आधारित, स्वास्थ्य का आकलन नहीं।');
    const rows=data.offline?[]:buildActivities(data,today);
    $('motherActivities').innerHTML='<header><h2>'+icon('clock')+T('UPCOMING & RECENT ACTIVITIES','आगामी और हाल की गतिविधियाँ')+'</h2><button type="button" class="link-btn" data-mr-go="timeline">'+T('View all','सभी देखें')+' →</button></header><div class="mr-activity-list">'+(rows.length?rows.map(r=>'<button type="button" class="mr-activity" data-mr-go="'+r.panel+'"><span class="mr-activity-dot '+(['completed','recorded'].includes(r.state)?'mr-activity-dot--done':'')+'" aria-hidden="true">'+(['completed','recorded'].includes(r.state)?'✓':'•')+'</span><time datetime="'+r.date+'">'+E(new Date(r.date+'T12:00:00').toLocaleDateString(document.documentElement.lang||'en-IN',{month:'short',day:'numeric'}))+'</time><span class="mr-activity-copy"><strong>'+E(r.title)+'</strong><small>'+E(r.detail)+'</small></span><span class="mr-activity-status">'+E(r.state==='completed'?T('Completed','पूरा'):r.state==='recorded'?T('Recorded','दर्ज'):r.state==='cancelled'?T('Cancelled','रद्द'):r.state==='confirmed'?T('Confirmed','पुष्ट'):T('Requested','अनुरोधित'))+'</span></button>').join(''):'<p class="mr-empty">'+T(data.offline?'Connect to refresh recorded activities.':'No visits or recent completed activities are recorded yet.',data.offline?'दर्ज गतिविधियाँ ताज़ा करने के लिए कनेक्ट करें।':'अभी कोई भेंट या हाल की पूरी गतिविधि दर्ज नहीं है।')+'</p>')+'</div>';
    $('motherSupport').innerHTML='<img src="assets/patient/mother-newborn-v1.png" alt="" loading="lazy"><div><h2>'+E(T('A little support, whenever you need it.','जब भी ज़रूरत हो, थोड़ा साथ।'))+'</h2><p>'+T('You don’t have to navigate every step alone. Keep your questions close.','हर कदम अकेले तय करना ज़रूरी नहीं। अपने सवाल साथ रखें।')+'</p><button type="button" class="mr-outline" data-mr-go="companion">'+icon('msg')+T('Chat with DaiHealth','DaiHealth से बात करें')+'</button></div>';
    const next=$('nextStepCard');next.querySelector('.home-kicker').innerHTML=icon('cal')+T('YOUR NEXT CARE STEP','आपकी अगली देखभाल');
    $('motherNextDetails').textContent=T('View details','विवरण देखें');$('motherNextDetails').dataset.mrGo=pending?.post?'postpartum':'timeline';
    $('motherJourneyLink').textContent=T('View your milestone journey →','अपने पड़ावों का सफ़र देखें →');
    $('motherHeroIntro').textContent=T('Let’s take care of you and your little ones. ♡','आइए, आपका और आपके नन्हों का ख्याल रखें। ♡');
    if(data.overview?.registered_facility?.name&&!data.offline)$('nextStepPlace').innerHTML=icon('pin')+'<span><small>'+T('Registered centre','पंजीकृत केंद्र')+'</small>'+E(data.overview.registered_facility.name)+'</span>';
    if(pending){$('nextStepTitle').textContent=pending.title;$('nextStepWhy').textContent=T('Your recorded care plan recommends a follow-up.','आपकी दर्ज देखभाल योजना में फॉलो-अप है।');}
    const months=stage.delivered&&validDate(data.post?.delivery?.date)?window.PatientHomeModel.age(data.post.delivery.date,today).months:null;
    $('nextStepBook').querySelector('span').textContent=T('Book appointment','अपॉइंटमेंट बुक करें');
    if(months!==null)$('homeGreetingSub').textContent=T('You’re '+months+' '+(months===1?'month':'months')+' into your postpartum journey.','प्रसव के बाद आपके सफ़र के '+months+' महीने हो चुके हैं।');
    const image=$('homeStageImage');
    if(stage.delivered&&(data.children||[]).length>=2){image.src='assets/patient/mother-twins-v1.png';image.alt=T('Illustration of a mother holding two babies','दो बच्चों को गोद में लिए माँ का चित्र');}
    $('homeBabyTabs').querySelectorAll('[data-home-child]').forEach((b,i)=>{const c=(data.children||[])[i];if(!c)return;const age=window.PatientHomeLayout.validBirthDate(c,today)?window.PatientHomeModel.age(c.date_of_birth,today):null;const name=/^CHILD-SYN-/.test(c.name||'')?T('Baby ','बच्चा ')+(i+1):c.name||T('Baby ','बच्चा ')+(i+1);b.innerHTML='<span class="mr-baby-avatar" aria-hidden="true">'+icon('baby')+'</span><span><strong>'+E(name)+'</strong><small>'+E(age?T(age.label,age.days+' दिन'):T('Age not recorded','उम्र दर्ज नहीं'))+'</small></span><span aria-hidden="true">›</span>';});
  }
  window.PatientHomeReference={update};
})();
