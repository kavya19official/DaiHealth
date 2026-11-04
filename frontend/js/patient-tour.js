/* Patient orientation only. No form submission, model call or clinical completion. */
(function () {
  'use strict';
  const steps = [
    ['dashboard', 'Your care, in one place', 'Home brings together your recorded care plan, appointments and your children’s updates.', 'Start here, then follow the next step that matters to you.'],
    ['timeline', 'Follow your care timeline', 'See upcoming, overdue and recorded completed care. Hospital follow-up tasks and their saved status appear here too.', 'A reminder or a self-report is not proof that clinical care is complete.'],
    ['gaps', 'Know what still needs attention', 'Pending care helps you find visits, tests and other recorded items that need follow-through.', 'Open an item to understand its date and next action.'],
    ['facilities', 'Find suitable care', 'Set a PIN code, or choose to allow device location, then select a care need. Matching explains service suitability, distance and preferences.', 'In the synthetic Delhi demo, try PIN 110017 and Pregnancy check-up. Location permission is always your choice.'],
    ['appointments', 'Request a visit and track the response', 'Review your appointments and hospital-managed requests. Authorised staff can accept a request, assign a clinician and record a time.', 'Send a fictional hospital request from Nearby care. A local demo request is not a real reservation.'],
    ['records', 'Keep the original report with its story', 'Upload a report for the correct person and choose which clinician may see it. Original files and review status stay visible.', 'Uploading a document does not mean a clinician has reviewed it.'],
    ['postpartum', 'Continue care after delivery', 'After delivery keeps recovery and postnatal follow-through in the same care space.', 'Your recorded stage determines which information is relevant.'],
    ['children', 'A separate story for each child', 'Choose a child to review their own visits, growth and vaccination information. Twins keep separate records.', 'Always check whose record is selected before adding information.'],
    ['family', 'Choose who can see your information', 'Review sharing and caregiver options. You can manage access and see the available access history.', 'A tour never changes your consent or grants record access.'],
    ['messages', 'Keep the care conversation connected', 'Updates brings together saved coordination messages and care-team communication available to your account.', 'For urgent concerns use the emergency help controls; do not wait for a message reply.'],
    ['settings', 'Make this space work for you', 'Review the available reading, language and low-bandwidth preferences. You can restart this tour using Guide at the top of the page.', 'You are ready. Explore at your pace; nothing was submitted or marked complete by this tour.']
  ];
  let index=0, layer, card, spot, previousFocus, originalPanel, timer, details=[];
  const $=s=>document.querySelector(s);
  function navigate(panel) {
    const nav=$('.sidebar .nav-item[data-panel="'+panel+'"]');
    if(!nav)return;
    const parent=nav.closest('details');if(parent)parent.open=true;
    nav.click();
    if(innerWidth>=1000)nav.scrollIntoView({block:'nearest',behavior:'instant'});
  }
  function place() {
    if(!layer)return;
    const nav=$('.sidebar .nav-item[data-panel="'+steps[index][0]+'"]');
    const panel=$('#panel-'+steps[index][0]);
    let target=nav;
    if(innerWidth<1000 || !nav?.getClientRects().length) target=panel?.querySelector('h1,h2,.page-section-heading')||panel;
    if(!target)return;
    const r=target.getBoundingClientRect(), margin=12;
    const left=Math.max(8,r.left-6),top=Math.max(8,r.top-6);
    spot.style.cssText='left:'+left+'px;top:'+top+'px;width:'+Math.max(0,Math.min(r.width+12,innerWidth-left-8))+'px;height:'+Math.max(0,Math.min(r.height+12,innerHeight-top-8,150))+'px';
    const w=Math.min(380,innerWidth-24);card.style.width=w+'px';
    const height=card.getBoundingClientRect().height;
    let x=innerWidth<1000?(innerWidth-w)/2:Math.min(r.right+22,innerWidth-w-margin);
    let y=innerWidth<1000?Math.min(Math.max(top+Math.min(r.height,150)+22,110),innerHeight-height-margin):Math.min(Math.max(top-12,margin),innerHeight-height-margin);
    card.style.left=Math.max(margin,x)+'px';card.style.top=Math.max(margin,y)+'px';
  }
  function render() {
    clearTimeout(timer);navigate(steps[index][0]);
    card.querySelector('[data-tour-count]').textContent='STEP '+(index+1)+' OF '+steps.length;
    card.querySelector('progress').value=index+1;
    card.querySelector('h2').textContent=steps[index][1];
    card.querySelector('[data-tour-copy]').textContent=steps[index][2];
    card.querySelector('[data-tour-note]').textContent=steps[index][3];
    card.querySelector('[data-tour-back]').disabled=index===0;
    card.querySelector('[data-tour-next]').textContent=index===steps.length-1?'Finish tour':'Next step →';
    card.querySelector('[data-tour-route]').textContent=($('.sidebar .nav-item[data-panel="'+steps[index][0]+'"] span')?.textContent||'Patient dashboard');
    place();timer=setTimeout(place,350);
    card.focus({preventScroll:true});
  }
  function stop(completed) {
    if(!layer)return;
    clearTimeout(timer);layer.remove();layer=null;document.documentElement.classList.remove('patient-tour-active');
    details.forEach(([el,open])=>{el.open=open;});
    if(!completed)navigate(originalPanel);
    window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);
    previousFocus?.focus({preventScroll:true});
    const status=$('#patientTourAnnouncement');if(status)status.textContent=completed?'Tour complete. No patient records were changed.':'Tour closed. You can restart with Guide.';
  }
  function start() {
    if(layer)return;
    previousFocus=document.activeElement;originalPanel=$('.panel.is-active')?.id.replace('panel-','')||'dashboard';
    details=[...document.querySelectorAll('.sidebar details')].map(el=>[el,el.open]);index=0;
    document.documentElement.classList.add('patient-tour-active');
    layer=document.createElement('div');layer.className='patient-tour-layer';
    layer.innerHTML='<div class="patient-tour-spot" aria-hidden="true"></div><section class="patient-tour-card" role="dialog" aria-modal="true" aria-labelledby="patientTourTitle" aria-describedby="patientTourCopy" tabindex="-1"><header><span data-tour-count></span><button type="button" data-tour-close aria-label="Close guided tour">×</button></header><progress max="'+steps.length+'" value="1" aria-label="Tour progress"></progress><span class="patient-tour-route" data-tour-route></span><h2 id="patientTourTitle"></h2><p id="patientTourCopy" data-tour-copy></p><div class="patient-tour-note" data-tour-note></div><footer><button type="button" data-tour-skip>Skip tour</button><div><button type="button" data-tour-back>Back</button><button type="button" data-tour-next>Next step →</button></div></footer><small>Orientation only · your records stay unchanged</small></section>';
    document.body.append(layer);card=layer.querySelector('.patient-tour-card');spot=layer.querySelector('.patient-tour-spot');
    layer.querySelector('[data-tour-close]').onclick=()=>stop(false);layer.querySelector('[data-tour-skip]').onclick=()=>stop(false);
    layer.querySelector('[data-tour-back]').onclick=()=>{if(index>0){index--;render();}};
    layer.querySelector('[data-tour-next]').onclick=()=>{if(index===steps.length-1){stop(true);return;}index++;render();};
    layer.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();stop(false);return;}
      if(e.key==='Tab'){const buttons=[...card.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===card)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    });
    window.addEventListener('resize',place);window.addEventListener('scroll',place,true);render();
  }
  function setup() {
    const right=$('.topbar__right');if(!right)return;
    const button=document.createElement('button');button.type='button';button.className='patient-tour-launch';button.id='patientTourStart';button.textContent='?';button.title='Take a guided tour of your patient dashboard';button.setAttribute('aria-label','Start patient dashboard guided tour');button.onclick=start;right.prepend(button);
    const home=$('#panel-dashboard');if(home){const intro=document.createElement('section');intro.className='patient-tour-welcome';intro.innerHTML='<div><span>NEW TO DAI?</span><h2>A little guidance, every step of the way.</h2><p>Discover your timeline, find care and follow updates—with a quick guided tour.</p></div><button type="button">Show me around <span aria-hidden="true">↗</span></button>';intro.innerHTML='<div><span>NEW TO DAI?</span><strong>A quick guide to your care</strong></div><button type="button" data-tour-welcome-start>Show me around ↗</button><button type="button" data-tour-dismiss aria-label="Dismiss welcome guide">×</button>';
      const key='dai-patient-tour-welcome-v1';let seen=false;try{seen=localStorage.getItem(key)==='seen';localStorage.setItem(key,'seen');}catch{}
      function collapse(){intro.classList.add('is-dismissed');intro.querySelector('div').hidden=true;intro.querySelector('[data-tour-dismiss]').hidden=true;intro.querySelector('[data-tour-welcome-start]').textContent=document.documentElement.lang==='hi'?'त्वरित परिचय ↗':'Quick tour ↗';}
      intro.querySelector('[data-tour-welcome-start]').onclick=()=>{collapse();start();};intro.querySelector('[data-tour-dismiss]').onclick=collapse;if(seen)collapse();home.prepend(intro);}
    const status=document.createElement('span');status.id='patientTourAnnouncement';status.className='patient-tour-sr';status.setAttribute('role','status');document.body.append(status);
  }
  function translate(){
    const hi=document.documentElement.lang==='hi',intro=$('.patient-tour-welcome'),button=$('#patientTourStart');
    if(button)button.setAttribute('aria-label',hi?'डैशबोर्ड का परिचय शुरू करें':'Start patient dashboard guided tour');
    if(intro){intro.querySelector('div>span').textContent=hi?'DAI में नए हैं?':'NEW TO DAI?';intro.querySelector('strong').textContent=hi?'देखभाल का छोटा परिचय':'A quick guide to your care';intro.querySelector('[data-tour-welcome-start]').textContent=intro.classList.contains('is-dismissed')?(hi?'त्वरित परिचय ↗':'Quick tour ↗'):(hi?'मुझे समझाएँ ↗':'Show me around ↗');intro.querySelector('[data-tour-dismiss]').setAttribute('aria-label',hi?'परिचय बंद करें':'Dismiss welcome guide');}
  }
  window.PatientTour={start,translate};window.addEventListener('dai:lang',translate);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
