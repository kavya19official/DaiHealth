/**
 * Doctor portal — Safety Monitor
 *   1. Emergency heads-up: recent SOS records from the doctor's own patients
 *   2. Risk trend per patient: BP / glucose charts, early-warning signals,
 *      and the explanation behind the current risk level
 *   3. Postpartum view per patient: delivery, schedule, check-in history
 *
 * Reads only the endpoints the backend already gates on "this doctor has an
 * appointment with this mother":
 *   GET /api/doctor/emergencies
 *   GET /api/doctor/patients/:id/risk-trend
 *   GET /api/doctor/patients/:id/postpartum
 *
 * It is a read-only heads-up. It does not dispatch anything, and it never
 * shows bed availability or any "accepted" status — the app has no source for
 * those. Everything a mother reports (steps she took) is labelled as self-reported.
 *
 * Needs: DaiAPI, CareExt.helpers (js/care-extensions.js), AnvayaEmergency.
 */
(function () {
  'use strict';

  var api = window.DaiAPI;
  var H = (window.CareExt && window.CareExt.helpers) || null;
  var EM = window.AnvayaEmergency;
  var st = { guest: false, patients: [], selected: null, days: 90, events: [], timer: null, seq: 0 };

  function $(id) { return document.getElementById(id); }
  var esc = H ? H.esc : function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 90) return m + ' min ago';
    var h = Math.round(m / 60);
    return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
  }
  var SYM = {};
  if (EM) EM.SYMPTOMS.forEach(function (s) { SYM[s.code] = s.label; });
  var ACTION = { called_ambulance: 'called an ambulance', called_contact: 'called her emergency contact', called_facility: 'called a facility', shared_summary: 'shared the summary', left_for_facility: 'left for a facility', reached_facility: 'reached a facility' };
  var OUTCOME = { reached_facility: 'reached a facility and was seen', treated_at_home: 'got advice and stayed home', false_alarm: 'false alarm', other: 'other' };

  /* ---------------- 1. emergency heads-up ---------------- */
  function eventHtml(e) {
    var lvl = e.triage_level === 'emergency' ? 'emergency' : (e.triage_level === 'urgent' ? 'urgent' : 'info');
    var active = e.status === 'active';
    var syms = (e.symptoms || []).map(function (c) { return SYM[c] || c; });
    var acts = (e.actions || []).map(function (a) { return (ACTION[a.action] || a.action) + (a.at ? ' (' + ago(a.at) + ')' : ''); });
    var sum = e.summary && e.summary.sections ? e.summary.sections.map(function (sec) {
      return '<h4>' + esc(sec.title) + '</h4><dl>' + sec.rows.map(function (r) { return '<dt>' + esc(r.label) + '</dt><dd' + (r.value === 'Not recorded' ? ' class="nr"' : '') + '>' + esc(r.value) + '</dd>'; }).join('') + '</dl>';
    }).join('') : '';
    return '<div class="cx-card" style="border-left:4px solid ' + (active ? 'var(--rose)' : 'var(--line)') + ';margin-bottom:.7rem">' +
      '<div style="display:flex;justify-content:space-between;gap:.8rem;flex-wrap:wrap;align-items:flex-start"><div>' +
      '<div style="font-weight:700">' + esc(e.full_name) + ' <span style="font-weight:500;color:var(--ink-muted);font-size:.82rem">· ' + (e.context === 'postpartum' ? 'after birth' : 'pregnant') + ' · ' + esc(ago(e.created_at)) + '</span></div>' +
      '<div style="margin:.25rem 0">' + H.chip(lvl, 'App triage: ' + e.triage_level) + ' ' + (active ? H.chip('urgent', 'Record still open') : H.chip('ok', 'Closed' + (e.outcome ? ': ' + (OUTCOME[e.outcome] || e.outcome) : ''))) + '</div></div>' +
      (e.phone ? '<a class="cx-call" href="' + H.telHref(e.phone) + '">Call ' + esc(e.phone) + '</a>' : '') + '</div>' +
      '<div style="font-size:.86rem;margin-top:.3rem"><b>Reported:</b> ' + (syms.length ? esc(syms.join('; ')) : 'no specific symptom selected') + (e.note ? '<br><b>Her note:</b> ' + esc(e.note) : '') + '</div>' +
      '<div style="font-size:.82rem;color:var(--ink-muted);margin-top:.25rem"><b>Steps she says she took (self-reported, not confirmed):</b> ' + (acts.length ? esc(acts.join('; ')) : 'none recorded yet') + '</div>' +
      (sum ? '<details class="cx-details cx-sum"><summary>Emergency summary she prepared</summary>' + sum + '</details>' : '') + '</div>';
  }

  function renderEvents() {
    var box = $('safetyEvents');
    if (!box) return;
    if (st.guest) { box.innerHTML = '<p class="cx-sub">Sign in with a real doctor account to see emergency heads-ups from your patients.</p>'; return; }
    var active = st.events.filter(function (e) { return e.status === 'active'; }).length;
    var badge = $('safetyBadge');
    if (badge) { badge.textContent = active; badge.style.display = active ? '' : 'none'; }
    box.innerHTML = '<div class="cx-sub">Last 72 hours, from patients you have an appointment with. This is a read-only heads-up — it does not alert anyone or dispatch help, and the app cannot tell whether any facility has received her. If a record is open, please contact the patient directly.</div>' +
      (st.events.length ? st.events.map(eventHtml).join('') : '<div class="cx-sig" style="background:#ecfdf5;border-color:#a7f3d0;color:#047857">No emergency records from your patients in the last 72 hours.</div>');
  }

  async function loadEvents() {
    if (st.guest) { renderEvents(); return; }
    var r = await api.apiRequest('/doctor/emergencies');
    if (r) { st.events = r.events || []; renderEvents(); }
  }

  /* ---------------- 2 + 3. per-patient views ---------------- */
  function patientPicker() {
    if (!st.patients.length) return '<p class="cx-sub">No linked patients yet — patients appear here once they book an appointment with you.</p>';
    return '<div class="cx-field" style="max-width:360px"><label for="safetyPatient">Patient</label><select id="safetyPatient"><option value="">Choose a patient…</option>' +
      st.patients.map(function (p) { return '<option value="' + esc(p.id) + '"' + (String(st.selected) === String(p.id) ? ' selected' : '') + '>' + esc(p.full_name) + '</option>'; }).join('') + '</select></div>';
  }

  function trendHtml(d) {
    var h = [];
    var seg = [30, 90].map(function (n) { return '<button type="button" data-days="' + n + '" class="' + (st.days === n ? 'is-on' : '') + '">' + n + ' days</button>'; }).join(' ');
    h.push('<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem"><div class="cx-h" style="margin:0">Risk trend</div><div class="cx-seg">' + seg + '</div></div>');
    var la = d.latest_assessment;
    h.push('<div style="margin:.4rem 0">' + (la ? 'Current screen: ' + H.chip(la.risk_level === 'high risk' ? 'emergency' : (la.risk_level === 'mid risk' ? 'urgent' : 'ok'), la.risk_level) + ' <span class="cx-sub" style="display:inline">· assessed ' + esc(ago(la.assessed_at)) + ' (' + esc((la.trigger || '').replace('_', ' ')) + ')</span>' : '<span class="cx-sub">No risk screen run yet.</span>') + '</div>');
    if (d.signals.length) d.signals.forEach(function (s) {
      var c = H.LEVEL_STYLE[s.level === 'urgent' ? 'urgent' : (s.level === 'watch' ? 'watch' : 'info')];
      h.push('<div class="cx-sig" style="background:' + c.bg + ';border-color:' + c.bd + ';color:' + c.fg + '"><strong>' + esc(s.title) + '</strong>' + esc(s.detail) + '</div>');
    });
    else h.push('<div class="cx-sig" style="background:#ecfdf5;border-color:#a7f3d0;color:#047857">No early-warning signals in this window.</div>');
    if (d.bp.count) {
      var pts = d.bp.points.map(function (p) { return { t: Date.parse(p.at), sys: p.systolic, dia: p.diastolic }; });
      h.push('<div class="cx-h" style="margin-top:.7rem;font-size:.92rem">Blood pressure (' + d.bp.count + ' readings)</div><div class="cx-sub">' + esc(d.bp.trend.note) + '</div>');
      h.push(H.lineChart(pts, { label: 'Blood pressure', min: 50, max: 180, refs: [{ y: 140 }, { y: 90 }], lines: [{ key: 'sys', color: '#7c3aed', bad: function (p) { return p.sys >= 140; } }, { key: 'dia', color: '#3b82f6', bad: function (p) { return p.dia >= 90; } }] }));
    } else h.push('<p class="cx-sub">No blood-pressure readings logged in this window.</p>');
    if (d.glucose.count) {
      var g = d.glucose.points.map(function (p) { return { t: Date.parse(p.at), g: p.mg_dl, bad: p.above_target }; });
      h.push('<div class="cx-h" style="margin-top:.7rem;font-size:.92rem">Blood sugar (' + d.glucose.count + ' readings)</div>');
      h.push(H.lineChart(g, { label: 'Blood sugar', min: 40, max: Math.max(200, Math.max.apply(null, g.map(function (p) { return p.g; })) + 10), refs: [{ y: 95 }], lines: [{ key: 'g', color: '#10b981', bad: function (p) { return p.bad; } }] }));
    }
    var ex = la && la.explanation;
    if (ex) {
      h.push('<details class="cx-details"><summary>Why the model gave this level</summary><ul>' + ex.summary.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
        (la.factors && la.factors.length ? '<div class="cx-sub">Clinical rules applied:</div><ul>' + la.factors.map(function (f) { return '<li>' + esc(f.label || f.code) + '</li>'; }).join('') + '</ul>' : '') +
        (ex.data_gaps.length ? '<div class="cx-sub">Assumed inputs:</div><ul>' + ex.data_gaps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
        '<p class="cx-sub">' + esc(ex.caveat) + '</p></details>');
    }
    return h.join('');
  }

  function answerSummary(a) {
    if (!a) return '';
    var bits = [];
    if (a.bp_systolic != null) bits.push('BP ' + a.bp_systolic + '/' + a.bp_diastolic);
    if (a.temp_f != null) bits.push(a.temp_f + '°F');
    bits.push('bleeding ' + a.bleeding);
    bits.push('pain ' + a.pain + '/10');
    return bits.join(' · ');
  }

  function postpartumHtml(d) {
    if (!d.active) return '<div class="cx-h">Postpartum</div><p class="cx-sub">No delivery recorded for this patient, so there is no postpartum pathway yet.</p>';
    var h = ['<div class="cx-h">Postpartum</div><div class="cx-sub">Day ' + d.days_postpartum + ' after delivery (' + esc(api.fmtDate(d.delivery.date)) + ', ' + esc(d.delivery.type === 'unknown' ? 'type not recorded' : d.delivery.type) + ') · ' + esc(d.phase ? d.phase.title : '') + '</div>'];
    h.push('<div style="margin:.4rem 0">' + d.schedule.map(function (c) {
      var lvl = c.status === 'done' ? 'ok' : (c.status === 'overdue' ? 'urgent' : (c.status === 'open' ? 'watch' : 'info'));
      var t = { done: 'done', overdue: 'not marked done', open: 'due now', upcoming: 'upcoming' }[c.status];
      return '<div class="cx-row"><span style="font-size:.86rem">' + esc(c.title) + '</span>' + H.chip(lvl, t) + '</div>';
    }).join('') + '</div><div class="cx-sub">“Not marked done” means the mother has not ticked it — it does not mean the visit was missed.</div>');
    h.push('<div class="cx-h" style="margin-top:.7rem;font-size:.92rem">Daily check-ins (self-reported)</div>');
    if (!d.recent_checkins.length) h.push('<p class="cx-sub">No check-ins yet.</p>');
    else h.push('<table class="table"><thead><tr><th>Date</th><th>Result</th><th>Flags</th><th>Answers</th></tr></thead><tbody>' + d.recent_checkins.map(function (c) {
      return '<tr style="cursor:default"><td>' + esc(api.fmtDate(c.checkin_date)) + '</td><td>' + H.chip(c.level) + '</td><td>' + ((c.flags || []).map(function (f) { return esc(f.label); }).join('; ') || '—') + '</td><td style="color:var(--ink-muted)">' + esc(answerSummary(c.answers)) + '</td></tr>';
    }).join('') + '</tbody></table>');
    return h.join('');
  }

  async function loadPatient() {
    var box = $('safetyPatientView');
    if (!box) return;
    if (!st.selected) { box.innerHTML = ''; return; }
    var mine = ++st.seq;
    box.innerHTML = '<p class="cx-sub">Loading…</p>';
    var both = await Promise.all([
      api.apiRequest('/doctor/patients/' + encodeURIComponent(st.selected) + '/risk-trend?days=' + st.days),
      api.apiRequest('/doctor/patients/' + encodeURIComponent(st.selected) + '/postpartum')
    ]);
    if (mine !== st.seq) return;   // a newer selection superseded this one
    box.innerHTML = '<div class="cx-card">' + (both[0] ? trendHtml(both[0]) : '<p class="cx-sub">Could not load the risk trend.</p>') + '</div>' +
      '<div class="cx-card">' + (both[1] ? postpartumHtml(both[1]) : '<p class="cx-sub">Could not load postpartum details.</p>') + '</div>';
    Array.prototype.forEach.call(box.querySelectorAll('.cx-seg button'), function (b) {
      b.addEventListener('click', function () { st.days = Number(b.getAttribute('data-days')); loadPatient(); });
    });
  }

  function renderShell() {
    var root = $('safetyRoot');
    if (!root) return;
    root.innerHTML = '<div class="cx-card"><div class="cx-h">Emergency heads-up</div><div id="safetyEvents"><p class="cx-sub">Loading…</p></div></div>' +
      '<div class="cx-card"><div class="cx-h">Patient safety view</div>' +
      (st.guest ? '<p class="cx-sub">Sign in with a real doctor account to see risk trends and postpartum check-ins.</p>' : '<div id="safetyPicker">' + patientPicker() + '</div>') +
      '</div><div id="safetyPatientView"></div>';
    wirePicker();
    renderEvents();
  }
  function wirePicker() {
    var sel = $('safetyPatient');
    if (sel) sel.addEventListener('change', function () { st.selected = sel.value || null; loadPatient(); });
  }

  async function loadPatients() {
    if (st.guest) return;
    var r = await api.apiRequest('/doctor/patients');
    st.patients = (r && r.patients) || [];
    var pk = $('safetyPicker');
    if (pk) { pk.innerHTML = patientPicker(); wirePicker(); }
  }

  // Called from the patients table ("Safety view") and anywhere else with a patient id.
  function openPatient(id) {
    if (st.guest || !st.patients.some(function (p) { return String(p.id) === String(id); })) {
      api.toast('No live data for this patient (demo record or not linked to you)');
      return;
    }
    st.selected = String(id);
    var nav = document.querySelector('.nav-item[data-panel="safety"]');
    if (nav) nav.click();
    var sel = $('safetyPatient');
    if (sel) sel.value = st.selected;
    loadPatient();
  }

  function init(opts) {
    if (!H) { console.error('doctor-safety.js needs js/care-extensions.js'); return; }
    st.guest = !!(opts && opts.guest);
    H.injectStyles();
    renderShell();
    loadEvents();
    loadPatients().then(function () { if (st.selected) loadPatient(); });
    var nav = document.querySelector('.nav-item[data-panel="safety"]');
    if (nav) nav.addEventListener('click', function () { loadEvents(); loadPatients(); });
    clearInterval(st.timer);
    st.timer = setInterval(function () { if (!document.hidden && !(window.DaiAPI&&window.DaiAPI.lowBandwidth&&window.DaiAPI.lowBandwidth())) loadEvents(); }, 60000);
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-safe]');
      if (b) openPatient(b.getAttribute('data-safe'));
    });
  }

  window.DoctorSafety = { init: init, openPatient: openPatient, refresh: loadEvents };
})();
