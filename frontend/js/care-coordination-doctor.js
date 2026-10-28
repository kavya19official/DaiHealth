/* C. Sustainability-aware care coordination (clinician view). Verified instruction packs, prior reports and
   referral status, clinician-owned test decisions, preventive follow-up queue and an evaluation that only counts. */
(function () {
  'use strict';
  var api = window.DaiAPI, root, patients = [], current = null;
  var KIND = { visit_instructions: 'Visit instructions', test_preparation: 'Test preparation', follow_up_summary: 'Follow-up summary' };
  var DECISION = { prior_result_used: 'Prior result used (no repeat)', repeat_clinically_indicated: 'Repeat: clinically indicated', repeat_prior_unavailable: 'Repeat: prior result unavailable', repeat_other: 'Repeat: other reason' };
  var ACTION = { reminder_sent: 'Reminder sent', contacted: 'Contacted', booked: 'Booked' };
  var FOLLOW = { pending: 'Pending', completed: 'Completed', rescheduled: 'Rescheduled', unreachable: 'Unreachable', declined: 'Declined' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(d) { return d ? api.fmtDate(String(d).slice(0, 10)) : '—'; }
  function opts(map, sel) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); }
  function counts(o) { var k = Object.keys(o || {}); return k.length ? k.map(function (x) { return esc(x.replace(/_/g, ' ')) + ': ' + esc(o[x]); }).join(' · ') : 'none recorded'; }
  function h3(t) { return '<h3 style="margin:1.1rem 0 .4rem">' + esc(t) + '</h3>'; }

  function evaluation(ev) {
    return '<div role="note" style="padding:.6rem .8rem;border:1px solid #d6d3d1;border-radius:8px"><strong>Evaluation (recorded events only)</strong>' +
      '<ul style="margin:.4rem 0 0 1.1rem"><li>Verified instructions: ' + esc(ev.instructions.verified) + ' (seen ' + esc(ev.instructions.seen) + ', in-person required ' + esc(ev.instructions.in_person_required) + '). Patient feedback: ' + counts(ev.instructions.patient_feedback) + '</li>' +
      '<li>Referral journeys: ' + counts(ev.referrals.outcomes) + '. First search, first visit: ' + esc(ev.referrals.first_search_first_visit) + '; capability failures: ' + esc(ev.referrals.capability_failures) + '; searches unknown: ' + esc(ev.referrals.searches_unknown) + '</li>' +
      '<li>Test decisions: ' + counts(ev.tests) + '</li>' +
      '<li>Follow-up outcomes: ' + counts(ev.follow_up.latest_outcomes) + '. Patients with reported emergency use: ' + esc(ev.follow_up.patients_with_reported_emergency_use) + '</li></ul>' +
      '<p style="margin:.4rem 0 0"><small>' + esc(ev.notice) + '</small></p></div>';
  }

  function gapRow(g) {
    var last = g.last_event ? esc(ACTION[g.last_event.action]) + ' → ' + esc(FOLLOW[g.last_event.outcome]) + (g.last_event.emergency_use_reported ? ' · emergency use reported' : '') : 'No action yet';
    return '<tr data-gap="' + esc(g.gap_key) + '" data-mother="' + esc(g.mother_id) + '"><td>' + esc(g.patient_name) + '</td><td>' + esc(g.title) + '</td><td>' + esc(day(g.due_date)) + '</td><td>' + last + '</td>' +
      '<td><select aria-label="Action" data-f="action">' + opts(ACTION) + '</select> <select aria-label="Outcome" data-f="outcome">' + opts(FOLLOW) + '</select> ' +
      '<label><input type="checkbox" data-f="emergency"> Emergency use reported</label> <button type="button" class="btn btn--sm" data-gap-save>Record</button></td></tr>';
  }

  function patientPanel(d) {
    var reports = d.reports.length ? '<ul>' + d.reports.map(function (r) { return '<li>' + esc(r.title) + ' · ' + esc(r.doc_type.replace(/_/g, ' ')) + ' · ' + esc(day(r.report_date || r.uploaded_at)) + (r.facility_name ? ' · ' + esc(r.facility_name) : '') + ' · ' + esc(r.verification_status) + '</li>'; }).join('') + '</ul>' : '<p>No reports shared with you.</p>';
    var refs = d.referrals.map(function (r) { return '<li>' + esc(r.referral_type) + ' · ' + esc(r.priority) + ' · <strong>' + esc(r.status) + '</strong> · ' + esc(day(r.created_at)) + (r.summary_returned ? ' · summary returned' : '') + '</li>'; })
      .concat(d.facility_referrals.map(function (r) { return '<li>' + esc(r.facility_name || 'Facility') + ' · <strong>' + esc(r.status) + '</strong> · ' + esc(day(r.created_at)) + '</li>'; }))
      .concat(d.journeys.map(function (j) { return '<li>Journey: ' + esc(j.care_need) + (j.facility_name ? ' at ' + esc(j.facility_name) : '') + ' · ' + esc(j.outcome.replace(/_/g, ' ')) + (j.prior_searches != null ? ' · ' + esc(j.prior_searches) + ' prior searches' : '') + (j.capability_matched === false ? ' · capability not listed there' : '') + '</li>'; }));
    var pending = d.pending_tests.map(function (s) { return '<li>' + esc(day(s.visit_date)) + ': ' + s.pending_tests.map(function (t) { return esc(t.name); }).join(', ') + '</li>'; });
    var decisions = d.test_decisions.map(function (t) { return '<li>' + esc(t.test_name) + ' · ' + esc(DECISION[t.decision]) + (t.reason ? ' – ' + esc(t.reason) : '') + ' · ' + esc(t.clinician || '') + ' · ' + esc(day(t.created_at)) + '</li>'; });
    return '<p role="note"><small>' + esc(d.notice) + '</small></p>' +
      h3('Prior reports shared with you') + reports + (d.unshared_report_count ? '<p><small>' + esc(d.unshared_report_count) + ' other report(s) exist but are not shared with you. Ask the patient to share them if needed.</small></p>' : '') +
      h3('Referral status') + (refs.length ? '<ul>' + refs.join('') + '</ul>' : '<p>No referrals recorded.</p>') +
      (pending.length ? h3('Tests pending from earlier visits') + '<ul>' + pending.join('') + '</ul>' : '') +
      h3('Record a test decision') +
      '<form id="ccTest" class="form-grid"><label>Test <input name="test_name" required maxlength="100"></label><label>Decision <select name="decision">' + opts(DECISION) + '</select></label>' +
      '<label>Prior report <select name="document_id"><option value="">None</option>' + d.reports.map(function (r) { return '<option value="' + r.id + '">' + esc(r.title) + '</option>'; }).join('') + '</select></label>' +
      '<label>Clinical reason (required to repeat) <input name="reason" maxlength="300"></label><button type="submit" class="btn">Record</button></form>' +
      (decisions.length ? '<ul>' + decisions.join('') + '</ul>' : '') +
      h3('New digital instructions') +
      '<form id="ccPack" class="form-grid"><label>Type <select name="kind">' + opts(KIND) + '</select></label><label>Title <input name="title" required maxlength="160"></label>' +
      '<label style="grid-column:1/-1">Instructions in simple words <textarea name="body" rows="4" required maxlength="2000"></textarea></label>' +
      '<label><input type="checkbox" name="in_person_required"> In-person visit clinically necessary</label><label>Why in person <input name="in_person_reason" maxlength="300"></label>' +
      '<button type="submit" class="btn">Save draft</button></form><div id="ccHints"></div>';
  }

  function packsTable(packs) {
    if (!packs.length) return '<p>No instruction packs yet.</p>';
    return '<div style="overflow-x:auto"><table class="dw-table"><thead><tr><th>Patient</th><th>Instructions</th><th>Status</th><th></th></tr></thead><tbody>' + packs.map(function (p) {
      return '<tr><td>' + esc(p.patient_name) + '</td><td>' + esc(p.title) + ' · ' + esc(KIND[p.kind]) + (p.in_person_required ? ' · in person' : '') + '</td><td>' + esc(p.status) + (p.patient_seen_at ? ' · seen' : '') + (p.feedback ? ' · ' + esc(p.feedback.replace(/_/g, ' ')) : '') + '</td><td>' +
        (p.status === 'draft' ? '<button type="button" class="btn btn--sm" data-pack-verify="' + p.id + '">Verify & share</button> ' : '') +
        (p.status !== 'withdrawn' ? '<button type="button" class="link-btn" data-pack-withdraw="' + p.id + '">Withdraw</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  async function load() {
    root = document.getElementById('dwCareCoordination'); if (!root) return;
    root.innerHTML = '<p>Loading…</p>';
    var res = await Promise.all([api.apiRequest('/doctor/care-coordination/evaluation'), api.apiRequest('/doctor/care-coordination/care-gaps'), api.apiRequest('/doctor/care-coordination/packs'), api.apiRequest('/doctor/patients')]);
    var ev = res[0], gaps = res[1], packs = res[2]; patients = (res[3] && (res[3].patients || res[3])) || [];
    if (!ev || !gaps || !packs) { root.innerHTML = '<p>Sustainable care tools are limited to verified clinicians.</p>'; return; }
    root.innerHTML = '<p class="eyebrow" style="margin:0;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Sustainability</p><h2 style="margin:0 0 .25rem">Sustainable care</h2><p style="margin:0 0 .75rem">Digital-first where appropriate, in person when clinically necessary. You decide whether a test is repeated.</p>' +
      evaluation(ev) +
      h3('Preventive follow-up queue') + (gaps.gaps.length ? '<div style="overflow-x:auto"><table class="dw-table"><thead><tr><th>Patient</th><th>Care gap</th><th>Due</th><th>Latest</th><th>Record outcome</th></tr></thead><tbody>' + gaps.gaps.map(gapRow).join('') + '</tbody></table></div>' : '<p>No open care gaps for your connected patients.</p>') +
      h3('Instruction packs') + packsTable(packs.packs) +
      h3('Patient records and referrals') + '<label>Patient <select id="ccPatient"><option value="">Choose a connected patient</option>' + (Array.isArray(patients) ? patients : []).map(function (p) { return '<option value="' + esc(p.id) + '"' + (String(p.id) === String(current) ? ' selected' : '') + '>' + esc(p.full_name) + '</option>'; }).join('') + '</select></label><div id="ccPatientOut"></div>';
    if (current) loadPatient(current);
  }

  async function loadPatient(id) {
    current = id; var out = document.getElementById('ccPatientOut'); if (!out) return;
    if (!id) { out.innerHTML = ''; return; }
    out.innerHTML = '<p>Loading…</p>';
    var d = await api.apiRequest('/doctor/care-coordination/patients/' + encodeURIComponent(id) + '/prior-records');
    out.innerHTML = d ? patientPanel(d) : '<p>Not available for this patient.</p>';
  }

  document.addEventListener('change', function (e) { if (e.target.id === 'ccPatient') loadPatient(e.target.value); });
  document.addEventListener('click', async function (e) {
    var t = e.target.closest && e.target.closest('[data-gap-save],[data-pack-verify],[data-pack-withdraw]'); if (!t) return;
    if (t.hasAttribute('data-gap-save')) {
      var row = t.closest('tr'), body = { mother_id: Number(row.getAttribute('data-mother')), gap_key: row.getAttribute('data-gap'), action: row.querySelector('[data-f="action"]').value, outcome: row.querySelector('[data-f="outcome"]').value, emergency_use_reported: row.querySelector('[data-f="emergency"]').checked };
      if (await api.apiRequest('/doctor/care-coordination/care-gaps/events', { method: 'POST', body: body })) { api.toast('Recorded'); load(); }
    } else if (t.hasAttribute('data-pack-verify')) {
      if (!confirm('I have checked these instructions and they are correct for this patient.')) return;
      if (await api.apiRequest('/doctor/care-coordination/packs/' + t.getAttribute('data-pack-verify') + '/verify', { method: 'POST', body: { confirmed: true } })) { api.toast('Shared with the patient'); load(); }
    } else if (await api.apiRequest('/doctor/care-coordination/packs/' + t.getAttribute('data-pack-withdraw') + '/withdraw', { method: 'POST', body: {} })) { api.toast('Withdrawn'); load(); }
  });
  document.addEventListener('submit', async function (e) {
    var f = e.target; if (f.id !== 'ccTest' && f.id !== 'ccPack') return;
    e.preventDefault(); if (!current) return;
    if (f.id === 'ccTest') {
      var body = { test_name: f.test_name.value, decision: f.decision.value, reason: f.reason.value };
      if (f.document_id.value) body.document_id = Number(f.document_id.value);
      if (await api.apiRequest('/doctor/care-coordination/patients/' + current + '/test-decisions', { method: 'POST', body: body })) { api.toast('Decision recorded'); loadPatient(current); }
    } else {
      var r = await api.apiRequest('/doctor/care-coordination/packs', { method: 'POST', body: { mother_id: Number(current), kind: f.kind.value, title: f.title.value, body: f.body.value, in_person_required: f.in_person_required.checked, in_person_reason: f.in_person_reason.value } });
      if (!r) return;
      api.toast('Draft saved. Verify it to share with the patient.');
      var hints = (r.hints || []).map(function (h) { return '<li>' + esc(h.type === 'jargon' ? '"' + h.term + '" → ' + h.suggestion : h.message || ('Long sentence: ' + h.text)) + '</li>'; });
      await load();
      var box = document.getElementById('ccHints'); if (box && hints.length) box.innerHTML = '<p><small>Plain-language suggestions for the draft:</small></p><ul>' + hints.join('') + '</ul>';
    }
  });
  window.CareCoordinationDoctor = { load: load };
})();
