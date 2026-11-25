(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=(path,options)=>window.DaiAPI.apiRequest(path,options);
  const panel=$('panel-family');
  if(!panel)return;

  const scopeNames={appointments:'Upcoming appointments',urgent_help:'Danger signs & emergency help',birth_plan:'Facility & transport plan',support_tips:'Practical support & rest requests',care_timeline:'Care timeline',child_growth:'Selected child growth',emergency_alert:'May start an emergency alert for me (prototype)'};
  const relationNames={partner:'Partner',parent:'Parent or elder',sibling:'Sibling',relative:'Relative',caregiver:'Caregiver',other:'Trusted person'};
  const presetScopes={essential:['appointments','urgent_help','birth_plan','support_tips'],child:['appointments','support_tips','child_growth']};
  let grants=[],children=[],recent=[],household=null,selectedId=null,step=1,preset='essential';

  const root=document.createElement('section');
  root.id='familyCircleExperience';
  root.className='fcx';
  root.innerHTML=`
    <header class="fcx-head">
      <div><span class="fcx-kicker">YOUR PEOPLE. YOUR PERMISSION.</span><h2>Your Family Circle</h2><p>See who can help, what they can view and when their access ends.</p></div>
      <button type="button" class="btn btn--primary" data-fcx-invite>Invite someone</button>
    </header>
    <section class="fcx-household" data-fcx-household hidden aria-label="Child and support circle"></section>
    <div data-fcx-result role="status" aria-live="polite"></div>
    <section class="fcx-overview" aria-label="Family access overview">
      <div class="fcx-map" data-fcx-map></div>
      <aside class="fcx-detail" data-fcx-detail></aside>
    </section>
    <section class="fcx-bottom">
      <article class="fcx-card"><header><div><span class="fcx-kicker">RECENT ACCESS</span><h3>What happened recently</h3></div><button type="button" class="link-btn" data-fcx-refresh>Refresh</button></header><div data-fcx-activity></div></article>
      <article class="fcx-card fcx-automation"><span class="fcx-kicker">AUTOMATIC SAFEGUARDS</span><h3>Access looks after itself</h3><ul><li>Invitations expire automatically.</li><li>Expiring access is highlighted early.</li><li>Every opening is recorded privately.</li><li>You can revoke access immediately.</li></ul></article>
    </section>
    <details class="fcx-advanced"><summary>Advanced privacy controls</summary><p>Clinician sharing, individual report permissions, emergency contacts and technical controls.</p><div data-fcx-advanced></div></details>
    <dialog class="fcx-dialog" data-fcx-dialog aria-labelledby="fcxDialogTitle">
      <form id="fcxInviteForm">
        <header><div><span class="fcx-kicker">PRIVATE INVITATION</span><h2 id="fcxDialogTitle">Invite someone you trust</h2></div><button type="button" class="fcx-close" data-fcx-close aria-label="Close">×</button></header>
        <div class="fcx-progress" aria-label="Invitation progress"><span data-step="1">Person</span><span data-step="2">Access</span><span data-step="3">Review</span></div>
        <section class="fcx-step" data-fcx-step="1">
          <h3>Who would you like to invite?</h3>
          <label class="fcx-field">Their email address<input type="email" name="email" maxlength="254" autocomplete="email" placeholder="family@example.com" required></label>
          <fieldset><legend>Relationship</legend><div class="fcx-choice-grid">${Object.entries(relationNames).map(([value,label],i)=>`<label><input type="radio" name="relationship" value="${value}" ${i===0?'checked':''}><span><b>${E(label)}</b><small>${value==='partner'?'Help with plans and appointments':'A trusted support person'}</small></span></label>`).join('')}</div></fieldset>
        </section>
        <section class="fcx-step" data-fcx-step="2" hidden>
          <h3>What kind of help do they need?</h3>
          <div class="fcx-preset-grid">
            <label><input type="radio" name="preset" value="essential" checked><span><b>Essential support <em>Recommended</em></b><small>Appointments, urgent help, transport and practical support.</small></span></label>
            <label><input type="radio" name="preset" value="child"><span><b>Child support</b><small>Appointments, support tips and selected child growth.</small></span></label>
            <label><input type="radio" name="preset" value="custom"><span><b>Custom access</b><small>Choose each information category yourself.</small></span></label>
          </div>
          <fieldset class="fcx-custom" data-fcx-custom hidden><legend>Choose individual categories</legend><div class="fcx-scope-grid">${Object.entries(scopeNames).map(([value,label])=>`<label><input type="checkbox" name="scope" value="${value}"><span><b>${E(label)}</b><small>${value==='urgent_help'?'Emergency contacts and urgent signs only.':'Only this selected category.'}</small></span></label>`).join('')}</div></fieldset>
          <fieldset class="fcx-child-choice" data-fcx-children hidden><legend>Select children</legend><div></div></fieldset>
        </section>
        <section class="fcx-step" data-fcx-step="3" hidden>
          <h3>Check before you invite</h3><div class="fcx-review" data-fcx-review></div>
          <label class="fcx-field">Access duration<select name="days"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></label>
          <label class="fcx-confirm"><input type="checkbox" name="confirmed" required><span>I chose this person and confirm these specific permissions.</span></label>
        </section>
        <p class="fcx-form-status" data-fcx-form-status role="status"></p>
        <footer><button type="button" class="btn btn--ghost" data-fcx-back hidden>Back</button><button type="button" class="btn btn--primary" data-fcx-next>Continue</button><button type="submit" class="btn btn--primary" data-fcx-submit hidden>Send private invitation</button></footer>
      </form>
    </dialog>`;
  panel.querySelector('.page-section-heading').after(root);

  const form=$('fcxInviteForm'),dialog=root.querySelector('[data-fcx-dialog]');
  const daysLeft=grant=>Math.max(0,Math.ceil((new Date(grant.expires_at)-Date.now())/86400000));
  const statusOf=grant=>grant.revoked_at?'revoked':new Date(grant.expires_at)<=new Date()?'expired':!grant.accepted?'pending':daysLeft(grant)<=2?'expiring':'active';
  const statusLabel={active:'Active',pending:'Invitation pending',expiring:'Expiring soon',expired:'Expired',revoked:'Revoked'};
  const avatar=(name,role)=>'<img src="assets/'+(name==='Aarav Sethi'?'toddler-world-cartoon.png':role==='outreach_worker'?'avatar-ritu.svg':'avatar-kabir.svg')+'" alt="" width="64" height="64">';
  const initials=email=>String(email||'?').split('@')[0].split(/[._\s-]/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
  const selectedScopes=()=>preset==='custom'?[...form.querySelectorAll('[name="scope"]:checked')].map(x=>x.value):presetScopes[preset]||[];
  const selectedChildren=()=>[...form.querySelectorAll('[name="child"]:checked')].map(x=>Number(x.value));

  function moveTechnicalAudit(){
    const audit=$('consentAuditCard'),settings=$('panel-settings');
    if(!audit||!settings||audit.closest('[data-fcx-audit]'))return;
    const wrap=document.createElement('details');wrap.className='connected-care-card';wrap.dataset.fcxAudit='';wrap.innerHTML='<summary><strong>Full technical access log</strong></summary><p>Advanced verification, signed receipts and tamper checks.</p>';wrap.append(audit);settings.append(wrap);
  }
  function collectAdvanced(){
    const target=root.querySelector('[data-fcx-advanced]');
    for(const node of [$('clinicalSummaryConsent'),$('familyAdvanced')])if(node&&node.parentElement!==target)target.append(node);
    for(const node of [$('supportFamily'),$('realFamilyAccess')])if(node)node.hidden=true;
    moveTechnicalAudit();
  }

  const householdText=()=>({
    en:{title:'Your child & support circle',sub:'A little care for your child. A few trusted people beside you.',demo:'Fictional demo family',son:'Son',born:'Born',birthWeight:'Birth weight',latest:'Latest recorded growth',reviewed:'Clinician review recorded',next:'Routine child review',history:'Child records',historyText:'Earlier infant growth and vaccination history stay in the child record.',vaccineUnknown:'No vaccine dates recorded. Status is unknown until original records are added.',vaccineCount:'recorded vaccine entries',open:'Open child records',partner:'Partner',outreach_worker:'Assigned outreach worker',transport:'Transport',visit_companion:'Visit companion',toddler_care:'Toddler care',outreach:'Outreach and follow-up support',access:'Existing sharing permissions',noAccess:'Support role only. No record access is granted by this card.',current:'Current journey: pregnancy',past:'Postpartum and infant-feeding records belong to the earlier birth.',previous:'Earlier birth',years:'years',months:'months',dateUnknown:'Date not recorded',pending:'Request pending',confirmed:'Confirmed',noVisit:'No upcoming child review recorded'},
    hi:{title:'आपका बच्चा और सहारा देने वाले लोग',sub:'बच्चे की देखभाल और आपके साथ खड़े भरोसेमंद लोग।',demo:'काल्पनिक डेमो परिवार',son:'बेटा',born:'जन्म',birthWeight:'जन्म के समय वज़न',latest:'नवीनतम दर्ज विकास',reviewed:'चिकित्सक की समीक्षा दर्ज है',next:'बच्चे की नियमित जाँच',history:'बच्चे के रिकॉर्ड',historyText:'शिशु अवस्था के विकास और टीकाकरण का इतिहास बच्चे के रिकॉर्ड में रहता है।',vaccineUnknown:'टीके की तारीखें दर्ज नहीं हैं। मूल रिकॉर्ड जुड़ने तक स्थिति अज्ञात है।',vaccineCount:'दर्ज टीकाकरण प्रविष्टियाँ',open:'बच्चे के रिकॉर्ड खोलें',partner:'जीवनसाथी',outreach_worker:'नियुक्त सहायता कार्यकर्ता',transport:'आने-जाने की व्यवस्था',visit_companion:'भेंट में साथ',toddler_care:'बच्चे की देखभाल',outreach:'संपर्क और फॉलो-अप में मदद',access:'मौजूदा साझाकरण अनुमतियाँ',noAccess:'केवल सहायता की भूमिका। इस कार्ड से रिकॉर्ड देखने की अनुमति नहीं मिलती।',current:'अभी का सफ़र: गर्भावस्था',past:'प्रसव के बाद और शिशु को खिलाने के रिकॉर्ड पहले जन्म से जुड़े हैं।',previous:'पहले बच्चे का जन्म',years:'वर्ष',months:'महीने',dateUnknown:'तारीख दर्ज नहीं है',pending:'अनुरोध लंबित',confirmed:'पुष्टि हो चुकी है',noVisit:'बच्चे की आगामी जाँच दर्ज नहीं है'},
    mr:{title:'तुमचे मूल आणि आधार देणारी माणसे',sub:'मुलाची काळजी आणि तुमच्या पाठीशी असलेली विश्वासू माणसे.',demo:'काल्पनिक डेमो कुटुंब',son:'मुलगा',born:'जन्म',birthWeight:'जन्मावेळचे वजन',latest:'नवीनतम नोंदवलेली वाढ',reviewed:'डॉक्टरांचा आढावा नोंदवला आहे',next:'मुलाची नियमित तपासणी',history:'मुलाच्या नोंदी',historyText:'अर्भकावस्थेतील वाढ आणि लसीकरणाचा इतिहास मुलाच्या नोंदींमध्ये राहतो.',vaccineUnknown:'लसीकरणाच्या तारखा नोंदवलेल्या नाहीत. मूळ नोंदी जोडेपर्यंत स्थिती अज्ञात आहे.',vaccineCount:'नोंदवलेल्या लसीकरण नोंदी',open:'मुलाच्या नोंदी उघडा',partner:'जोडीदार',outreach_worker:'नियुक्त संपर्क कार्यकर्ती',transport:'प्रवासाची व्यवस्था',visit_companion:'भेटीसाठी सोबत',toddler_care:'लहान मुलाची काळजी',outreach:'संपर्क आणि पाठपुराव्यात मदत',access:'सध्याच्या शेअरिंग परवानग्या',noAccess:'फक्त मदतीची भूमिका. या कार्डमुळे नोंदी पाहण्याची परवानगी मिळत नाही.',current:'सध्याचा प्रवास: गर्भावस्था',past:'प्रसूतीनंतरच्या आणि बाळाच्या आहाराच्या नोंदी आधीच्या जन्माशी संबंधित आहेत.',previous:'आधीचा जन्म',years:'वर्षे',months:'महिने',dateUnknown:'तारीख नोंदवलेली नाही',pending:'विनंती प्रलंबित',confirmed:'पुष्टी झाली आहे',noVisit:'मुलाची पुढील तपासणी नोंदवलेली नाही'}
  }[document.documentElement.lang.split('-')[0]]||householdEnglish);
  const householdEnglish={title:'Your child & support circle',sub:'The people beside you.',demo:'Fictional demo family',son:'Son',born:'Born',birthWeight:'Birth weight',latest:'Latest recorded growth',reviewed:'Clinician review recorded',next:'Routine child review',history:'Child records',historyText:'Earlier infant growth and vaccination history stay in the child record.',vaccineUnknown:'No vaccine dates recorded. Status unknown.',vaccineCount:'recorded vaccine entries',open:'Open child records',partner:'Partner',outreach_worker:'Assigned outreach worker',transport:'Transport',visit_companion:'Visit companion',toddler_care:'Toddler care',outreach:'Outreach and follow-up support',access:'Existing sharing permissions',noAccess:'Support role only. No record access is granted by this card.',current:'Current journey: pregnancy',past:'Postpartum and infant-feeding records belong to the earlier birth.',previous:'Earlier birth',years:'years',months:'months',dateUnknown:'Date not recorded',pending:'Request pending',confirmed:'Confirmed',noVisit:'No upcoming child review recorded'};
  const personForGrant=grant=>(household?.people||[]).find(person=>person.grant_id===grant.id);
  function renderHousehold(){
    const host=root.querySelector('[data-fcx-household]');host.hidden=!household?.child;if(host.hidden){host.replaceChildren();return;}
    const t=householdText(),c=household.child,latest=c.growth?.[0],visit=c.next_review,review=c.growth_review;
    const locale=document.documentElement.lang==='en'?'en-IN':document.documentElement.lang||'en-IN',date=v=>v?new Date(String(v).slice(0,10)+'T12:00:00Z').toLocaleDateString(locale,{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}):t.dateUnknown;
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),birth=String(c.date_of_birth).slice(0,10);
    const [ty,tm,td]=today.split('-').map(Number),[by,bm,bd]=birth.split('-').map(Number),months=Math.max(0,(ty-by)*12+tm-bm-(td<bd?1:0));
    const age=Math.floor(months/12)+' '+t.years+' '+months%12+' '+t.months;
    const number=v=>v==null?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(Number(v));
    host.innerHTML='<header class="fcx-household-head"><div><span class="fcx-kicker">'+E(t.title)+'</span><h2><span data-person-name>'+E(c.name)+'</span> &amp; '+(locale==='hi'?'आपके अपने':locale==='mr'?'तुमची माणसे':'your people')+'</h2><p>'+E(t.sub)+'</p></div>'+(household.synthetic?'<span class="fcx-demo-tag">'+E(t.demo)+'</span>':'')+'</header><div class="fcx-household-grid"><article class="fcx-child-story"><div class="fcx-child-title"><span class="fcx-child-avatar" aria-hidden="true">'+avatar(c.name,'child')+'</span><div><h3 data-person-name>'+E(c.name)+'</h3><p>'+E(t.son+' · '+age)+'</p><small>'+E(t.born+' '+date(c.date_of_birth))+'</small></div></div><div class="fcx-child-facts"><div><small>'+E(t.birthWeight)+'</small><strong>'+number(c.birth_weight_kg)+' kg</strong></div><div><small>'+E(t.latest)+'</small><strong>'+(latest?number(latest.weight_kg)+' kg / '+number(latest.height_cm)+' cm':'—')+'</strong><small>'+(latest?E(date(latest.measured_on)):'')+'</small></div></div>'+(review?'<div class="fcx-growth-review"><span aria-hidden="true">✓</span><div><strong>'+E(t.reviewed)+'</strong><small>'+E(date(review.recorded_on))+(review.doctor_name?' · <span data-person-name>'+E(review.doctor_name)+'</span>':'')+'</small></div></div>':'')+'<div class="fcx-child-next"><small>'+E(t.next)+'</small><strong>'+E(visit?date(visit.requested_date):t.noVisit)+'</strong>'+(visit?'<span>'+E(visit.status==='confirmed'?t.confirmed:t.pending)+'</span>':'')+'</div><p>'+E(t.historyText)+'</p><p class="fcx-vaccine-status">'+E(c.vaccinations?.length?c.vaccinations.length+' '+t.vaccineCount:t.vaccineUnknown)+'</p><button type="button" class="btn btn--secondary" data-fcx-child-record="'+E(c.id)+'">'+E(t.open)+' ↗</button></article><div class="fcx-support-people">'+(household.people||[]).map(person=>{const grant=grants.find(g=>g.id===person.grant_id),active=grant&&['active','expiring'].includes(statusOf(grant));return '<article class="fcx-support-person"><div class="fcx-support-title"><span aria-hidden="true">'+avatar(person.name,person.relationship)+'</span><div><h3 data-person-name>'+E(person.name)+'</h3><small>'+E(t[person.relationship]||person.relationship)+'</small></div></div><div class="fcx-support-tasks">'+(person.responsibilities||[]).map(key=>'<span>'+E(t[key]||key)+'</span>').join('')+'</div><p>'+E(active?t.access:t.noAccess)+'</p>'+(active?'<div class="fcx-support-permissions">'+grant.scopes.map(key=>'<small>'+E(scopeNames[key]||key)+'</small>').join('')+'</div>':'')+'</article>';}).join('')+'</div></div><footer class="fcx-household-note"><strong>'+E(household.current_journey?.pregnancy_status==='pregnant'?t.current:t.history)+'</strong><span>'+E(t.past)+(household.previous_birth?.date?' '+E(t.previous+': '+date(household.previous_birth.date))+'.':'')+'</span></footer>';
  }

  function renderMap(){
    const current=grants.filter(g=>['active','pending','expiring'].includes(statusOf(g))),map=root.querySelector('[data-fcx-map]');
    if(selectedId&&!grants.some(g=>g.id===selectedId))selectedId=null;
    const name=($('userName')?.textContent||'You').replace(/^SYNTHETIC\s+/i,'').split(' ')[0];
    map.innerHTML='<div class="fcx-map-ring" aria-hidden="true"></div><div class="fcx-centre"><svg aria-hidden="true"><use href="#i-shield"/></svg><strong>'+E(name)+'</strong><small>You decide</small></div>'+(current.length?current.map((g,i)=>{const angle=-90+(360/current.length)*i,x=50+32*Math.cos(angle*Math.PI/180),y=50+32*Math.sin(angle*Math.PI/180),selected=g.id===selectedId,dimmed=selectedId&&!selected,label=personForGrant(g)?.name||relationNames[g.relationship]||'Trusted person';return '<button type="button" class="fcx-person is-'+statusOf(g)+(selected?' is-selected':'')+(dimmed?' is-dimmed':'')+'" style="--x:'+x+'%;--y:'+y+'%" data-fcx-person="'+E(g.id)+'" aria-label="View access for '+E(label)+'"><span>'+avatar(personForGrant(g)?.name,g.relationship)+'</span><strong>'+E(label)+'</strong><small>'+E(statusLabel[statusOf(g)])+'</small><em>View access <b aria-hidden="true">→</b></em></button>';}).join(''):'<button type="button" class="fcx-person fcx-person-empty" style="--x:50%;--y:16%" data-fcx-invite><span>+</span><strong>Invite your first person</strong><small>No one has access</small></button>');
    renderDetail();
  }

  function selectPerson(id){
    selectedId=id;
    root.querySelectorAll('[data-fcx-person]').forEach(node=>{
      const selected=node.dataset.fcxPerson===selectedId;
      node.classList.toggle('is-selected',selected);
      node.classList.toggle('is-dimmed',!selected);
      if(selected)node.setAttribute('aria-current','true');else node.removeAttribute('aria-current');
    });
    renderDetail();
  }

  function renderDetail(){
    const host=root.querySelector('[data-fcx-detail]'),grant=grants.find(g=>g.id===selectedId);
    if(!grant){host.innerHTML='<div class="fcx-detail-empty"><svg aria-hidden="true"><use href="#i-user"/></svg><h3>Select a person</h3><p>Choose someone in the circle to see exactly what they can access.</p><button type="button" class="btn btn--primary" data-fcx-invite>Invite someone</button></div>';return;}
    const status=statusOf(grant),childNames=(grant.child_ids||[]).map(id=>children.find(c=>c.id===id)?.name).filter(Boolean);
    host.innerHTML='<header><span class="fcx-avatar">'+avatar(personForGrant(grant)?.name,grant.relationship)+'</span><div><span class="fcx-status is-'+status+'">'+E(statusLabel[status])+'</span><h3>'+E(relationNames[grant.relationship]||'Trusted person')+'</h3><p>'+E(grant.recipient_email)+'</p></div></header><div class="fcx-access-summary"><strong>Can view</strong><div>'+grant.scopes.map(s=>'<span>'+E(scopeNames[s]||s)+'</span>').join('')+'</div></div>'+(childNames.length?'<p class="fcx-detail-line"><b>Children:</b> '+E(childNames.join(', '))+'</p>':'')+'<p class="fcx-detail-line"><b>Access ends:</b> '+E(new Date(grant.expires_at).toLocaleString())+(status==='active'||status==='expiring'?' · '+daysLeft(grant)+' day'+(daysLeft(grant)===1?'':'s')+' left':'')+'</p><p class="fcx-detail-line"><b>Last opened:</b> '+E(grant.last_viewed_at?new Date(grant.last_viewed_at).toLocaleString():'Not opened yet')+'</p>'+(!['revoked','expired'].includes(status)?'<div class="fcx-detail-actions"><button type="button" class="btn btn--ghost" data-fcx-renew="'+E(grant.id)+'">Renew 7 days</button><button type="button" class="btn btn--ghost fcx-danger" data-fcx-revoke="'+E(grant.id)+'">Revoke access</button></div>':'<p class="fcx-ended">This person no longer has access.</p>');
  }

  function renderActivity(){
    const host=root.querySelector('[data-fcx-activity]'),labels={invite_created:'Invitation created',accepted:'Invitation accepted',read:'Shared view opened',revoked:'Access revoked',renewed:'Access renewed'};
    host.innerHTML=recent.length?recent.slice(0,5).map(item=>'<div class="fcx-activity-row"><span class="fcx-activity-icon">'+(item.action==='read'?'◉':'✓')+'</span><div><strong>'+E(labels[item.action]||'Access updated')+'</strong><small>'+E(item.recipient_email||'Family access')+' · '+E(new Date(item.created_at).toLocaleString())+'</small></div></div>').join(''):'<div class="fcx-empty"><strong>No family access activity yet</strong><p>Invitations and visits will appear here in simple language.</p></div>';
  }

  function render(){renderHousehold();renderMap();renderActivity();const active=grants.filter(g=>['active','pending','expiring'].includes(statusOf(g))).length;root.querySelector('.fcx-head p').textContent=active?active+' person'+(active===1?' has':'s have')+' current or pending access. Select anyone to review it.':'No one currently has access. You are in control.';}

  async function load(){
    const [grantData,childData,householdData]=await Promise.all([api('/patient/family-grants'),api('/children'),api('/patient/family-circle-profile')]);
    household=householdData?.household||null;
    if(grantData){grants=grantData.grants||[];recent=grantData.recent_access||[];if(!selectedId)selectedId=grants.find(g=>['active','pending','expiring'].includes(statusOf(g)))?.id||null;}
    if(childData)children=childData.children||[];
    const picker=form.querySelector('[data-fcx-children] div');picker.innerHTML=children.map(child=>'<label><input type="checkbox" name="child" value="'+E(child.id)+'"><span>'+E(child.name)+'</span></label>').join('')||'<p>No child profiles are linked.</p>';
    render();window.dispatchEvent(new CustomEvent('dai:family-grants',{detail:grants}));
  }

  function showStep(next){
    step=Math.max(1,Math.min(3,next));
    form.querySelectorAll('[data-fcx-step]').forEach(section=>section.hidden=Number(section.dataset.fcxStep)!==step);
    form.querySelectorAll('.fcx-progress span').forEach(item=>item.classList.toggle('is-current',Number(item.dataset.step)===step));
    form.querySelector('[data-fcx-back]').hidden=step===1;form.querySelector('[data-fcx-next]').hidden=step===3;form.querySelector('[data-fcx-submit]').hidden=step!==3;
    if(step===3)renderReview();
  }
  function renderReview(){
    const email=form.elements.email.value,relationship=relationNames[form.elements.relationship.value],scopes=selectedScopes(),childNames=selectedChildren().map(id=>children.find(c=>c.id===id)?.name).filter(Boolean);
    form.querySelector('[data-fcx-review]').innerHTML='<div><span>Person</span><strong>'+E(email)+'</strong><small>'+E(relationship)+'</small></div><div><span>They can view</span><strong>'+E(scopes.map(s=>scopeNames[s]).join(', '))+'</strong>'+(childNames.length?'<small>For '+E(childNames.join(', '))+'</small>':'')+'</div><p>Private reports, wellbeing answers and clinician notes are not included.</p>';
  }
  function openInvite(){form.reset();preset='essential';form.querySelector('[name="preset"][value="essential"]').checked=true;form.querySelector('[data-fcx-custom]').hidden=true;form.querySelector('[data-fcx-children]').hidden=true;form.querySelector('[data-fcx-form-status]').textContent='';showStep(1);dialog.showModal();}

  root.addEventListener('change',event=>{
    if(event.target.name==='preset'){preset=event.target.value;form.querySelector('[data-fcx-custom]').hidden=preset!=='custom';form.querySelector('[data-fcx-children]').hidden=!selectedScopes().includes('child_growth');}
    if(event.target.name==='scope')form.querySelector('[data-fcx-children]').hidden=!selectedScopes().includes('child_growth');
  });
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.fcxChildRecord){window.PatientExperience?.openChild(button.dataset.fcxChildRecord);return;}
    if(button.hasAttribute('data-fcx-invite'))openInvite();
    if(button.hasAttribute('data-fcx-close'))dialog.close();
    if(button.hasAttribute('data-fcx-refresh'))load();
    if(button.dataset.fcxPerson)selectPerson(button.dataset.fcxPerson);
    if(button.hasAttribute('data-fcx-next')){
      const status=form.querySelector('[data-fcx-form-status]');status.textContent='';
      if(step===1&&!form.elements.email.checkValidity()){form.elements.email.reportValidity();return;}
      if(step===2){const scopes=selectedScopes();if(!scopes.length){status.textContent='Choose at least one information category.';return;}if(scopes.includes('child_growth')&&!selectedChildren().length){status.textContent='Choose each child whose growth may be shared.';return;}}
      showStep(step+1);
    }
    if(button.hasAttribute('data-fcx-back'))showStep(step-1);
    if(button.dataset.fcxRenew){button.disabled=true;const result=await api('/patient/family-grants/'+button.dataset.fcxRenew,{method:'PATCH',body:{days:7,confirmed:true}});if(result){window.DaiAPI.toast('Access renewed for 7 days.');await load();}else button.disabled=false;}
    if(button.dataset.fcxRevoke){if(!confirm('Revoke this person’s access now?'))return;button.disabled=true;const result=await api('/patient/family-grants/'+button.dataset.fcxRevoke,{method:'DELETE'});if(result){window.DaiAPI.toast('Family access revoked.');selectedId=null;await load();}else button.disabled=false;}
    if(button.hasAttribute('data-fcx-copy')){await navigator.clipboard.writeText(button.dataset.link);window.DaiAPI.toast('Invitation link copied.');}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();const status=form.querySelector('[data-fcx-form-status]'),submit=form.querySelector('[data-fcx-submit]'),scopes=selectedScopes();
    if(!form.elements.confirmed.checked){form.elements.confirmed.reportValidity();return;}submit.disabled=true;status.textContent='Creating your private invitation…';
    try{const result=await api('/patient/family-grants',{method:'POST',body:{email:form.elements.email.value,relationship:form.elements.relationship.value,scopes,child_ids:selectedChildren(),days:Number(form.elements.days.value),confirmed:true}});if(result){const link=new URL('caregiver.html',location.href);link.hash='invite='+result.invite_token;dialog.close();root.querySelector('[data-fcx-result]').innerHTML='<div class="fcx-invite-result"><div><strong>Invitation ready</strong><p>Send this private link only to '+E(form.elements.email.value)+'.</p></div><button type="button" class="btn btn--primary" data-fcx-copy data-link="'+E(link.href)+'">Copy invitation link</button></div>';await load();}else status.textContent='The invitation could not be created. Review the choices and try again.';}finally{submit.disabled=false;}}
  );

  const observer=new MutationObserver(collectAdvanced);observer.observe(panel,{childList:true,subtree:false});
  collectAdvanced();
  const heading=panel.querySelector('.page-section-heading');heading.querySelector('h1').textContent='Family Circle';heading.querySelector('p').textContent='Invite trusted people without giving away your full record.';
  window.addEventListener('dai:patient-panel',event=>{if(event.detail?.panel==='family'){collectAdvanced();load();}});
  window.addEventListener('dai:patient-ready',()=>{collectAdvanced();if(location.hash==='#family')load();});
  if(location.hash==='#family')requestAnimationFrame(load);
})();
