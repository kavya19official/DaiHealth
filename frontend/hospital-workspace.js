/* Hospital workspace navigation and persisted coordination workflows. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = value => String(value).replaceAll('_', ' ');
  const base = window.DAI_API_BASE || window.DaiAPI?.API_BASE || '/api';
  let state, records = [], resources = [], busy = false;
  const steps = { referral:['requested','accepted','transport_arranged','arrived','completed'], discharge:['preparing','documents_reviewed','followups_booked','handover_confirmed','completed'], handover:['assigned','acknowledged','completed'] };
  const titles = {overview:'Today’s overview',registry:'Patient registry',brief:'Documents & review',clinic:'Appointments & queue',coordination:'Referrals & handovers',facility:'Delivery readiness',discharge:'Discharge coordination',drafts:'Communication drafts',knowledge:'Education & outreach',capacity:'Capacity & resources',analytics:'Service analytics',pathways:'Care pathways',audit:'Audit history'};
  const operations = ['overview','registry','clinic','coordination','facility','discharge','brief','drafts','knowledge'];
  const administration = ['capacity','analytics','pathways','audit'];
  document.body.classList.add('workspace');
  document.querySelector('.topbar h1').textContent = 'Today’s overview';
  document.querySelector('.banner').innerHTML='<b>Hospital demo workspace</b> Staff-confirmed coordination records are saved on this server. Sample patient records are for demonstration only.';
  document.querySelector('.topbar p').textContent = 'Keep every handoff moving. One shared view of patients, people and pending care.';
  document.querySelector('.nav').innerHTML = `<span class="nav-caption">CARE OPERATIONS</span>${operations.map(id=>`<a href="#${id}">${titles[id]}</a>`).join('')}<span class="nav-caption">ADMINISTRATION</span>${administration.map(id=>`<a href="#${id}">${titles[id]}</a>`).join('')}`;
  document.querySelector('.topbar').insertAdjacentHTML('beforebegin', '<div class="workspace-toolbar"><div><span class="eyebrow">दाई / HOSPITAL WORKSPACE</span><div class="workspace-tabs"><button class="btn" data-workspace="operations">Operations</button><button class="btn" data-workspace="administration">Administration</button></div></div><div id="connectionStatus" role="status">Connecting to hospital…</div><button class="btn" id="refreshWorkspace">↻ Refresh</button></div>');
  $('overview').insertAdjacentHTML('beforeend', '<div class="section-head"><div><h2>Action required</h2><p>Open work with a named owner and a clear next step.</p></div><a class="btn btn-primary" href="#coordination">Create workflow</a></div><div class="panel" id="attentionRows"></div>');
  const content = document.querySelector('.content');
  for (const id of ['coordination','discharge','capacity']) content.insertAdjacentHTML('beforeend', `<section class="section" id="${id}"><div class="section-head"><div><span class="eyebrow">${id==='capacity'?'ADMINISTRATION':'CONTINUITY OF CARE'}</span><h2>${titles[id]}</h2><p>${id==='capacity'?'Staff-confirmed capacity. Check freshness before arranging care.':'Every transition requires a staff confirmation and leaves an audit record.'}</p></div></div><div id="${id}Body"></div></section>`);
  function route() {
    const id = location.hash.slice(1) || 'overview';
    const selected = titles[id] ? id : 'overview';
    document.querySelectorAll('.content > .section').forEach(el => el.hidden = el.id !== selected);
    document.querySelectorAll('.nav a').forEach(el => {el.classList.toggle('is-active',el.hash === '#'+selected); if(el.hash === '#'+selected) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');});
    document.querySelector('.topbar h1').textContent = titles[selected];
    document.querySelector('.hospital-actionbar').hidden = selected !== 'overview';
    document.querySelectorAll('[data-workspace]').forEach(el=>el.classList.toggle('btn-primary', (el.dataset.workspace==='administration')===administration.includes(selected)));
  }
  window.addEventListener('hashchange',route);
  document.querySelectorAll('[data-workspace]').forEach(el=>el.addEventListener('click',()=>location.hash=el.dataset.workspace==='administration'?'capacity':'overview'));
  async function request(path, body) {
    const response = await fetch(base+'/hospital'+path, {method:body?'POST':'GET',credentials:'include',headers:{'Content-Type':'application/json','x-hospital-role':$('currentRole').value},...(body?{body:JSON.stringify(body)}:{})});
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || 'Unable to save hospital changes.');
    return data;
  }
  const field = (name,title,type='text')=>`<label class="control">${title}<input name="${name}" type="${type}" required ${type==='number'?'min="0" max="10000" step="1"':''}></label>`;
  function workflowForm(kind) {
    const role=$('currentRole').value;
    if(!['admin','doctor','care_team'].includes(role)) return '<div class="empty">A care coordinator or doctor can create and confirm workflows.</div>';
    return `<form class="panel workspace-form" data-create="${kind}"><h3>New ${label(kind)}</h3><label class="control">Patient<select name="patientId" required>${state.patients.map(p=>`<option value="${escape(p.id)}">${escape(p.name)} · ${escape(p.id)}</option>`).join('')}</select></label>${field('title',kind==='referral'?'Receiving facility / referral purpose':kind==='discharge'?'Mother–baby follow-up plan':'Task to hand over')}${field('owner','Responsible staff member')}${field('dueDate','Due date','date')}<label class="control">Context / separate newborn record references<textarea name="notes" maxlength="2000"></textarea></label><button class="btn btn-primary">Create ${label(kind)}</button><p class="form-message" role="status"></p></form>`;
  }
  function cards(kind) {
    const rows=records.filter(r=>r.kind===kind);
    return rows.length?rows.map(r=>`<article class="panel workflow-card"><div class="status-line"><span class="tag ${r.status==='completed'?'tag-green':'tag-violet'}">${escape(label(r.status))}</span><span class="subtle">Due ${escape(r.dueDate)}</span></div><h3>${escape(r.title)}</h3><p>${escape(state.patients.find(p=>p.id===r.patientId)?.name || r.patientId)} · Owner: ${escape(r.owner)}</p><p>${escape(r.notes)}</p><ol class="progress-steps">${steps[kind].map((s,i)=>`<li class="${i<=steps[kind].indexOf(r.status)?'done':''}">${escape(label(s))}</li>`).join('')}</ol>${r.status!=='completed'&&['admin','doctor','care_team'].includes($('currentRole').value)?`<form data-advance="${escape(r.id)}">${field('evidence','Confirmation notes / evidence reference')}<button class="btn btn-primary">Confirm ${escape(label(steps[kind][steps[kind].indexOf(r.status)+1]))}</button><p class="form-message" role="status"></p></form>`:''}<details><summary>Transition history (${r.history.length})</summary>${r.history.map(h=>`<p>${escape(label(h.to))} · ${escape(h.actor)} · ${escape(new Date(h.at).toLocaleString())}<br>${escape(h.evidence)}</p>`).join('')||'<p>No transitions recorded.</p>'}</details></article>`).join(''):'<div class="panel empty">No workflows yet. Create one to assign responsibility and track completion.</div>';
  }
  function render() {
    $('coordinationBody').innerHTML=`<div class="workflow-layout"><div>${workflowForm('referral')}${workflowForm('handover')}</div><div><h3>Referrals</h3>${cards('referral')}<h3>Shift handovers</h3>${cards('handover')}</div></div>`;
    $('dischargeBody').innerHTML=`<div class="workflow-layout">${workflowForm('discharge')}<div>${cards('discharge')}</div></div>`;
    $('capacityBody').innerHTML=`<div class="workflow-layout">${$('currentRole').value==='admin'?`<form class="panel workspace-form" id="resourceForm"><h3>Confirm availability</h3>${field('name','Resource / service')}${field('available','Available units','number')}${field('owner','Confirmed by')}<button class="btn btn-primary">Save confirmation</button><p class="form-message" role="status"></p></form>`:'<div class="empty">Administrators manage capacity confirmations.</div>'}<div>${resources.map(r=>`<article class="panel workflow-card"><span class="tag tag-violet">${r.available} available</span><h3>${escape(r.name)}</h3><p>Confirmed by ${escape(r.owner)}</p><p class="subtle">${escape(new Date(r.confirmedAt).toLocaleString())}</p></article>`).join('')||'<div class="panel empty">No capacity confirmed yet. Availability must be entered by staff.</div>'}</div></div>`;
    const pending=records.filter(r=>r.status!=='completed');
    const metrics=[['Appointments',state.queue.filter(q=>!['cancelled','completed'].includes(q.status)).length,'Active clinic bookings','#clinic'],['Open care gaps',state.gaps.length,'Follow-up work to review','#registry'],['Pending referrals',records.filter(r=>r.kind==='referral'&&r.status!=='completed').length,'Track each receiving handoff','#coordination'],['Readiness items',state.facilityCases.reduce((n,c)=>n+c.checklist.filter(i=>!i.ready).length,0),'Awaiting staff confirmation','#facility']];
    $('metrics').innerHTML=metrics.map(m=>`<a class="panel metric" href="${m[3]}" style="text-decoration:none;color:inherit"><span>${m[0]}</span><b>${m[1]}</b><em>${m[2]}</em></a>`).join('');
    $('attentionRows').innerHTML=pending.length?pending.map(r=>`<a class="attention-row" href="#${r.kind==='discharge'?'discharge':'coordination'}"><div><strong>${escape(r.title)}</strong><p>${escape(r.owner)} · ${escape(label(r.status))}</p></div><span>${escape(r.dueDate)} →</span></a>`).join(''):'<div class="empty">No coordination tasks pending. Review the patient registry for care gaps.</div>';
  }
  async function refresh() {
    $('connectionStatus').textContent='Refreshing…';
    try {state=await request('/state');const data=await request('/coordination');records=data.records;resources=data.resources;document.querySelector('.content').hidden=false;render();$('connectionStatus').textContent='Connected · server-saved demo workspace';}
    catch(error){document.querySelector('.content').hidden=true;$('connectionStatus').textContent=error.message+' Records unavailable. Use Refresh to retry.'; if(!state) for(const id of ['coordination','discharge','capacity']) $(id+'Body').innerHTML='<div class="panel empty">Cannot load saved hospital records. Refresh to retry.</div>';}
  }
  document.addEventListener('submit',async event=>{
    const form=event.target;
    if(!form.matches('[data-create],[data-advance],#resourceForm'))return;
    event.preventDefault(); if(busy)return; busy=true;
    const message=form.querySelector('.form-message'), button=form.querySelector('button');button.disabled=true;
    try {const values=Object.fromEntries(new FormData(form));
      if(form.dataset.create)await request('/coordination',{...values,kind:form.dataset.create});
      else if(form.dataset.advance){const record=records.find(r=>r.id===form.dataset.advance);await request('/coordination/'+encodeURIComponent(record.id)+'/advance',{evidence:values.evidence,expectedStatus:record.status});}
      else await request('/resources',{...values,available:Number(values.available)});
      await refresh();
    }catch(error){message.textContent=error.message;}finally{busy=false;button.disabled=false;}
  });
  $('refreshWorkspace').addEventListener('click',refresh);
  $('currentRole').addEventListener('change',()=>{if(state)render();});
  route();refresh();
})();
