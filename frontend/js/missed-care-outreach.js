/* Missed-care outreach: one script, two views.
   Mother (#missedCareItemsList): her own overdue care, what is in the way, how to rebook.
   Doctor (#outreachQueueList): prioritised patients to contact, attempt log and history. */
(function () {
  'use strict';

  const api = window.DaiAPI;
  const $ = id => document.getElementById(id);
  const E = window.PatientModel ? window.PatientModel.escape : (s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#x27;' }[m])));

  const state = {
    missedCareItems: [], outreachQueue: [], summary: null, barrierOptions: [], outreachAttempts: [],
    currentMissedCareId: null, missedLoading: false, queueLoading: false, missedError: false, queueError: false,
    missedAt: 0, queueAt: 0, openBarriers: null
  };

  const isGuest = () => { try { return !!localStorage.getItem('dai_guest'); } catch (e) { return false; } };
  const fmt = v => v ? new Date(String(v).slice(0, 10) + 'T12:00:00').toLocaleDateString(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not recorded';
  const fmtTime = v => v ? new Date(v).toLocaleString(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

  // Urgency is always written out as well as coloured, so it never relies on colour alone.
  const URGENCY = {
    critical: { label: 'Urgent', hint: 'More than 30 days overdue' },
    high: { label: 'High', hint: '15 to 30 days overdue' },
    medium: { label: 'Medium', hint: '8 to 14 days overdue' },
    low: { label: 'Low', hint: 'Up to a week overdue' }
  };
  const STATUS = { pending: 'Not yet contacted', in_progress: 'In progress', resolved: 'Resolved', deferred: 'Deferred' };
  const BARRIER = {
    transport: 'Transport', cost: 'Cost', time_off_work: 'Time off work', childcare: 'Childcare',
    distance: 'Too far', language: 'Language', family_permission: 'Family permission', other: 'Something else'
  };
  const TYPE = { call: 'Phone call', visit: 'In-person visit', message: 'Message', other: 'Other' };
  const OUTCOME = {
    no_answer: 'No answer', reached: 'Reached', left_message: 'Left message', agreed_followup: 'Agreed to follow up',
    declined: 'Declined', wrong_number: 'Wrong number', rescheduled: 'Rescheduled'
  };
  const days = n => (Number(n) || 0) === 1 ? '1 day overdue' : (Number(n) || 0) + ' days overdue';
  const skeleton = (label, rows) => '<div class="oq-skeleton" role="status" aria-live="polite"><span class="oq-sr">' + label + '</span>' +
    Array.from({ length: rows || 3 }, () => '<div class="oq-skeleton-row"><i></i><i></i></div>').join('') + '</div>';
  const barrierChips = list => (list && list.length) ? '<ul class="oq-chips" aria-label="What is in the way">' + list.map(b => '<li>' + E(BARRIER[b] || b) + '</li>').join('') + '</ul>' : '';

  // ---------- Mother view ----------
  const renderMissedCareItems = () => {
    const box = $('missedCareItemsList');
    if (!box) return;
    if (state.missedLoading) { box.innerHTML = skeleton('Loading missed care items', 3); return; }
    if (isGuest()) { box.innerHTML = '<div class="oq-empty"><strong>Sign in to see your follow-up care</strong><p>Guest mode does not keep health records, so there is nothing to follow up here.</p><a class="oq-btn oq-btn--primary" href="auth.html">Sign in</a></div>'; return; }
    if (state.missedError) { box.innerHTML = '<div class="oq-empty oq-empty--error" role="alert"><strong>We could not load your follow-up items</strong><p>Check your connection and try again. Your records are not affected.</p><button type="button" class="oq-btn oq-btn--primary" data-retry-missed>Try again</button></div>'; return; }
    const summary = $('missedCareSummary');
    if (summary) summary.textContent = state.missedCareItems.length ? (state.missedCareItems.length === 1 ? '1 item needs your attention' : state.missedCareItems.length + ' items need your attention') : '';
    if (!state.missedCareItems.length) { box.innerHTML = '<div class="oq-empty oq-empty--ok"><strong>You are up to date</strong><p>No visits or tests are overdue. We will show anything that slips here, with a simple way to rebook.</p></div>'; return; }
    box.innerHTML = state.missedCareItems.map(renderMissedCareItem).join('');
  };

  const renderMissedCareItem = item => {
    const u = URGENCY[item.urgency_level] || { label: item.urgency_level || 'Open', hint: '' };
    const attempts = Number(item.attempt_count) || 0;
    const open = state.openBarriers === item.id;
    const chosen = item.access_barriers || [];
    return `<article class="oq-card oq-card--${E(item.urgency_level || 'low')}" data-id="${E(item.id)}">
      <header class="oq-card-head">
        <span class="oq-badge oq-badge--${E(item.urgency_level || 'low')}" title="${E(u.hint)}">${E(u.label)}</span>
        <span class="oq-overdue">${E(days(item.overdue_days))}</span>
        <span class="oq-status">${E(STATUS[item.status] || item.status)}</span>
      </header>
      <h3 class="oq-title">${E(item.title)}</h3>
      <p class="oq-meta">Was due ${E(fmt(item.due_date))}</p>
      ${attempts ? `<p class="oq-note">Your care team has tried to reach you${item.last_attempt_at ? ' (last on ' + E(fmtTime(item.last_attempt_at)) + ')' : ''}.</p>` : ''}
      ${barrierChips(chosen)}
      <div class="oq-actions">
        <button type="button" class="oq-btn oq-btn--primary" data-reschedule="${E(item.id)}">Book this visit</button>
        <button type="button" class="oq-btn oq-btn--ghost" data-toggle-barriers="${E(item.id)}" aria-expanded="${open}" aria-controls="barriers-${E(item.id)}">Something is in the way</button>
      </div>
      ${open ? `<form class="oq-barriers" id="barriers-${E(item.id)}" data-barrier-form="${E(item.id)}">
        <fieldset><legend>What is making this hard? Your care team will see this and can help.</legend>
          <div class="oq-checks">${(state.barrierOptions.length ? state.barrierOptions : Object.keys(BARRIER)).map(b => `<label><input type="checkbox" value="${E(b)}" ${chosen.includes(b) ? 'checked' : ''}> ${E(BARRIER[b] || b)}</label>`).join('')}</div>
        </fieldset>
        <div class="oq-actions"><button type="submit" class="oq-btn oq-btn--primary">Share with my care team</button><button type="button" class="oq-btn oq-btn--ghost" data-toggle-barriers="${E(item.id)}">Cancel</button></div>
      </form>` : ''}
    </article>`;
  };

  // ---------- Doctor view ----------
  const renderOutreachQueue = () => {
    const box = $('outreachQueueList');
    if (!box) return;
    if (state.queueLoading) { box.innerHTML = skeleton('Loading outreach queue', 3); return; }
    if (state.queueError) { box.innerHTML = '<div class="oq-empty oq-empty--error" role="alert"><strong>The outreach queue did not load</strong><p>Check your connection and try again. Nothing was changed.</p><button type="button" class="oq-btn oq-btn--primary" data-retry-queue>Try again</button></div>'; return; }
    const counts = state.summary || ['critical', 'high', 'medium', 'low'].reduce((o, k) => (o[k] = state.outreachQueue.filter(i => i.urgency_level === k).length, o), {});
    [['Critical', 'critical'], ['High', 'high'], ['Medium', 'medium'], ['Low', 'low']].forEach(([n, k]) => { const el = $('outreach' + n + 'Count'); if (el) el.textContent = counts[k] || 0; });
    box.innerHTML = state.outreachQueue.length
      ? state.outreachQueue.map(renderQueueItem).join('')
      : '<div class="oq-empty oq-empty--ok"><strong>No patients need follow-up here</strong><p>Try another status or urgency. Only patients who have not turned off your access appear.</p></div>';
  };

  const renderQueueItem = item => {
    const u = URGENCY[item.urgency_level] || { label: item.urgency_level || 'Open' };
    return `<article class="oq-card oq-card--${E(item.urgency_level || 'low')}" data-id="${E(item.id)}">
      <header class="oq-card-head">
        <span class="oq-badge oq-badge--${E(item.urgency_level || 'low')}">${E(u.label)}</span>
        <span class="oq-overdue">${E(days(item.overdue_days))}</span>
        <span class="oq-status">${E(STATUS[item.status] || item.status)}</span>
      </header>
      <h3 class="oq-title">${E(item.full_name)} <span class="oq-sub">· ${E(item.title)}</span></h3>
      <p class="oq-meta">Due ${E(fmt(item.due_date))}${item.phone ? ' · <a href="tel:' + E(String(item.phone).replace(/[^\d+]/g, '')) + '">' + E(item.phone) + '</a>' : ''}${item.address ? ' · ' + E(item.address) : ''}</p>
      ${barrierChips(item.access_barriers)}
      <p class="oq-note">${Number(item.attempt_count) ? E(item.attempt_count + (item.attempt_count === 1 ? ' attempt' : ' attempts')) + (item.last_attempt_at ? ', last ' + E(fmtTime(item.last_attempt_at)) : '') : 'No contact attempts yet'}</p>
      <div class="oq-actions">
        <button type="button" class="oq-btn oq-btn--primary" data-log-attempt="${E(item.id)}">Log attempt</button>
        <button type="button" class="oq-btn oq-btn--ghost" data-view-attempts="${E(item.id)}">View history</button>
        ${item.status !== 'resolved' ? `<button type="button" class="oq-btn oq-btn--ghost" data-mark-resolved="${E(item.id)}">Mark resolved</button>` : ''}
      </div>
    </article>`;
  };

  const renderOutreachAttempts = () => {
    const box = $('outreachAttemptsList');
    if (!box) return;
    if (!state.currentMissedCareId) { box.innerHTML = '<div class="oq-empty"><p>Choose “View history” on a patient to see every contact attempt here.</p></div>'; return; }
    if (!state.outreachAttempts.length) { box.innerHTML = '<div class="oq-empty"><p>No contact attempts have been logged for this item.</p></div>'; return; }
    box.innerHTML = '<ol class="oq-history">' + state.outreachAttempts.map(a => `<li>
      <div class="oq-history-head"><strong>${E(TYPE[a.attempt_type] || a.attempt_type)}</strong><span class="oq-outcome oq-outcome--${['reached', 'agreed_followup', 'rescheduled'].includes(a.outcome) ? 'good' : 'open'}">${E(OUTCOME[a.outcome] || a.outcome)}</span><time>${E(fmtTime(a.attempt_date))}</time></div>
      ${a.attempted_by_name ? `<p class="oq-meta">By ${E(a.attempted_by_name)}</p>` : ''}
      ${a.notes ? `<p>${E(a.notes)}</p>` : ''}
      ${a.next_action ? `<p class="oq-note"><strong>Next:</strong> ${E(a.next_action)}${a.next_action_date ? ' by ' + E(fmt(a.next_action_date)) : ''}</p>` : ''}
    </li>`).join('') + '</ol>';
  };

  // ---------- Loading ----------
  const withTimeout = (path, ms) => {
    const c = typeof AbortController === 'function' ? new AbortController() : null;
    const t = c ? setTimeout(() => c.abort(), ms) : null;
    return api.apiRequest(path, c ? { signal: c.signal } : {}).finally(() => { if (t) clearTimeout(t); });
  };

  const loadMissedCareItems = async () => {
    if (state.missedLoading) return;
    if (isGuest()) { renderMissedCareItems(); return; }
    state.missedLoading = true; state.missedError = false; renderMissedCareItems();
    try {
      const data = await withTimeout('/patient/missed-care', 15000);
      if (data) { state.missedCareItems = data.missed_care_items || []; state.barrierOptions = data.barrier_options || []; state.missedAt = Date.now(); }
      else state.missedError = true;
    } catch (e) { state.missedError = true; console.error('Missed care load failed:', e); }
    state.missedLoading = false; renderMissedCareItems();
  };

  const loadOutreachQueue = async (filters) => {
    if (state.queueLoading) return;
    if (filters) state.lastFilters = filters;
    const f = state.lastFilters || {};
    state.queueLoading = true; state.queueError = false; renderOutreachQueue();
    try {
      const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
      const data = await withTimeout('/outreach/queue' + (q ? '?' + q : ''), 15000);
      if (data) { state.outreachQueue = data.queue || []; state.summary = data.summary || null; state.queueAt = Date.now(); }
      else state.queueError = true;
    } catch (e) { state.queueError = true; console.error('Outreach queue load failed:', e); }
    state.queueLoading = false; renderOutreachQueue();
  };

  const loadOutreachAttempts = async (id) => {
    state.currentMissedCareId = id; state.outreachAttempts = [];
    const box = $('outreachAttemptsList');
    if (box) { box.innerHTML = skeleton('Loading history', 2); try { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* not essential */ } }
    try {
      const data = await api.apiRequest('/outreach/' + encodeURIComponent(id) + '/attempts');
      if (data) state.outreachAttempts = data.attempts || [];
      else if (box) { box.innerHTML = '<div class="oq-empty oq-empty--error" role="alert"><p>The history did not load.</p><button type="button" class="oq-btn oq-btn--primary" data-view-attempts="' + E(id) + '">Try again</button></div>'; return; }
    } catch (e) { console.error('Attempts load failed:', e); }
    renderOutreachAttempts();
  };

  // Refresh when a panel is opened, but not on every re-render.
  const refresh = (maxAgeMs) => {
    const age = maxAgeMs == null ? 20000 : maxAgeMs;
    if ($('missedCareItemsList') && Date.now() - state.missedAt > age) loadMissedCareItems();
    if ($('outreachQueueList') && Date.now() - state.queueAt > age) loadOutreachQueue();
  };

  // ---------- Actions ----------
  const markResolved = async id => {
    const r = await api.apiRequest('/outreach/' + encodeURIComponent(id) + '/status', { method: 'PATCH', body: { status: 'resolved' } });
    if (r) { api.toast('Marked as resolved'); await loadOutreachQueue(); }
  };

  const saveBarriers = async (id, list) => {
    const r = await api.apiRequest('/patient/missed-care/' + encodeURIComponent(id) + '/barriers', { method: 'POST', body: { barriers: list } });
    if (r) { api.toast(list.length ? 'Shared with your care team' : 'Saved'); state.openBarriers = null; await loadMissedCareItems(); }
  };

  const showLogAttemptDialog = (id, opener) => {
    const overlay = document.createElement('div');
    overlay.className = 'oq-overlay';
    const opt = (map) => Object.keys(map).map(k => `<option value="${k}">${E(map[k])}</option>`).join('');
    overlay.innerHTML = `<form class="oq-dialog" role="dialog" aria-modal="true" aria-labelledby="oqDlgTitle">
      <h2 id="oqDlgTitle">Log contact attempt</h2>
      <label>How did you reach out?<select name="attempt_type" required><option value="">Choose…</option>${opt(TYPE)}</select></label>
      <label>What happened?<select name="outcome" required><option value="">Choose…</option>${opt(OUTCOME)}</select></label>
      <label>Notes <small>(optional)</small><textarea name="notes" rows="3" maxlength="2000"></textarea></label>
      <label>Next step <small>(optional)</small><input name="next_action" maxlength="255" placeholder="For example, call again on Monday"></label>
      <label>Next step date <small>(optional)</small><input type="date" name="next_action_date"></label>
      <p class="oq-error" role="alert" hidden></p>
      <div class="oq-actions"><button type="submit" class="oq-btn oq-btn--primary">Save attempt</button><button type="button" class="oq-btn oq-btn--ghost" data-close>Cancel</button></div>
    </form>`;
    document.body.appendChild(overlay);
    const form = overlay.firstElementChild;
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); if (opener && opener.focus) opener.focus(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', e => { if (e.target === overlay || e.target.hasAttribute('data-close')) close(); });
    form.querySelector('select').focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]'), err = form.querySelector('.oq-error');
      btn.disabled = true; btn.textContent = 'Saving…'; err.hidden = true;
      const body = Object.fromEntries(new FormData(form).entries());
      const r = await api.apiRequest('/outreach/' + encodeURIComponent(id) + '/attempts', { method: 'POST', body });
      if (r) { api.toast('Attempt logged'); close(); await loadOutreachQueue(); if (state.currentMissedCareId === id) await loadOutreachAttempts(id); }
      else { btn.disabled = false; btn.textContent = 'Save attempt'; err.textContent = 'This was not saved. Check your connection or access and try again.'; err.hidden = false; }
    });
  };

  const setup = () => {
    document.addEventListener('click', async e => {
      const btn = e.target.closest && e.target.closest('button');
      if (!btn) return;
      const d = btn.dataset;
      try {
        if (d.markResolved) { e.preventDefault(); await markResolved(d.markResolved); }
        else if (d.logAttempt) { e.preventDefault(); showLogAttemptDialog(d.logAttempt, btn); }
        else if (d.viewAttempts) { e.preventDefault(); await loadOutreachAttempts(d.viewAttempts); }
        else if (btn.hasAttribute('data-retry-missed')) await loadMissedCareItems();
        else if (btn.hasAttribute('data-retry-queue')) await loadOutreachQueue();
        else if (d.toggleBarriers) { e.preventDefault(); const id = Number(d.toggleBarriers); state.openBarriers = state.openBarriers === id ? null : id; renderMissedCareItems(); }
        else if (d.reschedule) {
          e.preventDefault();
          const nav = document.querySelector('.nav-item[data-panel="appointments"]');
          if (nav) nav.click(); else window.location.hash = '#appointments';
        } else if (btn.id === 'applyOutreachFilters') {
          e.preventDefault();
          await loadOutreachQueue({ status: $('outreachStatusFilter').value, urgency: $('outreachUrgencyFilter').value, limit: $('outreachLimitFilter').value });
        } else if (btn.id === 'generateMissedCare') {
          e.preventDefault();
          btn.disabled = true;
          const r = await api.apiRequest('/outreach/generate', { method: 'POST' });
          btn.disabled = false;
          if (r) { api.toast(r.milestones_added + r.appointments_added ? 'Added ' + (r.milestones_added + r.appointments_added) + ' new follow-up item(s)' : 'Already up to date'); await loadOutreachQueue(); }
        }
      } catch (err) { console.error('Outreach action failed:', err); api.toast('That did not work. Please try again.'); }
    });
    document.addEventListener('submit', async e => {
      const form = e.target.closest && e.target.closest('[data-barrier-form]');
      if (!form) return;
      e.preventDefault();
      const list = [...form.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
      const b = form.querySelector('[type=submit]'); if (b) { b.disabled = true; b.textContent = 'Sharing…'; }
      try { await saveBarriers(form.dataset.barrierForm, list); } catch (err) { api.toast('That did not save. Please try again.'); }
    });
  };

  window.PatientMissedCareOutreach = {
    loadMissedCare: loadMissedCareItems, loadQueue: loadOutreachQueue, loadAttempts: loadOutreachAttempts,
    refresh, getState: () => state
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
