/* O. Doctor editor for the patient-friendly visit summary. The clinician writes every word and must
   approve it before the patient can see it. The checker only flags jargon, long sentences and doses. */
(function () {
  'use strict';
  var api = window.DaiAPI, root, loaded = false;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lines(t) { return String(t || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }

  function statusTag(v) {
    if (v.summary_status === 'approved') return '<span class="tag tag--ok">Approved v' + esc(v.version) + (v.patient_seen_at ? ' \u00b7 seen' : ' \u00b7 not seen yet') + '</span>';
    if (v.summary_status === 'draft') return '<span class="tag tag--pending">Draft</span>';
    return '<span class="tag tag--next">No summary</span>';
  }

  async function load() {
    root = document.getElementById('dwVisitSummaries'); if (!root) return;
    var r = await api.apiRequest('/doctor/visit-summaries');
    if (!r) { root.innerHTML = '<p>Visit summaries are limited to verified clinicians.</p>'; return; }
    loaded = true;
    root.innerHTML = '<h2 style="margin:0 0 .25rem">Visit summaries</h2>' +
      '<p style="margin:0 0 .75rem">Write a short summary in simple words after a visit. The patient sees it only after you approve it.</p>' +
      (r.visits.length ? '<div style="overflow-x:auto"><table class="growth-table" style="width:100%"><thead><tr><th>Date</th><th>Patient</th><th>Reason</th><th>Summary</th><th></th></tr></thead><tbody>' +
        r.visits.map(function (v) {
          return '<tr><td>' + esc(api.fmtDate(v.visit_date)) + '</td><td>' + esc(v.patient_name || 'Patient') + '</td><td>' + esc(v.reason || '') + '</td><td>' + statusTag(v) +
            '</td><td><button type="button" class="btn btn--sm btn--ghost" data-vs-edit="' + esc(v.id) + '">' + (v.summary_status === 'none' ? 'Write' : 'Open') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p>No visits in the last 60 days.</p>');
  }

  async function edit(id) {
    var r = await api.apiRequest('/doctor/visit-summaries/' + encodeURIComponent(id));
    if (!r) return;
    var base = r.draft || r.approved || { summary_text: '', next_steps: [], follow_up: {}, pending_tests: [] };
    var dlg = document.createElement('dialog');
    dlg.style.cssText = 'border:1px solid #ddd;border-radius:14px;padding:1.1rem;max-width:620px;width:94vw';
    dlg.innerHTML = '<form method="dialog" id="vsForm"><h2 style="margin:0 0 .2rem;font-size:1.1rem">Visit summary: ' + esc(r.visit.patient_name || 'Patient') + '</h2>' +
      '<p style="margin:0 0 .6rem;font-size:.85rem">Visit on ' + esc(api.fmtDate(r.visit.visit_date)) + '. ' + esc(r.reminder) + '</p>' +
      (r.approved ? '<p style="font-size:.85rem"><span class="tag tag--ok">Version ' + esc(r.approved.version) + ' is live</span> Approving this draft replaces it.</p>' : '') +
      '<label style="display:block;font-size:.85rem">In simple words: what happened and what it means<textarea name="summary" rows="3" maxlength="1200" style="width:100%">' + esc(base.summary_text || '') + '</textarea></label>' +
      '<label style="display:block;font-size:.85rem;margin-top:.5rem">What the patient should do next (one per line, up to 8)<textarea name="steps" rows="3" style="width:100%">' + esc((base.next_steps || []).join('\n')) + '</textarea></label>' +
      '<div style="display:flex;gap:.5rem;margin-top:.5rem"><label style="flex:2;font-size:.85rem">Follow-up<input name="ftext" maxlength="300" value="' + esc((base.follow_up || {}).text || '') + '" style="width:100%"></label>' +
      '<label style="flex:1;font-size:.85rem">By date<input type="date" name="fdate" value="' + esc((base.follow_up || {}).due_date || '') + '" style="width:100%"></label></div>' +
      '<label style="display:block;font-size:.85rem;margin-top:.5rem">Tests still to do (one per line: Test name | note)<textarea name="tests" rows="3" style="width:100%">' +
      esc((base.pending_tests || []).map(function (t) { return t.name + (t.note ? ' | ' + t.note : ''); }).join('\n')) + '</textarea></label>' +
      '<div id="vsHints" aria-live="polite" style="font-size:.82rem;margin:.6rem 0"></div>' +
      '<div style="display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap"><button type="button" data-vs-cancel class="btn btn--ghost btn--sm">Close</button>' +
      '<button type="button" data-vs-save class="btn btn--ghost btn--sm">Save draft</button>' +
      '<button type="button" data-vs-approve class="btn btn--primary btn--sm"' + (r.visit.can_write ? '' : ' disabled') + '>Approve and show to patient</button></div></form>';
    document.body.appendChild(dlg);
    var f = dlg.querySelector('form').elements;

    function payload() {
      return {
        summary_text: f.summary.value, next_steps: lines(f.steps.value),
        follow_up: { text: f.ftext.value, due_date: f.fdate.value || null },
        pending_tests: lines(f.tests.value).map(function (l) { var p = l.split('|'); return { name: (p[0] || '').trim(), note: (p[1] || '').trim() }; })
      };
    }
    function hints() {
      if (!window.PlainLanguage) return;
      var p = payload(), text = [p.summary_text].concat(p.next_steps, [p.follow_up.text], p.pending_tests.map(function (t) { return t.name + ' ' + t.note; })).join('. ');
      var h = window.PlainLanguage.check(text);
      dlg.querySelector('#vsHints').innerHTML = h.length ? '<strong>Check wording:</strong><ul style="margin:.2rem 0 0 1.1rem">' + h.map(function (x) {
        return '<li>' + (x.type === 'jargon' ? 'Hard word \u201c' + esc(x.term) + '\u201d: you could say \u201c' + esc(x.suggestion) + '\u201d' : x.type === 'long_sentence' ? 'Long sentence (' + esc(x.words) + ' words): try splitting it' : esc(x.message)) + '</li>';
      }).join('') + '</ul>' : '';
    }
    dlg.addEventListener('input', hints); hints();

    async function save() {
      var s = await api.apiRequest('/doctor/visit-summaries/' + encodeURIComponent(id), { method: 'PUT', body: payload() });
      if (s) api.toast(s.message); return !!s;
    }
    dlg.querySelector('[data-vs-cancel]').onclick = function () { dlg.close(); };
    dlg.querySelector('[data-vs-save]').onclick = async function () { if (await save()) load(); };
    dlg.querySelector('[data-vs-approve]').onclick = async function () {
      if (!confirm('The patient will see exactly what is on screen. Approve it?')) return;
      if (!(await save())) return;
      var a = await api.apiRequest('/doctor/visit-summaries/' + encodeURIComponent(id) + '/approve', { method: 'POST', body: {} });
      if (a) { api.toast(a.message); dlg.close(); load(); }
    };
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.showModal();
  }

  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-vs-edit]'); if (b) edit(b.getAttribute('data-vs-edit')); });
  window.VisitSummaryDoctor = { load: load };
})();
