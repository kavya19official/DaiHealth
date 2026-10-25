/* L. Reason-for-delay dialog shared by postnatal visits and child vaccines.
   Saving a reason never marks anything done. Reasons come from the server list. */
(function () {
  'use strict';
  var api = window.DaiAPI, cache = { delays: [], reasons: {}, loaded: false };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function key(kind, code, childId) { return kind + ':' + code + ':' + (childId || 0); }

  async function load() {
    var r = await api.apiRequest('/follow-through');
    if (r) { cache.delays = r.delays || []; cache.reasons = r.reasons || {}; cache.loaded = true; }
    return cache;
  }
  function find(kind, code, childId) {
    return cache.delays.filter(function (d) { return key(d.kind, d.item_code, d.child_id) === key(kind, code, childId); })[0] || null;
  }
  function note(kind, code, childId) {
    var d = find(kind, code, childId);
    if (!d) return '';
    return 'Reason noted: ' + d.reason_label + (d.new_target ? ' \u00b7 planned for ' + d.new_target : '');
  }
  function open(opts) {
    var existing = find(opts.kind, opts.code, opts.childId);
    var dlg = document.createElement('dialog');
    dlg.setAttribute('aria-label', 'Reason for delay');
    dlg.style.cssText = 'border:1px solid #ddd;border-radius:14px;padding:1.2rem;max-width:420px;width:92vw';
    dlg.innerHTML = '<form method="dialog"><h2 style="margin:0 0 .4rem;font-size:1.05rem">Why was this delayed?</h2>' +
      '<p style="margin:0 0 .8rem;font-size:.85rem">' + esc(opts.title) + '. This does not mark it as done and does not change your care plan. Your doctor or nurse decides what to do next.</p>' +
      '<label style="display:block;font-size:.85rem">Reason<select name="reason" required style="width:100%;margin:.25rem 0 .6rem">' +
      Object.keys(cache.reasons).map(function (k) { return '<option value="' + esc(k) + '"' + (existing && existing.reason === k ? ' selected' : '') + '>' + esc(cache.reasons[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label style="display:block;font-size:.85rem">Planned new date (optional)<input type="date" name="new_target" min="' + api.localDateStr() + '" value="' + esc(existing && existing.new_target || '') + '" style="width:100%;margin:.25rem 0 .6rem"></label>' +
      '<label style="display:block;font-size:.85rem">Note for your care team (optional)<input name="note" maxlength="300" value="' + esc(existing && existing.note || '') + '" style="width:100%;margin:.25rem 0 .8rem"></label>' +
      '<div style="display:flex;gap:.5rem;justify-content:flex-end"><button type="button" data-cancel class="btn btn--ghost btn--sm">Cancel</button>' +
      (existing ? '<button type="button" data-remove class="btn btn--ghost btn--sm">Remove reason</button>' : '') +
      '<button type="submit" value="save" class="btn btn--primary btn--sm">Save reason</button></div></form>';
    document.body.appendChild(dlg);
    var form = dlg.querySelector('form');
    dlg.querySelector('[data-cancel]').onclick = function () { dlg.close(); };
    var rm = dlg.querySelector('[data-remove]');
    if (rm) rm.onclick = async function () {
      var r = await api.apiRequest('/follow-through/delays', { method: 'DELETE', body: { kind: opts.kind, item_code: opts.code, child_id: opts.childId } });
      if (r) { dlg.close(); await load(); if (opts.onSaved) opts.onSaved(); }
    };
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var f = form.elements;
      var r = await api.apiRequest('/follow-through/delays', { method: 'PUT', body: { kind: opts.kind, item_code: opts.code, child_id: opts.childId, reason: f.reason.value, new_target: f.new_target.value || null, note: f.note.value || null } });
      if (r) { api.toast(r.message); dlg.close(); await load(); if (opts.onSaved) opts.onSaved(); }
    });
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.showModal();
  }
  window.DaiDelay = { load: load, open: open, note: note };
})();
