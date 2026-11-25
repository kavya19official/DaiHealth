(function () {
  'use strict';

  const home = document.querySelector('#panel-dashboard');
  const apiBase = window.DaiAPI?.API_BASE;
  if (!home || !apiBase) return;
  const doctor = document.body.classList.contains('doctor-workspace');
  const guest = localStorage.getItem('dai_guest') === '1';
  const categories = {
    pregnancy: 'Pregnancy-related concern', medication: 'Medication question',
    report: 'Understanding a report', general: 'General health concern', other: 'Other / medical guidance'
  };
  const statuses = {
    searching: 'Finding an available doctor', offered: 'Request sent to a doctor',
    accepted: 'Doctor has accepted. Ready to join the call.', in_progress: 'Consultation started',
    completed: 'Consultation completed', cancelled: 'Request cancelled',
    unavailable: 'No doctor was able to accept. Try again or open Nearby Care.',
    expired: 'This consultation has closed. Contact the clinic for follow-up.'
  };
  const outcomes = {
    follow_up: 'Observation and follow-up', in_person: 'In-person consultation recommended',
    hospital: 'Hospital visit recommended', emergency: 'Immediate emergency medical attention recommended',
    unable_to_connect: 'Unable to connect'
  };
  const root = document.createElement('section');
  const panel = document.createElement('dialog');
  const shortcut = document.createElement('div');
  let lastStatus = null;
  let inbox = {};
  let refreshTask = null;
  let enabled = false;
  let history = [];
  let pending = null;
  let lastPresence = 0;
  let onlineDoctors = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]
  ));
  const dateTime = value => value ? new Intl.DateTimeFormat(document.documentElement.lang || 'en', {
    dateStyle:'medium', timeStyle:'short'
  }).format(new Date(value)) : '—';
  const button = (label, action, id = '', primary = false) => (
    `<button type="button" class="btn ${primary ? 'btn--primary' : 'btn--ghost'}" data-connect-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`
  );
  const warning = `<p class="connect-warning" data-connect-warning hidden>If you believe you are experiencing a medical emergency, do not wait for an online consultation. Visit the nearest emergency department or <a href="tel:112">call 112 in India</a>.</p>`;
  const physician = visit => esc([visit.doctor_name, visit.specialization, visit.qualification || visit.clinician_role, visit.facility_name].filter(Boolean).join(' · '));
  const openStatus = visit => ['searching','offered','accepted','in_progress'].includes(visit.status);
  const canCall = visit => ['accepted','in_progress'].includes(visit.status);

  async function request(path, method = 'GET', body) {
    const options = { credentials:'include', cache:'no-store', method, signal:AbortSignal.timeout(12000) };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
      options.headers = { 'Content-Type':'application/json' };
    }
    const response = await fetch(apiBase + '/instant-consultations' + path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Doctor Connect is temporarily unavailable.'), {status:response.status});
    return data;
  }

  root.className = 'connect-card';
  root.innerHTML = doctor ? `
    <div class="connect-heading"><div><small>Doctor Connect</small><h2>Incoming Patient Requests</h2></div>
    ${button('Open consultation inbox','open','',true)}</div>
    <p data-connect-announcement role="status">Checking availability…</p>
  ` : `
    <div class="connect-heading"><div><small>Doctor Connect</small><h2>Connect to a Doctor</h2></div>
    ${button('Talk to a Doctor Now','open','',true)}</div>
    <p>Have a concern? Connect with an available healthcare professional for expert guidance.</p>
    <div class="connect-actions">
      ${button('I have a health concern','open','pregnancy')}
      ${button('I need medical guidance','open','other')}
      ${button('Nearby Care','nearby')}
    </div>
    ${warning}
    <p data-connect-announcement role="status"></p>
  `;
  const announcement = root.querySelector('[data-connect-announcement]');
  panel.className = 'connected-care-dialog connect-dialog';
  panel.setAttribute('aria-labelledby','doctor-connect-title');
  panel.innerHTML = `
    <header><h2 id="doctor-connect-title">${doctor ? 'Incoming Patient Requests' : 'Connect to a Doctor'}</h2>
    ${button('Close','close')}</header>
    <p data-connect-error role="alert" hidden></p>
    ${doctor ? `<label>Availability for new requests
      <select data-connect-availability><option value="offline">Offline</option><option value="available">Available</option><option value="busy">Busy</option></select>
    </label>` : `
      ${warning}
      <div class="connect-actions">${button('Nearby Care','nearby')}</div>
      <form data-connect-create>
        <label>What would you like help with?<textarea name="concern" maxlength="1000" rows="3" required placeholder="Briefly describe what you want to discuss"></textarea></label>
        <div class="connect-fields">
          <label>Concern category<select name="category">${Object.entries(categories).map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
          <label>Preferred language<select name="language"><option value="en">English</option><option value="hi">हिन्दी</option></select></label>
        </div>
        <label class="connect-check"><input type="checkbox" name="emergency_warning"> I think this may be an emergency, or I’m unsure whether I can wait.</label>
        <label class="connect-check"><input type="checkbox" name="consent" required> Share my concern and identity with the clinician who accepts this audio consultation.</label>
        <button class="btn btn--primary" type="submit">Send request</button>
      </form>`}
    <div data-connect-current></div>
    <div data-connect-clinical></div>
    <div data-connect-history></div>`;
  home.prepend(root);
  shortcut.className = 'connect-shortcut';
  if (doctor) {
    shortcut.innerHTML = button('Requests','open');
    document.querySelector('.topbar__right')?.append(shortcut);
  } else {
    shortcut.innerHTML = button('Doctor Connect history','history');
    document.querySelector('#panel-records')?.prepend(shortcut);
  }
  document.body.append(panel);
  const error = panel.querySelector('[data-connect-error]');
  const form = panel.querySelector('[data-connect-create]');
  const availability = panel.querySelector('[data-connect-availability]');
  const currentContainer = panel.querySelector('[data-connect-current]');
  const clinical = panel.querySelector('[data-connect-clinical]');
  const historyContainer = panel.querySelector('[data-connect-history]');
  const createButton = form?.querySelector('button[type=submit]');
  const displayed = new Map();

  function showError(message = '') {
    error.textContent = message;
    error.hidden = !message;
  }

  function setAnnouncement(message) {
    if (announcement.textContent !== message) announcement.textContent = message;
  }

  function showWarning() {
    if (doctor) return;
    const show = form.elements.emergency_warning.checked || pending?.emergency_warning === true;
    for (const container of [root,panel]) container.querySelector('[data-connect-warning]').hidden = !show;
  }

  function renderSection(container, html) {
    if (displayed.get(container) === html) return;
    displayed.set(container, html);
    container.innerHTML = html;
  }

  function visitHistory(visit) {
    return `<details class="connect-history-row">
      <summary>${dateTime(visit.created_at)} · ${esc(categories[visit.category])} · ${esc(statuses[visit.status])}</summary>
      <p>${physician(visit)}</p>
      <p><strong>Concern</strong><br>${esc(visit.concern)}</p>
      ${visit.guidance ? `<p><strong>${esc(outcomes[visit.outcome])}</strong></p>
        <p><strong>Consultation reason</strong><br>${esc(visit.reason)}</p>
        ${visit.observations ? `<p><strong>Clinical observations</strong><br>${esc(visit.observations)}</p>` : ''}
        <p><strong>Clinician guidance</strong><br>${esc(visit.guidance)}</p>
        ${visit.follow_up_on ? `<p>Follow-up date ${esc(visit.follow_up_on)}</p>` : ''}
        ${visit.recommended_facility ? `<p><strong>Recommended facility</strong><br>${esc(visit.recommended_facility)}<br>${esc(visit.recommended_address)}<br>${esc(visit.recommended_phone)}</p>` : ''}
        <p>Documented ${dateTime(visit.ended_at)}</p>` : ''}
      </details>`;
  }

  function searchNote(visit) {
    const minutes = Math.max(1, Math.ceil((new Date(visit.search_until) - Date.now()) / 60000));
    const left = `We’ll keep trying for about ${minutes} more minute${minutes === 1 ? '' : 's'}.`;
    if (onlineDoctors === 0) return `No doctor is online right now. ${left} You can cancel and open Nearby Care at any time.`;
    if (onlineDoctors > 0) return `${onlineDoctors} doctor${onlineDoctors === 1 ? ' is' : 's are'} online now. ${left}`;
    return left;
  }

  function renderPatient() {
    pending = history.find(openStatus) || null;
    const latest = history[0];
    const status = pending || latest;
    const announcementText = status ? statuses[status.status] : '';
    if (status?.status !== lastStatus) {
      lastStatus = status?.status;
      setAnnouncement(announcementText);
    }
    form.hidden = !!pending || guest;
    showWarning();
    renderSection(currentContainer, pending ? `<article class="connect-item">
      <h3>${['searching','offered'].includes(pending.status) ? '<span class="connect-pulse" aria-hidden="true"></span>' : ''}${esc(statuses[pending.status])}</h3><p>${esc(pending.concern)}</p>
      ${['searching','offered'].includes(pending.status) ? `<p class="connect-search">${esc(searchNote(pending))}</p>` : ''}
      ${pending.doctor_name ? `<p>${physician(pending)}</p>` : ''}
      <div class="connect-actions">
        ${canCall(pending) ? button('Join audio call','call',pending.id,true) : ''}
        ${button('Cancel consultation','cancel',pending.id)}
      </div></article>` : latest && latest.status === 'unavailable'
      ? `<article class="connect-item"><h3>${esc(statuses.unavailable)}</h3><p>You can send a new request below, or find care close to you.</p><div class="connect-actions">${button('Open Nearby Care','nearby')}</div></article>` : '');
    renderSection(historyContainer, `<h3>Consultation history</h3>${history.filter(v => !openStatus(v)).map(visitHistory).join('') || '<p>Your completed consultations will appear here.</p>'}`);
  }

  function renderDoctor() {
    availability.value = inbox.status || 'offline';
    const count = inbox.offers?.length || 0;
    const visits = inbox.visits || [];
    const effective = inbox.effective_status || 'offline';
    const shortcutButton = shortcut.querySelector('button');
    const shortcutLabel = count ? `Requests (${count})` : 'Requests';
    if (shortcutButton.textContent !== shortcutLabel) shortcutButton.textContent = shortcutLabel;
    setAnnouncement(effective === 'offline' ? 'You are Offline. Patients cannot reach you. Open the inbox and set Available.'
      : `${effective[0].toUpperCase()+effective.slice(1)} · ${count ? `${count} new request${count === 1 ? '' : 's'}` : 'No new requests'}`);
    renderSection(currentContainer, `<p>Current status <strong>${esc(effective)}</strong> · Capacity ${esc(inbox.capacity)}</p>
      <div class="connect-list">${(inbox.offers || []).map(offer => `<article class="connect-item">
      <h3>${esc(categories[offer.category])}</h3>
      <p>${offer.language === 'hi' ? 'Hindi' : 'English'} · ${esc(offer.facility_name)}</p>
      <p>Requested ${dateTime(offer.created_at)} · Respond by ${dateTime(offer.expires_at)}</p>
      <p>Patient identity and concern become visible after acceptance.</p>
      <div class="connect-actions">${button('Accept request','accept',offer.id,true)}${button('Decline request','decline',offer.id)}</div>
      </article>`).join('') || '<p>No incoming requests yet.</p>'}</div>
      <h3>Active consultations</h3><div class="connect-list">${visits.filter(canCall).map(visit => `<article class="connect-item">
        <h4>${esc(categories[visit.category])}</h4><p>${esc(visit.concern)}</p><p>${esc(visit.facility_name)} · ${esc(statuses[visit.status])}</p>
        <div class="connect-actions">${button('Open consultation','clinical',visit.id,true)}${button('Join audio call','call',visit.id)}</div>
      </article>`).join('') || '<p>No active consultations.</p>'}</div>`);
    renderSection(historyContainer, `<h3>Consultation history</h3>${visits.filter(v => v.status === 'completed').map(visitHistory).join('') || '<p>No completed consultations yet.</p>'}`);
    if (clinical.dataset.visit && !visits.some(visit => visit.id === clinical.dataset.visit && canCall(visit))) {
      clinical.replaceChildren();
      delete clinical.dataset.visit;
    }
  }

  async function loadStatus() {
    try {
      if (doctor) {
        inbox = await request('/inbox');
        if (inbox.status !== 'offline' && Date.now() - lastPresence > 20000) {
          await request('/presence','POST');
          lastPresence = Date.now();
        }
        renderDoctor();
      } else {
        const mine = await request('/mine');
        history = mine.items;
        onlineDoctors = Number.isInteger(mine.online_doctors) ? mine.online_doctors : null;
        renderPatient();
      }
    } catch (err) {
      setAnnouncement(err.status === 403 ? 'Doctor Connect requires an eligible clinician account.'
        : 'Could not refresh Doctor Connect. Check your connection or try again.');
      if ([401,403].includes(err.status)) enabled = false;
      if (panel.open) showError(err.message);
    }
  }

  async function refresh(force = false) {
    if (guest || !enabled) return;
    if (refreshTask) {
      await refreshTask;
      if (!force || !enabled) return;
    }
    if (!refreshTask) refreshTask = loadStatus().finally(() => { refreshTask = null; });
    return refreshTask;
  }

  async function openClinical(visitId) {
    const visit = inbox.visits?.find(item => item.id === visitId);
    if (!visit || !canCall(visit)) return;
    const [context, locations] = await Promise.all([request('/'+visitId+'/context'), request('/'+visitId+'/facilities')]);
    clinical.dataset.visit = visitId;
    clinical.innerHTML = `<article class="connect-item">
      <h3>${esc(context.patient_name)} · Patient ${esc(context.patient_id)}</h3>
      <p>${esc(categories[visit.category])} · ${visit.language === 'hi' ? 'Hindi' : 'English'} · ${dateTime(visit.created_at)}</p>
      <p><strong>Patient’s concern</strong><br>${esc(visit.concern)}</p>
      ${context.pregnancy_status ? `<p>Pregnancy status ${esc(context.pregnancy_status)}${context.gestational_week != null ? ` · recorded pregnancy week ${esc(context.gestational_week)}` : ''}</p>` : ''}
      <p>${context.existing_record_access ? 'Recorded patient context is available through your existing access.' : 'Access for this request covers the stated concern. Ask the patient for any additional context.'}</p>
      <div class="connect-actions">
        ${button('Join audio call','call',visitId,true)}
        ${context.existing_record_access ? button('Open patient record','record',context.patient_id) : ''}
      </div>
      <form data-connect-complete>
        <h4>Document and complete</h4>
        <p>This note is shared with the patient.</p>
        <label>Reason for consultation<textarea name="reason" maxlength="1000" rows="2" required>${esc(visit.concern)}</textarea></label>
        <label>Clinical observations<textarea name="observations" maxlength="4000" rows="3"></textarea></label>
        <label>Guidance provided<textarea name="guidance" maxlength="4000" rows="3" required></textarea></label>
        <label>Outcome<select name="outcome" required><option value="">Choose an outcome</option>
          ${Object.entries(outcomes).map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
        <div class="connect-fields">
          <label>Follow-up date<input type="date" name="follow_up_on"></label>
          <label>Recommend a Nearby Care facility<select name="facility_id"><option value="">None selected</option>${locations.facilities.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select></label>
        </div>
        <button class="btn btn--primary" type="submit">Release guidance and complete</button>
      </form>
    </article>`;
    clinical.scrollIntoView({block:'nearest'});
  }

  async function perform(control, operation) {
    showError();
    control.disabled = true;
    try {
      await operation();
    } catch (err) {
      showError(err.name === 'TimeoutError' ? 'The request took too long. Try again.' : err.message);
    } finally {
      control.disabled = false;
    }
  }

  async function action(event) {
    const control = event.target.closest('[data-connect-action]');
    if (!control) return;
    const act = control.dataset.connectAction;
    const id = control.dataset.id;
    if (act === 'open' || act === 'history') {
      if (!panel.open) panel.showModal();
      showError(guest ? 'Sign in as a patient to request a consultation.' : '');
      if (form && !pending && id) form.elements.category.value = id;
      if (!guest) enabled = true;
      await refresh();
      if (act === 'history') historyContainer.scrollIntoView({block:'start'});
    } else if (act === 'close') {
      panel.close();
    } else if (act === 'nearby') {
      if (panel.open) panel.close();
      document.querySelector('.nav-item[data-panel="facilities"]')?.click();
    } else if (act === 'record') {
      panel.close();
      window.DoctorNavigation?.openPatient(Number(id));
    } else if (act === 'cancel') {
      await perform(control, async () => {
        if (!confirm('Cancel this consultation request?')) return;
        await request('/'+id+'/cancel','POST');
        await refresh(true);
      });
    } else if (act === 'accept' || act === 'decline') {
      await perform(control, async () => {
        await request('/'+id+'/respond','POST',{action:act});
        await refresh(true);
        if (act === 'accept') await openClinical(id);
      });
    } else if (act === 'clinical') {
      await perform(control, () => openClinical(id));
    } else if (act === 'call') {
      const visit = doctor ? inbox.visits?.find(item => item.id === id) : pending;
      if (visit && canCall(visit) && window.DaiRemoteCalls) window.DaiRemoteCalls.openInstant(visit);
      else showError('Audio calling is unavailable. Try reopening the consultation.');
    }
  }

  root.addEventListener('click', action);
  shortcut.addEventListener('click', action);
  panel.addEventListener('click', action);
  availability?.addEventListener('change', () => perform(availability, async () => {
    await request('/availability','PUT',{status:availability.value});
    await refresh(true);
  }));
  form?.elements.emergency_warning.addEventListener('change', showWarning);
  form?.addEventListener('submit', event => {
    event.preventDefault();
    void perform(createButton, async () => {
      await request('','POST',{
        concern:form.elements.concern.value, category:form.elements.category.value,
        language:form.elements.language.value, consent:form.elements.consent.checked,
        emergency_warning:form.elements.emergency_warning.checked
      });
      const selfReportedEmergency = form.elements.emergency_warning.checked;
      form.reset();
      form.elements.emergency_warning.checked = selfReportedEmergency;
      showWarning();
      await refresh(true);
    });
  });
  panel.addEventListener('submit', event => {
    const complete = event.target.closest('[data-connect-complete]');
    if (!complete) return;
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(complete));
    payload.facility_id = payload.facility_id ? Number(payload.facility_id) : null;
    void perform(complete.querySelector('button[type=submit]'), async () => {
      await request('/'+clinical.dataset.visit+'/complete','POST',payload);
      await refresh(true);
    });
  });

  if (!guest) {
    enabled = true;
    void refresh();
    window.setInterval(refresh, 2500);
    window.addEventListener('online', refresh);
  } else {
    renderPatient();
  }
})();
