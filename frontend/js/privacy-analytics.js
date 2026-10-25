/* N. Privacy-preserving analytics panel (doctor workspace).
   Shows aggregate, de-identified rows only. Small groups arrive already hidden from the server. */
(function () {
  'use strict';
  var api = window.DaiAPI, root, defs = null, loaded = false;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }

  function shell() {
    var metricOptions = defs.metrics.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.label) + '</option>'; }).join('');
    var windowOptions = defs.windows.map(function (w) { return '<option value="' + w + '"' + (w === 90 ? ' selected' : '') + '>Last ' + w + ' days</option>'; }).join('');
    root.innerHTML =
      '<h2 style="margin:0 0 .25rem">Population analytics</h2>' +
      '<p style="margin:0 0 .75rem">Aggregate figures with no patient names. Groups with fewer than <strong>' + defs.k_min + '</strong> people are hidden, and no overall total is shown.</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:end;margin-bottom:.75rem">' +
      '<label>Measure<br><select id="paMetric">' + metricOptions + '</select></label>' +
      '<label>Group by<br><select id="paGroup"></select></label>' +
      '<label>Period<br><select id="paWindow">' + windowOptions + '</select></label>' +
      '<button type="button" class="btn btn--primary btn--sm" id="paShow">Show</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="paExport">Download CSV</button></div>' +
      '<p id="paDefinition" style="font-size:.85rem"></p><div id="paResult" aria-live="polite"></div>' +
      '<small>Views and downloads are recorded. Downloads are limited to ' + defs.export_limit_per_day + ' a day and contain exactly the rows shown here.</small>';
    $('paMetric').addEventListener('change', syncGroups);
    $('paShow').addEventListener('click', show);
    $('paExport').addEventListener('click', download);
    syncGroups();
  }

  function current() { return defs.metrics.filter(function (m) { return m.id === $('paMetric').value; })[0]; }
  function syncGroups() {
    var m = current();
    $('paGroup').innerHTML = m.group_by.map(function (g) { return '<option value="' + esc(g) + '">' + (g === 'area' ? 'Area (district)' : 'Facility') + '</option>'; }).join('');
    $('paDefinition').textContent = m.description + ' ' + m.caveat;
  }
  function query() { return 'metric=' + encodeURIComponent($('paMetric').value) + '&group_by=' + encodeURIComponent($('paGroup').value) + '&window=' + encodeURIComponent($('paWindow').value); }

  async function show() {
    var out = $('paResult');
    out.textContent = 'Loading\u2026';
    var r = await api.apiRequest('/analytics/report?' + query());
    if (!r) { out.textContent = 'Could not load this report.'; return; }
    var hasMedian = r.rows.some(function (x) { return 'median_days' in x; });
    var body = r.rows.length ? r.rows.map(function (x) {
      if (x.suppressed) return '<tr><td>' + esc(x.label) + '</td><td colspan="' + (hasMedian ? 3 : 2) + '"><em>Hidden: ' + esc(x.reason) + '</em></td></tr>';
      return '<tr><td>' + esc(x.label) + '</td><td>' + esc(x.people_band) + '</td><td>' + esc(x.rate_text) + '</td>' +
        (hasMedian ? '<td>' + (x.median_days == null ? esc(x.median_note || '\u2013') : esc(x.median_days) + ' days') + '</td>' : '') + '</tr>';
    }).join('') : '<tr><td colspan="4">No data in this period.</td></tr>';
    out.innerHTML = '<div style="overflow-x:auto"><table class="growth-table" style="width:100%"><thead><tr><th>' + (r.group_by === 'area' ? 'Area' : 'Facility') + '</th><th>People</th><th>Rate</th>' +
      (hasMedian ? '<th>Median time</th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<ul style="font-size:.82rem">' + r.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
  }

  async function download() {
    try {
      var res = await fetch(api.API_BASE + '/analytics/export.csv?' + query(), { credentials: 'include' });
      if (!res.ok) { var e = await res.json().catch(function () { return {}; }); api.toast(e.error || 'Download failed'); return; }
      var blob = await res.blob(), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'dai-analytics.csv'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    } catch (e) { api.toast('Download failed'); }
  }

  async function load() {
    root = $('dwPopulation'); if (!root || loaded) return;
    defs = await api.apiRequest('/analytics/metrics');
    if (!defs) { root.innerHTML = '<p>Analytics are limited to verified clinicians.</p>'; return; }
    loaded = true; shell(); show();
  }
  window.PrivacyAnalytics = { load: load };
})();
