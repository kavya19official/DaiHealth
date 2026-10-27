/* C. Sustainability-aware care coordination (patient view). Text-only and loaded on demand.
   Instructions are written and verified by the clinician; nothing is generated here. All text is escaped. */
(function () {
  'use strict';
  var api = window.DaiAPI, root, loading = false;
  var KIND = { visit_instructions: 'Visit instructions', test_preparation: 'Test preparation', follow_up_summary: 'Follow-up summary' };
  var CAP = { high_risk_pregnancy: 'High-risk pregnancy care', emergency_maternity: 'Emergency maternity care', c_section_24x7: 'C-section (24x7)', blood_transfusion: 'Blood transfusion', neonatal_surgery: 'Newborn surgery', icu_mother: 'ICU for mothers', telemedicine: 'Telemedicine', home_visits: 'Home visits', mental_health_support: 'Mental health support' };
  var OUTCOME = { pending: 'Not yet', seen_first_visit: 'Seen on the first visit', redirected: 'Sent somewhere else', failed_visit: 'Visit did not happen there', not_attended: 'Could not go' };
  var REASON = { capability_unavailable: 'Service not available there', closed_or_no_slot: 'Closed or no slot', turned_away: 'Turned away', transport: 'Transport', cost: 'Cost', other: 'Other' };
  var FEEDBACK = { avoided_trip: 'Saved me a trip', avoided_paperwork: 'Saved paperwork', still_needed_visit: 'I still needed to visit', unclear: 'Not clear' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(d) { return d ? api.fmtDate(String(d).slice(0, 10)) : ''; }
  function opts(map, sel) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); }
  function h2(t) { return '<h2 style="margin:1.2rem 0 .4rem;font-size:1.05rem">' + esc(t) + '</h2>'; }

  function pack(p) {
    return '<details class="card section-card" data-pack="' + p.id + '" style="margin:.5rem 0;padding:.8rem 1rem"><summary style="cursor:pointer"><strong>' + esc(p.title) + '</strong> · ' + esc(KIND[p.kind] || p.kind) +
      (p.patient_seen_at ? '' : ' <span class="tag tag--next">New</span>') + '</summary>' +
      '<p style="margin:.4rem 0"><span class="tag tag--ok">Verified by ' + esc(p.clinician || 'your clinician') + ' on ' + esc(day(p.verified_at)) + '</span></p>' +
      (p.in_person_required ? '<p role="note" style="margin:.4rem 0;padding:.5rem .7rem;border-left:4px solid #b45309;background:#fff7ed"><strong>Please attend in person.</strong> ' + esc(p.in_person_reason) + '</p>' : '') +
      '<p style="white-space:pre-line;margin:.4rem 0">' + esc(p.body) + '</p>' +
      '<p style="margin:.6rem 0 .2rem"><small>Did these instructions help?</small></p><div>' + Object.keys(FEEDBACK).map(function (k) {
        return '<button type="button" class="link-btn" data-feedback="' + k + '" aria-pressed="' + (p.feedback === k) + '"' + (p.feedback === k ? ' style="font-weight:700"' : '') + '>' + esc(FEEDBACK[k]) + '</button>';
      }).join(' · ') + '</div></details>';
  }

  function render(d) {
    var packs = d.packs.length ? d.packs.map(pack).join('') : '<p>No verified instructions yet. Your clinician can share visit instructions, test preparation and follow-up here.</p>';
    var refs = d.referrals.map(function (r) { return '<li>' + esc(r.referral_type) + ' referral · <strong>' + esc(r.status) + '</strong>' + (r.appointment_date ? ' · appointment ' + esc(day(r.appointment_date)) : '') + (r.patient_instructions ? '<br><small>' + esc(r.patient_instructions) + '</small>' : '') + '</li>'; })
      .concat(d.facility_referrals.map(function (r) { return '<li>' + esc(r.facility_name || 'Facility') + ' · <strong>' + esc(r.status) + '</strong> · ' + esc(day(r.created_at)) + '</li>'; }));
    var follow = d.follow_ups.map(function (g) { return '<li>' + esc(g.title) + (g.due_date ? ' · by ' + esc(day(g.due_date)) : '') + '</li>'; });
    var journeys = d.journeys.map(function (j) {
      return '<li data-journey="' + j.id + '">' + esc(CAP[j.care_need] || j.care_need) + (j.facility_name ? ' at ' + esc(j.facility_name) : '') + ' · ' +
        '<label><span class="sr-only">Outcome</span><select data-journey-outcome>' + opts(OUTCOME, j.outcome) + '</select></label>' + (j.failure_reason ? ' <small>(' + esc(REASON[j.failure_reason]) + ')</small>' : '') + '</li>';
    });
    root.innerHTML =
      '<p role="note"><small>' + esc(d.notice) + '</small></p>' +
      h2('Verified instructions') + packs +
      h2('Referral status') + (refs.length ? '<ul>' + refs.join('') + '</ul>' : '<p>No referrals recorded.</p>') +
      h2('Follow-up due') + (follow.length ? '<ul>' + follow.join('') + '</ul><p><small>Reminders help you keep track. Contact your care team if you are unsure or feel unwell.</small></p>' : '<p>Nothing due in the next week.</p>') +
      h2('Find a facility with the right service') +
      '<form id="ccMatch" class="form-grid"><label>Care needed <select name="capability" required>' + opts(CAP) + '</select></label>' +
      '<label>Your Delhi locality or PIN <input name="place" autocomplete="postal-code" maxlength="60" placeholder="e.g. Saket or 110017"></label>' +
      '<button type="submit" class="btn btn--primary">Find</button></form><div id="ccMatchOut"></div>' +
      h2('How did a referral visit go?') +
      '<p><small>Telling us whether you reached the right place first time helps measure avoidable repeat journeys.</small></p>' +
      '<form id="ccJourney" class="form-grid"><label>Care needed <select name="care_need">' + opts(CAP) + '</select></label>' +
      '<label>Facility <select name="facility_id"><option value="">Not listed</option></select></label>' +
      '<label>Places tried before this one <input name="prior_searches" type="number" min="0" max="20" inputmode="numeric"></label>' +
      '<label>What happened <select name="outcome">' + opts(OUTCOME) + '</select></label>' +
      '<label>If it did not work out, why? <select name="failure_reason"><option value="">—</option>' + opts(REASON) + '</select></label>' +
      '<button type="submit" class="btn">Save</button></form>' +
      (journeys.length ? '<ul>' + journeys.join('') + '</ul>' : '') +
      '<p><small>On a slow connection, turn on Low-bandwidth mode in Settings: maps, images and background refresh are switched off.</small></p>';
  }

  async function load() {
    root = document.getElementById('careCoordination');
    if (!root || loading || !api) return;
    loading = true;
    try {
      var d = await api.apiRequest('/patient/care-coordination');
      if (!d) { root.innerHTML = '<p>Care coordination is not available right now.</p>'; return; }
      render(d);
    } finally { loading = false; }
  }

  document.addEventListener('toggle', function (e) {
    var el = e.target; if (!el.matches || !el.matches('[data-pack]') || !el.open) return;
    var tag = el.querySelector('.tag--next'); if (!tag) return;
    api.apiRequest('/patient/care-coordination/packs/' + el.getAttribute('data-pack') + '/seen', { method: 'POST', body: {} }).then(function (r) { if (r) tag.remove(); });
  }, true);
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-feedback]');
    if (b) {
      var id = b.closest('[data-pack]').getAttribute('data-pack');
      api.apiRequest('/patient/care-coordination/packs/' + id + '/feedback', { method: 'POST', body: { outcome: b.getAttribute('data-feedback') } }).then(function (r) {
        if (!r) return; b.parentNode.querySelectorAll('[data-feedback]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); x.style.fontWeight = x === b ? '700' : ''; }); api.toast('Thank you');
      });
    }
    var nav = e.target.closest && e.target.closest('[data-panel="coordination"],[data-go="coordination"]');
    if (nav) load();
  });
  document.addEventListener('change', function (e) {
    var s = e.target; if (!s.matches || !s.matches('[data-journey-outcome]')) return;
    api.apiRequest('/patient/care-coordination/journeys/' + s.closest('[data-journey]').getAttribute('data-journey'), { method: 'PATCH', body: { outcome: s.value } }).then(function (r) { if (r) api.toast('Saved'); });
  });
  document.addEventListener('submit', async function (e) {
    var f = e.target;
    if (f.id === 'ccMatch') {
      e.preventDefault();
      var place = f.place.value.trim(), q = 'capability=' + encodeURIComponent(f.capability.value);
      if (place) q += (/^\d{6}$/.test(place) ? '&pincode=' : '&locality=') + encodeURIComponent(place);
      var out = document.getElementById('ccMatchOut'); out.textContent = 'Searching…';
      var r = await api.apiRequest('/care-coordination/facility-match?' + q);
      if (!r) { out.textContent = ''; return; }
      out.innerHTML = '<p><small>' + esc(r.notice) + (r.location ? ' Distance from ' + esc(r.location) + '.' : '') + '</small></p>' + (r.facilities.length ? '<ol>' + r.facilities.map(function (x) {
        return '<li><strong>' + esc(x.name) + '</strong>' + (x.distance_km != null ? ' · ' + esc(x.distance_km) + ' km' : '') + ' · ' + (x.open_slots ? esc(x.open_slots) + ' reported slots' : 'availability not reported') + (x.phone ? ' · <a href="tel:' + esc(x.phone) + '">' + esc(x.phone) + '</a>' : '') + '</li>';
      }).join('') + '</ol>' : '<p>No facility in the directory lists this service as available. Ask your doctor or ASHA worker before travelling.</p>');
      var sel = document.querySelector('#ccJourney [name="facility_id"]');
      if (sel) sel.innerHTML = '<option value="">Not listed</option>' + r.facilities.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('');
      var need = document.querySelector('#ccJourney [name="care_need"]'); if (need) need.value = r.capability;
    }
    if (f.id === 'ccJourney') {
      e.preventDefault();
      var body = { care_need: f.care_need.value, outcome: f.outcome.value };
      if (f.facility_id.value) body.facility_id = Number(f.facility_id.value);
      if (f.prior_searches.value !== '') body.prior_searches = Number(f.prior_searches.value);
      if (f.failure_reason.value) body.failure_reason = f.failure_reason.value;
      if (await api.apiRequest('/patient/care-coordination/journeys', { method: 'POST', body: body })) { api.toast('Saved'); load(); }
    }
  });
  if (location.hash === '#coordination') document.addEventListener('DOMContentLoaded', load);
  window.CareCoordinationPatient = { load: load };
})();
