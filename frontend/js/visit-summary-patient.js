/* O. Patient view of clinician-approved visit summaries. Everything shown was typed and approved by the
   clinician; nothing here is generated. All text is escaped before display. */
(function () {
  'use strict';
  var api = window.DaiAPI, host;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(d) { return d ? api.fmtDate(d) : ''; }
  function section(title, inner) { return inner ? '<h3 style="margin:.9rem 0 .3rem;font-size:.95rem">' + esc(title) + '</h3>' + inner : ''; }

  function nextCard(n) {
    if (!n) return '';
    var line = when(n.date) + (n.time ? ' at ' + esc(String(n.time).slice(0, 5)) : '');
    return section('Your next appointment',
      '<div class="consent-event"><div><strong>' + line + '</strong><small>' + [n.clinician, n.facility_name, n.reason].filter(Boolean).map(esc).join(' \u00b7 ') + '</small></div>' +
      '<span class="tag ' + (n.confirmed ? 'tag--ok' : 'tag--pending') + '">' + (n.confirmed ? 'Confirmed' : 'Waiting for confirmation') + '</span></div>');
  }

  function card(s, next, open) {
    var steps = (s.next_steps || []).length ? '<ol style="margin:.2rem 0 0 1.2rem">' + s.next_steps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '';
    var f = s.follow_up || {}, follow = (f.text || f.due_date) ? '<p style="margin:0">' + esc(f.text || '') + (f.due_date ? ' <strong>By ' + esc(when(f.due_date)) + '</strong>' : '') + '</p>' : '';
    var tests = (s.pending_tests || []).length ? '<ul style="margin:.2rem 0 0 1.2rem">' + s.pending_tests.map(function (t) {
      return '<li>' + esc(t.name) + (t.note ? ' \u2013 ' + esc(t.note) : '') + (t.due_date ? ' (by ' + esc(when(t.due_date)) + ')' : '') + '</li>';
    }).join('') + '</ul>' : '';
    var who = [s.clinician, s.specialization].filter(Boolean).map(esc).join(', ');
    return '<details class="vs-item card section-card"' + (open ? ' open' : '') + ' style="margin:.6rem 0;padding:.8rem 1rem">' +
      '<summary style="cursor:pointer"><strong>Visit on ' + esc(when(s.visit_date)) + '</strong>' + (who ? ' \u00b7 ' + who : '') +
      (s.patient_seen_at ? '' : ' <span class="tag tag--next">New</span>') + '</summary>' +
      '<p style="margin:.4rem 0 0"><span class="tag tag--ok">Confirmed by your clinician on ' + esc(when(String(s.approved_at).slice(0, 10))) + '</span></p>' +
      section('In simple words', s.summary_text ? '<p style="margin:0">' + esc(s.summary_text) + '</p>' : '') +
      section('What to do next', steps) + section('Follow-up', follow) + section('Tests still to do', tests) +
      (next ? nextCard(next) : '') +
      (s.patient_seen_at ? '' : '<p style="margin:.8rem 0 0"><button type="button" class="btn btn--sm btn--ghost" data-vs-seen="' + esc(s.id) + '">Got it</button></p>') +
      '</details>';
  }

  async function load() {
    host = document.getElementById('visitSummaries'); if (!host) return;
    if (localStorage.getItem('dai_guest') === '1') { host.innerHTML = ''; return; }
    var r = await api.apiRequest('/patient/visit-summaries');
    if (!r) return;
    if (!r.summaries.length) {
      host.innerHTML = '<h2 style="margin:0 0 .3rem">After your visit</h2><p class="connected-muted">No visit summary yet. After a visit, your clinician may add a short summary here. You will only see instructions they have confirmed.</p>';
      return;
    }
    host.innerHTML = '<h2 style="margin:0 0 .3rem">After your visit</h2>' +
      r.summaries.map(function (s, i) { return card(s, i === 0 ? r.next_appointment : null, i === 0); }).join('') +
      '<p class="connected-muted">' + esc(r.notice) + '</p>';
  }

  document.addEventListener('click', async function (e) {
    var b = e.target.closest && e.target.closest('[data-vs-seen]'); if (!b) return;
    var res = await api.apiRequest('/patient/visit-summaries/' + encodeURIComponent(b.getAttribute('data-vs-seen')) + '/seen', { method: 'POST', body: {} });
    if (res) load();
  });
  document.querySelectorAll('[data-panel="appointments"]').forEach(function (n) { n.addEventListener('click', load); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
  window.VisitSummaryPatient = { load: load };
})();
