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
  let grants=[],children=[],recent=[],selectedId=null,step=1,preset='essential';

  const root=document.createElement('section');
  root.id='familyCircleExperience';
  root.className='fcx';
  root.innerHTML=`
    <header class="fcx-head">
      <div><span class="fcx-kicker">YOUR PEOPLE. YOUR PERMISSION.</span><h2>Your Family Circle</h2><p>See who can help, what they can view and when their access ends.</p></div>
      <button type="button" class="btn btn--primary" data-fcx-invite>Invite someone</button>
    </header>
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
  const initials=email=>String(email||'?').split('@')[0].split(/[._-]/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
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

  function renderMap(){
    const current=grants.filter(g=>['active','pending','expiring'].includes(statusOf(g))),map=root.querySelector('[data-fcx-map]');
    if(selectedId&&!grants.some(g=>g.id===selectedId))selectedId=null;
    const name=($('userName')?.textContent||'You').replace(/^SYNTHETIC\s+/i,'').split(' ')[0];
    map.innerHTML='<div class="fcx-map-ring" aria-hidden="true"></div><div class="fcx-centre"><svg aria-hidden="true"><use href="#i-shield"/></svg><strong>'+E(name)+'</strong><small>You decide</small></div>'+(current.length?current.map((g,i)=>{const angle=-90+(360/current.length)*i,x=50+32*Math.cos(angle*Math.PI/180),y=50+32*Math.sin(angle*Math.PI/180),selected=g.id===selectedId,dimmed=selectedId&&!selected,label=relationNames[g.relationship]||'Trusted person';return '<button type="button" class="fcx-person is-'+statusOf(g)+(selected?' is-selected':'')+(dimmed?' is-dimmed':'')+'" style="--x:'+x+'%;--y:'+y+'%" data-fcx-person="'+E(g.id)+'" aria-label="View access for '+E(label)+'"><span>'+E(initials(g.recipient_email))+'</span><strong>'+E(label)+'</strong><small>'+E(statusLabel[statusOf(g)])+'</small><em>View access <b aria-hidden="true">→</b></em></button>';}).join(''):'<button type="button" class="fcx-person fcx-person-empty" style="--x:50%;--y:16%" data-fcx-invite><span>+</span><strong>Invite your first person</strong><small>No one has access</small></button>');
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
    host.innerHTML='<header><span class="fcx-avatar">'+E(initials(grant.recipient_email))+'</span><div><span class="fcx-status is-'+status+'">'+E(statusLabel[status])+'</span><h3>'+E(relationNames[grant.relationship]||'Trusted person')+'</h3><p>'+E(grant.recipient_email)+'</p></div></header><div class="fcx-access-summary"><strong>Can view</strong><div>'+grant.scopes.map(s=>'<span>'+E(scopeNames[s]||s)+'</span>').join('')+'</div></div>'+(childNames.length?'<p class="fcx-detail-line"><b>Children:</b> '+E(childNames.join(', '))+'</p>':'')+'<p class="fcx-detail-line"><b>Access ends:</b> '+E(new Date(grant.expires_at).toLocaleString())+(status==='active'||status==='expiring'?' · '+daysLeft(grant)+' day'+(daysLeft(grant)===1?'':'s')+' left':'')+'</p><p class="fcx-detail-line"><b>Last opened:</b> '+E(grant.last_viewed_at?new Date(grant.last_viewed_at).toLocaleString():'Not opened yet')+'</p>'+(!['revoked','expired'].includes(status)?'<div class="fcx-detail-actions"><button type="button" class="btn btn--ghost" data-fcx-renew="'+E(grant.id)+'">Renew 7 days</button><button type="button" class="btn btn--ghost fcx-danger" data-fcx-revoke="'+E(grant.id)+'">Revoke access</button></div>':'<p class="fcx-ended">This person no longer has access.</p>');
  }

  function renderActivity(){
    const host=root.querySelector('[data-fcx-activity]'),labels={invite_created:'Invitation created',accepted:'Invitation accepted',read:'Shared view opened',revoked:'Access revoked',renewed:'Access renewed'};
    host.innerHTML=recent.length?recent.slice(0,5).map(item=>'<div class="fcx-activity-row"><span class="fcx-activity-icon">'+(item.action==='read'?'◉':'✓')+'</span><div><strong>'+E(labels[item.action]||'Access updated')+'</strong><small>'+E(item.recipient_email||'Family access')+' · '+E(new Date(item.created_at).toLocaleString())+'</small></div></div>').join(''):'<div class="fcx-empty"><strong>No family access activity yet</strong><p>Invitations and visits will appear here in simple language.</p></div>';
  }

  function render(){renderMap();renderActivity();const active=grants.filter(g=>['active','pending','expiring'].includes(statusOf(g))).length;root.querySelector('.fcx-head p').textContent=active?active+' person'+(active===1?' has':'s have')+' current or pending access. Select anyone to review it.':'No one currently has access. You are in control.';}

  async function load(){
    const [grantData,childData]=await Promise.all([api('/patient/family-grants'),api('/children')]);
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
