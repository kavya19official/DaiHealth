(function () {
  'use strict';
  const api = window.DaiAPI;
  if(document.getElementById('patientSukoon'))return;
  const el = document.createElement('section');
  el.className = 'daily-card wellbeing-screen';
  el.innerHTML = `<h2>A little space for your wellbeing</h2>
    <p>A private, two-question PHQ-2 check. Think about the past two weeks. Screening only; a clinician makes any diagnosis.</p>
    <p data-wellbeing-status role="status"></p>
    <form data-wellbeing-form>
      <fieldset><legend>Little interest or pleasure in doing things</legend>${choices('interest')}</fieldset>
      <fieldset><legend>Feeling down, depressed, or hopeless</legend>${choices('mood')}</fieldset>
      <button class="btn btn--primary">Save privately</button>
    </form>
    <div data-screen-result></div>
    <p><a href="https://www.hiv.uw.edu/page/mental-health-screening/phq-2" target="_blank" rel="noopener">About the PHQ-2 screening tool ↗</a></p>`;
  const postpartum = document.getElementById('panel-postpartum');
  if (!postpartum) return;
  postpartum.append(el);
  let screen = null, pending = false, screenLoading = 0;
  function choices(name) {
    return ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'].map((label, value) => `<label><input type="radio" name="${name}" value="${value}" required> ${label}</label>`).join('');
  }
  function E(value) {
    const span = document.createElement('span');
    span.textContent = String(value ?? '');
    return span.innerHTML;
  }
  const status = message => { el.querySelector('[data-wellbeing-status]').textContent = message; };
  function renderScreen() {
    const result = el.querySelector('[data-screen-result]');
    if (!screen) { result.replaceChildren(); return; }
    result.innerHTML = `<article class="wellbeing-result"><strong>PHQ-2 · ${E(screen.score)} / 6</strong><small>${E(new Date(screen.created_at).toLocaleString())}</small>
      <p>${screen.score >= 3 ? 'Your answers suggest a follow-up conversation with a clinician. You can ask for support now.' : 'Thank you for checking in. You can request support at any score.'}</p>
      ${screen.score >= 3 ? '<p><strong>National mental-health support</strong><br><a href="tel:+9114416?oai_link_source=model_response_hotline">Tele-MANAS · 14416</a> · Free, 24/7<br><a href="https://telemanas.mohfw.gov.in/home?oai_link_source=model_response_hotline" target="_blank" rel="noopener">Official Tele-MANAS site ↗</a></p>' : ''}
      ${screen.review_id ? '<p>Clinician review requested. For urgent support, contact your care team directly.</p>' : '<label><input type="checkbox" data-screen-consent> Share this score and date with my authorised clinician for review.</label><button type="button" class="btn btn--primary" data-screen-review>Request clinician review</button>'}
      <p>If you feel you may hurt yourself or your baby, seek urgent in-person help and ask someone you trust to stay with you. Use SOS.</p></article>`;
  }
  async function loadScreen() {
    const version = ++screenLoading;
    const result = await api.apiRequest('/patient/wellbeing');
    if (version !== screenLoading) return;
    if (!result) { status('Could not load your check-in. Reopen this page to retry.'); return; }
    el.hidden = !result.eligible;
    screen = result.screens[0] || null;
    renderScreen();
  }
  el.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    const form = event.target;
    if (!form.reportValidity()) return;
    pending = true;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const result = await api.apiRequest('/patient/wellbeing', {method:'POST', body:{answers:[Number(form.elements.interest.value), Number(form.elements.mood.value)]}});
      if (!result) { status('Not saved. Your answers are still here. Please try again.'); return; }
      screen = result.screen;
      form.reset();
      renderScreen();
      status('Saved privately. Nothing has been shared from this screen.');
    } finally { pending = false; button.disabled = false; }
  });
  el.addEventListener('click', async event => {
    const button = event.target.closest('[data-screen-review]');
    if (!button || !screen || pending) return;
    if (!el.querySelector('[data-screen-consent]').checked) { status('Please confirm sharing before requesting a review.'); return; }
    pending = true;
    button.disabled = true;
    try {
      const result = await api.apiRequest('/patient/wellbeing/' + screen.id + '/review', {method:'POST',body:{consent:true}});
      if (!result) { status('Request not sent. Contact your care team directly for urgent support.'); return; }
      screen.review_id = result.review_id;
      renderScreen();
      status('Review request saved. Your authorised clinician can see the summary.');
    } finally { pending = false; button.disabled = false; }
  });

  const babyRoot = document.createElement('section');
  babyRoot.className = 'daily-card infant-tracking';
  babyRoot.innerHTML = `<h2>Feeds, sleep & little routines</h2><p>Each child has a separate log. Charts show what you recorded.</p>
    <label>Child<select data-infant-child></select></label><p data-infant-status role="status"></p>
    <div data-infant-content hidden>
    <form data-infant-form><label>Entry type<select name="event_type"><option value="feed">Feed</option><option value="sleep">Sleep</option><option value="wet">Wet diaper</option><option value="dirty">Dirty diaper</option><option value="mixed">Wet & dirty diaper</option></select></label>
    <label data-feed-label>Feeding method<select name="feeding_type"><option value="breast">Breastfeeding</option><option value="expressed">Expressed milk</option><option value="formula">Formula</option><option value="other">Other</option></select></label>
    <label>Started at<input type="datetime-local" name="started_at" required></label><label data-duration-label>Duration in minutes (optional)<input type="number" name="duration_min" min="0.1" max="1440" step="0.1"></label><button class="btn btn--primary">Save entry</button></form>
    <div data-infant-charts class="infant-charts"></div>
    <details><summary>Log a weight check</summary><form data-weight-form><label>Date measured<input type="date" name="measured_on" required></label><label>Weight (kg)<input type="number" min="0.4" max="150" step="0.01" name="weight_kg" required></label><button class="btn btn--primary">Save weight</button></form><p>Measurements are self-reported. Your paediatrician interprets growth.</p></details>
    <div data-weight-chart></div><details><summary>Entries from the last seven days</summary><ul data-infant-entries class="daily-history"></ul></details>
    <aside class="infant-warning"><h3>When to get help</h3><p>Seek urgent medical help if your baby has difficulty breathing, is difficult to wake, stops feeding or has fewer wet diapers than usual. Use SOS for immediate help.</p><a href="https://www.nhs.uk/baby/health/when-to-get-urgent-medical-help-for-babies-and-children-under-5/" target="_blank" rel="noopener">Warning signs · NHS ↗</a></aside></div>`;
  document.getElementById('panel-children')?.append(babyRoot);
  const find = selector => babyRoot.querySelector(selector);
  const childSelect = find('[data-infant-child]');
  let child = null, infantLoading = 0, saving = false, childrenLoaded = false;
  const say = message => { find('[data-infant-status]').textContent = message; };
  function localInput(date = new Date()) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  }
  function fieldTypes() {
    const type = find('[data-infant-form]').elements.event_type.value;
    find('[data-feed-label]').hidden = type !== 'feed';
    find('[data-duration-label]').hidden = !['feed','sleep'].includes(type);
  }
  function trend(values, title, unit, emptyMessage = 'No entries recorded.') {
    if (!values.length) return `<article><h3>${E(title)}</h3><p>${E(emptyMessage)}</p></article>`;
    const max = Math.max(...values.map(row => row.value), 1);
    return `<article><h3>${E(title)}</h3><div class="infant-bars">${values.map(row => `<div><span style="height:${Math.max(3,row.value/max*90)}px"></span><strong>${E(Math.round(row.value*10)/10)}</strong><small>${E(row.label)}</small></div>`).join('')}</div><small>${E(unit)} · recorded days only</small></article>`;
  }
  async function loadBaby() {
    const version = ++infantLoading;
    find('[data-infant-content]').hidden = true;
    child = null;
    const id = Number(childSelect.value);
    if (!id) { say('Add a child profile to start logging.'); return; }
    say('Loading this child’s entries…');
    const result = await api.apiRequest('/patient/infant-logs?child_id=' + id);
    if (version !== infantLoading) return;
    if (!result) { say('Could not load logs. Select the child again to retry.'); return; }
    child = result.child;
    find('[data-infant-content]').hidden = false;
    const totals = new Map();
    for (const log of result.logs) {
      const date = api.localDateStr(new Date(log.started_at));
      if (!totals.has(date)) totals.set(date, {feed:null,sleep:null,diapers:null});
      const day = totals.get(date);
      if (log.event_type === 'feed') day.feed=(day.feed??0)+1;
      if (log.event_type === 'sleep' && log.duration_min != null) day.sleep=(day.sleep??0)+Number(log.duration_min);
      if (['wet','dirty','mixed'].includes(log.event_type)) day.diapers=(day.diapers??0)+1;
    }
    const dates = [...totals.keys()].sort();
    const values = key => dates.map(date => ({label:date.slice(5), value:totals.get(date)[key]})).filter(row=>row.value!==null);
    find('[data-infant-charts]').innerHTML = trend(values('feed'), 'Feed entries', 'Count') + trend(values('sleep'), 'Sleep minutes entered', 'Known durations only; not total daily sleep', 'No sleep durations entered.') + trend(values('diapers'), 'Diaper changes', 'Count');
    const weights = result.growth.slice(-14).map(row => ({label:row.measured_on.slice(5),value:row.weight_kg}));
    find('[data-weight-chart]').innerHTML = trend(weights, 'Recorded weight checks', 'kg');
    find('[data-infant-entries]').innerHTML = result.logs.slice(0,50).map(log => `<li><strong>${E(({feed:'Feed',sleep:'Sleep',wet:'Wet diaper',dirty:'Dirty diaper',mixed:'Wet & dirty diaper'})[log.event_type])}${log.feeding_type ? ' · '+E(log.feeding_type) : ''}</strong><small>${E(new Date(log.started_at).toLocaleString())}${log.duration_min != null ? ' · '+E(log.duration_min)+' min' : ''}</small><button type="button" class="link-btn" data-remove-log="${E(log.id)}">Remove entry</button></li>`).join('') || '<li>No entries recorded.</li>';
    say(result.truncated ? 'Showing the most recent 1,000 entries. Displayed trends cover these entries.' : child.name + ' · last seven days');
    find('[data-infant-form]').elements.started_at.value = localInput();
    find('[data-infant-form]').elements.started_at.max = localInput();
    find('[data-weight-form]').elements.measured_on.value = api.localDateStr();
    find('[data-weight-form]').elements.measured_on.max = api.localDateStr();
    fieldTypes();
  }
  async function loadChildren() {
    const result = await api.apiRequest('/children');
    if (!result) { say('Could not load child profiles. Reopen this page to retry.'); return; }
    const selected = childSelect.value;
    childSelect.innerHTML = (result.children || []).map(c => `<option value="${E(c.id)}">${E(c.name)}</option>`).join('');
    if ([...childSelect.options].some(option => option.value === selected)) childSelect.value = selected;
    childrenLoaded = true;
    await loadBaby();
  }
  childSelect.addEventListener('change', loadBaby);
  find('[data-infant-form]').elements.event_type.addEventListener('change', fieldTypes);
  babyRoot.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !child) return;
    const form = event.target;
    if (!form.reportValidity()) return;
    const id = child.id;
    const isWeight = form.matches('[data-weight-form]');
    const fields = form.elements;
    const type = isWeight ? null : fields.event_type.value;
    const body = isWeight ? {measured_on:fields.measured_on.value,weight_kg:Number(fields.weight_kg.value)} : {child_id:id,event_type:type,started_at:new Date(fields.started_at.value).toISOString(),duration_min:['feed','sleep'].includes(type) && fields.duration_min.value ? Number(fields.duration_min.value) : null};
    if (type === 'feed') body.feeding_type = fields.feeding_type.value;
    saving = true;
    childSelect.disabled = true;
    form.querySelector('button').disabled = true;
    try {
      const result = await api.apiRequest(isWeight ? '/children/'+id+'/growth' : '/patient/infant-logs', {method:'POST',body});
      if (!result) { say('Not saved. Your entry is still here. Please retry.'); return; }
      form.reset();
      await loadBaby();
    } finally { saving = false; childSelect.disabled = false; form.querySelector('button').disabled = false; }
  });
  babyRoot.addEventListener('click', async event => {
    const button = event.target.closest('[data-remove-log]');
    if (!button || saving || !window.confirm('Remove this self-reported entry?')) return;
    saving = true;
    button.disabled = true;
    try {
      const result = await api.apiRequest('/patient/infant-logs/'+button.dataset.removeLog,{method:'DELETE'});
      if (result) await loadBaby(); else say('Entry was not removed. Please retry.');
    } finally { saving = false; button.disabled = false; }
  });
  const link = document.createElement('a');
  link.href = '#children';
  link.className = 'btn btn--ghost';
  link.textContent = 'Open feeding, sleep & diaper logs →';
  postpartum.append(link);
  function open(panel) {
    if (panel === 'postpartum') loadScreen();
    if (panel === 'children') childrenLoaded ? loadBaby() : loadChildren();
  }
  window.addEventListener('dai:patient-panel', event => open(event.detail.panel));
  open(location.hash.slice(1));
})();
