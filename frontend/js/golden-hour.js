/* Golden Hour — emergency pre-alert, patient and family side (PROTOTYPE, synthetic demo accounts only).
 *
 * One sheet: tick the danger signs, say where she is, tap once. The SERVER re-runs the fixed triage rules,
 * picks the nearest facility that actually has the needed capability, builds an SBAR and sends it to that
 * hospital's portal. This screen then follows the hospital's reply.
 *
 * Never replaces calling for help: the 112 / 108 buttons are always on screen and the text says so.
 * Works on the mother's dashboard and on the family page (caregiver.html), which has no DaiAPI, so this
 * file does its own fetch and keeps the server's error text (which always says to call 112).
 */
(function () {
  'use strict';
  if (window.GoldenHourUI) return;

  var POLL_MS = 3000;
  var OPEN_STATES = ['sent', 'received', 'accepted', 'rerouted'];
  var S = { el: null, cfg: null, alert: null, motherId: null, motherName: '', family: false, codes: [], note: '', loc: null, timer: null, busy: false, opener: null, eventId: null, context: null, sbarOpen: false, whyOpen: false, error: '', notice: '', key: '' };

  function E(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function requestKey() { var a = new Uint8Array(12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); }); return 'gh-' + Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }

  async function api(path, method, body) {
    try {
      var r = await fetch('/api' + path, { method: method || 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      var j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
      return { ok: r.ok, status: r.status, body: j };
    } catch (e) {
      return { ok: false, status: 0, body: { error: 'No connection. If this is an emergency, call 112 (or 108) now.' } };
    }
  }

  /* ---------- availability probe (the entry point in the SOS flow only appears for demo accounts) ---------- */
  var ui = { enabled: false, probed: false };
  async function probe() {
    var r = await api('/golden-hour/config');
    ui.enabled = r.ok && !!r.body.available;
    ui.probed = true;
    document.dispatchEvent(new CustomEvent('goldenhour:availability', { detail: { enabled: ui.enabled } }));
  }

  /* ---------- sheet ---------- */
  function build() {
    var el = document.createElement('div');
    el.className = 'gh-overlay'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Golden Hour emergency pre-alert');
    el.innerHTML = '<div class="gh-sheet"><header class="gh-head"><div><b>Golden Hour</b><small>Emergency pre-alert · prototype</small></div><button type="button" class="gh-x" aria-label="Close (an open alert stays active)">×</button></header><div class="gh-call" role="group" aria-label="Call for help"><b>Call now. Do not wait for the app.</b><span><a class="gh-btn gh-btn--red" data-call="112" href="tel:112">Call 112</a><a class="gh-btn" data-call="108" href="tel:108">Call 108</a><a class="gh-btn" data-call="102" href="tel:102">102 (mother &amp; baby)</a></span></div><div class="gh-body" id="ghBody"></div><p class="gh-proto" id="ghProto"></p></div>';
    el.querySelector('.gh-x').addEventListener('click', close);
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    el.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-call]');
      if (a && S.alert && S.alert.id) api('/golden-hour/alerts/' + S.alert.id + '/actions', 'POST', { action: 'called_ambulance' });
    });
    return el;
  }
  function close() {
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    if (S.el) { S.el.remove(); S.el = null; }
    if (S.opener && S.opener.focus) { try { S.opener.focus(); } catch (e) { /* gone */ } }
  }
  function body() { return S.el && S.el.querySelector('#ghBody'); }

  async function open(opts) {
    opts = opts || {};
    if (S.el) close();
    S = Object.assign(S, { alert: null, cfg: null, motherId: opts.motherId || null, motherName: opts.motherName || '', family: !!opts.family, codes: (opts.codes || []).slice(), note: opts.note || '', loc: null, busy: false, eventId: opts.emergencyEventId || null, context: opts.context || null, error: '', notice: '', key: requestKey(), sbarOpen: false, whyOpen: false });
    S.opener = document.activeElement;
    S.el = build(); document.body.appendChild(S.el);
    body().innerHTML = '<p class="gh-sub">Loading…</p>';
    var q = S.family ? '?mother_id=' + encodeURIComponent(S.motherId) : '';
    var cfg = await api('/golden-hour/config' + q);
    if (!S.el) return;
    if (!cfg.ok) { body().innerHTML = '<div class="gh-banner gh-banner--red"><b>' + E(cfg.body.error || 'Golden Hour is not available.') + '</b><p>If this is an emergency, call 112 (or 108) now.</p></div>'; return; }
    S.cfg = cfg.body;
    S.el.querySelector('#ghProto').textContent = S.cfg.label;
    var active = await api('/golden-hour/alerts/active' + q);
    if (!S.el) return;
    if (active.ok && active.body.alert && (OPEN_STATES.indexOf(active.body.alert.status) >= 0 || active.body.alert.status === 'no_capable_facility')) { S.alert = active.body.alert; renderStatus(); poll(); return; }
    renderForm();
    var first = S.el.querySelector('input,button.gh-send'); if (first) first.focus();
  }

  /* ---------- 1) danger-sign check + location + send ---------- */
  function row(code, label, big) {
    var on = S.codes.indexOf(code) >= 0;
    return '<label class="gh-check' + (big ? ' gh-check--big' : '') + (on ? ' is-on' : '') + '"><input type="checkbox" data-code="' + E(code) + '"' + (on ? ' checked' : '') + '><span>' + E(label) + '</span></label>';
  }
  function renderForm() {
    var cfg = S.cfg, who = S.family ? (S.motherName || 'her') : 'you';
    var heroCodes = cfg.hero.map(function (h) { return h.code; });
    var html = '';
    if (S.error) html += '<div class="gh-banner gh-banner--red" role="alert"><b>' + E(S.error) + '</b></div>';
    html += '<h2 class="gh-h">' + (S.family ? 'Alert for ' + E(S.motherName) : 'What is happening?') + '</h2>' +
      '<p class="gh-sub">Tick what ' + E(who) + (S.family ? ' is' : ' are') + ' having right now. If it is serious, the hospital that can really help is told before ' + (S.family ? 'she arrives' : 'you arrive') + '.</p>' +
      '<div class="gh-grid">' + cfg.hero.map(function (h) { return row(h.code, h.label, true); }).join('') + '</div>' +
      '<details class="gh-more"' + (S.codes.some(function (c) { return heroCodes.indexOf(c) < 0; }) ? ' open' : '') + '><summary>More danger signs</summary>' + cfg.other.map(function (o) { return row(o.code, o.label, false); }).join('') + '</details>' +
      '<h3 class="gh-h3">Where ' + (S.family ? 'is she' : 'are you') + '?</h3>' +
      '<div class="gh-loc"><label>Delhi PIN code<input id="ghPin" inputmode="numeric" maxlength="6" pattern="\\d{6}" placeholder="e.g. 110017" value="' + E(S.loc && S.loc.source === 'manual_pin' ? S.loc.pincode : (sessionStorage.getItem('gh_pin') || '')) + '"></label>' +
      '<button type="button" class="gh-btn" id="ghLoc">' + (S.loc && S.loc.source === 'device' ? 'Using device location ✓' : (S.family ? 'I am with her: use my location' : 'Use my location')) + '</button></div>' +
      '<p class="gh-fine">Only an approximate point (about 100 m) is shared, to find the nearest hospital that can help. Demo coverage: Delhi.</p>' +
      '<label class="gh-note">Anything the hospital should know? (optional)<textarea id="ghNote" maxlength="500">' + E(S.note) + '</textarea></label>' +
      '<button type="button" class="gh-send" id="ghSend"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Sending…' : 'Send emergency pre-alert') + '</button>' +
      '<p class="gh-fine"><b>Not sure? Call 112 (or 108) first.</b> This sends a heads-up to a demo hospital portal. It is not a bed, a doctor or an ambulance, and it is not a diagnosis.</p>';
    body().innerHTML = html;
    body().querySelectorAll('input[data-code]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var c = cb.getAttribute('data-code'), i = S.codes.indexOf(c);
        if (cb.checked && i < 0) S.codes.push(c); if (!cb.checked && i >= 0) S.codes.splice(i, 1);
        cb.parentNode.classList.toggle('is-on', cb.checked);
      });
    });
    body().querySelector('#ghLoc').addEventListener('click', useDevice);
    body().querySelector('#ghPin').addEventListener('input', function () { if (S.loc && S.loc.source === 'device') { S.loc = null; body().querySelector('#ghLoc').textContent = S.family ? 'I am with her: use my location' : 'Use my location'; } });
    body().querySelector('#ghNote').addEventListener('input', function (e) { S.note = e.target.value; });
    body().querySelector('#ghSend').addEventListener('click', send);
  }

  function useDevice() {
    var btn = body().querySelector('#ghLoc');
    if (!navigator.geolocation) { btn.textContent = 'Location not available. Enter a PIN.'; return; }
    btn.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(function (p) {
      S.loc = { source: 'device', consent: true, latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy };
      btn.textContent = 'Using device location ✓';
    }, function () { btn.textContent = 'Could not get location. Enter a PIN.'; }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }

  async function send() {
    if (S.busy) return;
    var pin = (body().querySelector('#ghPin').value || '').trim();
    S.note = body().querySelector('#ghNote').value;
    var loc = S.loc && S.loc.source === 'device' ? S.loc : (pin ? { source: 'manual_pin', pincode: pin } : null);
    S.error = '';
    if (!S.codes.length) { S.error = 'Tick at least one sign. If you are unsure and worried, call 112 (or 108).'; return renderForm(); }
    if (!loc) { S.error = 'Enter a Delhi PIN code or use your location.'; return renderForm(); }
    if (pin) sessionStorage.setItem('gh_pin', pin);
    S.busy = true; renderForm();
    var r = await api('/golden-hour/alerts', 'POST', { symptoms: S.codes, location: loc, note: S.note, context: S.context || undefined, emergency_event_id: S.eventId || undefined, mother_id: S.family ? S.motherId : undefined, request_key: S.key });
    S.busy = false;
    if (!S.el) return;
    if (!r.ok) { S.error = (r.body.error || 'Could not send.') + ' ' + (r.body.call || 'Call 112 (or 108) now.'); return renderForm(); }
    if (!r.body.alert) { S.notice = r.body.message; body().innerHTML = '<div class="gh-banner gh-banner--amber"><b>' + E(r.body.message) + '</b></div>' + numbersHtml(r.body.numbers) + '<button type="button" class="gh-btn" id="ghBack">Back</button>'; body().querySelector('#ghBack').addEventListener('click', renderForm); return; }
    S.alert = r.body.alert; S.notice = r.body.message || r.body.notice || '';
    renderStatus(); poll();
  }
  function numbersHtml(n) { n = n || { national: { number: '112', label: 'National emergency number' }, ambulance: { number: '108', label: 'Ambulance' } }; return '<p class="gh-sub">' + Object.keys(n).filter(function (k) { return k !== 'mental_health'; }).map(function (k) { return '<b>' + E(n[k].number) + '</b> ' + E(n[k].label); }).join(' · ') + '</p>'; }

  /* ---------- 2) live status ---------- */
  function stepState(a) {
    var h = a.hospital && a.hospital.status, st = a.status;
    var seen = ['received', 'accepted', 'arrived'].indexOf(st) >= 0 || ['seen', 'accepted', 'arrived'].indexOf(h) >= 0;
    var accepted = st === 'accepted' || st === 'arrived' || h === 'accepted' || h === 'arrived';
    var arrived = st === 'arrived' || h === 'arrived';
    return [{ t: 'Alert sent', d: a.delivery === 'delivered' }, { t: 'Hospital has seen it', d: seen }, { t: 'Hospital accepted', d: accepted }, { t: 'Arrived', d: arrived }];
  }
  function renderStatus() {
    var a = S.alert; if (!a || !S.el) return;
    var amb = a.hospital && a.hospital.ambulance, f = a.facility, html = '';
    var closed = OPEN_STATES.indexOf(a.status) < 0 && a.status !== 'no_capable_facility';
    if (S.notice) html += '<div class="gh-banner gh-banner--amber">' + E(S.notice) + '</div>';
    html += '<div class="gh-banner gh-banner--red"><b>' + (a.status === 'no_capable_facility' ? 'No hospital was alerted.' : a.delivery === 'not_delivered' ? 'The hospital has NOT been told.' : 'Pre-alert sent. Keep going to emergency care.') + '</b><ul>' + a.instructions.map(function (i) { return '<li>' + E(i) + '</li>'; }).join('') + '</ul></div>';
    if (a.delivery === 'not_delivered') html += '<button type="button" class="gh-btn gh-btn--red" id="ghRetry">Try sending again</button>';
    if (f) {
      html += '<div class="gh-fac"><div><small>Alerted hospital</small><b>' + E(f.name) + '</b><span>' + E(f.distance_km) + ' km · about ' + E(f.eta_minutes) + ' min by ambulance (simulated estimate)</span></div><span class="gh-chip gh-chip--' + (a.priority === 'emergency' ? 'red' : 'amber') + '">' + E(a.priority) + '</span></div>';
      html += '<ol class="gh-steps">' + stepState(a).map(function (s) { return '<li class="' + (s.d ? 'is-done' : '') + '">' + E(s.t) + '</li>'; }).join('') + '</ol>';
      if (a.hospital && a.hospital.public_note) html += '<p class="gh-reply"><b>Hospital:</b> ' + E(a.hospital.public_note) + (a.hospital.accepted_by ? ' (' + E(a.hospital.accepted_by) + ')' : '') + '</p>';
      if (amb && amb.state !== 'stood_down') html += '<div class="gh-amb"><b>Ambulance (SIMULATED demo feed)</b><span>' + E(amb.state === 'arrived' ? 'Arrived' : (amb.state || '').replace(/_/g, ' ') + ' · about ' + E(amb.remaining_minutes) + ' min') + '</span><div class="gh-bar"><i style="width:' + Math.round((amb.progress || 0) * 100) + '%"></i></div><small>This is not a real vehicle. Call 108 or 112 for a real ambulance.</small></div>';
    }
    if (a.why && f) {
      html += '<details class="gh-det" id="ghWhy"' + (S.whyOpen ? ' open' : '') + '><summary>Why this hospital?</summary><p>' + E(a.why.reasons.map(function (r) { return r.why; }).join(' ')) + '</p><p>It lists: ' + E([].concat(a.why.needs.capabilities, a.why.needs.any_of.map(function (g) { return g.join(' or '); }), a.why.needs.services).join(', ') || 'obstetric care') + '.</p>' +
        (a.why.skipped_nearer.length ? '<p><b>Nearer, but skipped:</b></p><ul>' + a.why.skipped_nearer.map(function (s) { return '<li>' + E(s.name) + ' (' + E(s.distance_km) + ' km) does not list ' + E(s.missing.join(', ')) + '.</li>'; }).join('') + '</ul>' : '') + '<small>' + E(a.why.eta_assumptions) + '</small></details>';
    }
    if (a.sbar) {
      html += '<details class="gh-det" id="ghSbar"' + (S.sbarOpen ? ' open' : '') + '><summary>What the hospital sees (SBAR)</summary>' + a.sbar.sections.map(function (s) { return '<h4>' + E(s.key) + ' · ' + E(s.title) + '</h4><dl>' + s.rows.map(function (r) { return '<dt>' + E(r.label) + '</dt><dd>' + E(r.value) + '</dd>'; }).join('') + '</dl>'; }).join('') + '</details>';
    }
    if (a.history && a.history.length) html += '<details class="gh-det"><summary>What happened</summary><ol>' + a.history.map(function (h) { return '<li>' + E(h.text) + '</li>'; }).join('') + '</ol></details>';
    if (!closed) html += '<div class="gh-row"><button type="button" class="gh-btn" id="ghCancel">This was a false alarm / cancel</button></div>';
    else html += '<div class="gh-row"><button type="button" class="gh-btn" id="ghNew">Start a new check</button></div>';
    body().innerHTML = html;
    var det = body().querySelector('#ghSbar'); if (det) det.addEventListener('toggle', function () { S.sbarOpen = det.open; });
    var why = body().querySelector('#ghWhy'); if (why) why.addEventListener('toggle', function () { S.whyOpen = why.open; });
    var retry = body().querySelector('#ghRetry'); if (retry) retry.addEventListener('click', async function () { var r = await api('/golden-hour/alerts/' + a.id + '/retry', 'POST'); if (r.ok) { S.alert = r.body.alert; S.notice = r.body.sent ? 'Sent.' : 'Still could not reach the hospital. Call 112 (or 108) and the facility.'; renderStatus(); } });
    var c = body().querySelector('#ghCancel'); if (c) c.addEventListener('click', async function () { if (!confirm('Cancel this alert? Only do this if help is no longer needed. You can still call 112 (or 108).')) return; var r = await api('/golden-hour/alerts/' + a.id + '/cancel', 'POST', {}); if (r.ok) { S.alert = r.body.alert; S.notice = ''; renderStatus(); } });
    var n = body().querySelector('#ghNew'); if (n) n.addEventListener('click', function () { S.alert = null; S.codes = []; S.key = requestKey(); S.error = ''; S.notice = ''; renderForm(); });
  }

  function poll() {
    if (S.timer) clearTimeout(S.timer);
    if (!S.el || !S.alert || !S.alert.id) return;
    var closed = OPEN_STATES.indexOf(S.alert.status) < 0 && S.alert.status !== 'no_capable_facility';
    if (closed || S.alert.status === 'no_capable_facility') return;
    S.timer = setTimeout(async function () {
      if (!S.el) return;
      var r = await api('/golden-hour/alerts/' + S.alert.id);
      if (r.ok && S.el) {
        var before = S.alert.status + '|' + (S.alert.facility && S.alert.facility.code);
        S.alert = r.body.alert;
        if (r.body.rerouted === true) S.notice = 'That hospital could not accept. The alert was sent to the next capable hospital. Keep going to emergency care.';
        if (r.body.rerouted === false) S.notice = 'That hospital could not accept and no other capable hospital is listed. Call 112 (or 108) now.';
        renderStatus();
        void before;
      }
      poll();
    }, document.hidden ? POLL_MS * 4 : POLL_MS);
  }

  /* ---------- family page ---------- */
  function mountFamily(container, grants) {
    (grants || []).forEach(function (g) {
      if (!g || !Array.isArray(g.scopes) || g.scopes.indexOf('emergency_alert') < 0 || !g.mother_id) return;
      var card = document.createElement('section'); card.className = 'connected-care-card gh-family';
      card.innerHTML = '<h2>Emergency alert for ' + E(g.mother_name) + '</h2><p>She has allowed you to start a Golden Hour pre-alert for her. <b>In a real emergency call 112 (or 108) first.</b> This is a prototype with synthetic demo data only.</p><button type="button" class="gh-send">Start danger-sign check</button>';
      card.querySelector('button').addEventListener('click', function () { open({ family: true, motherId: g.mother_id, motherName: g.mother_name }); });
      container.prepend(card);
    });
  }

  window.GoldenHourUI = Object.assign(ui, { open: open, close: close, mountFamily: mountFamily });
  // Only mothers' own pages probe; the family page does not need to.
  if (document.getElementById('ghProbe') || /dashboard/.test(location.pathname) || location.pathname === '/' ) probe();
})();
